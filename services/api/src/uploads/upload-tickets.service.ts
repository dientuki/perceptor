import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { UPLOAD_TICKET_TTL_SECONDS } from '../auth/auth.constants';
import { RedisService } from '../redis/redis.service';
import { UploadTicket } from './entities/upload-ticket.entity';

const UPLOAD_TICKET_KEY_PREFIX = 'upload:ticket:';

// The replace decision lives here, keyed by tus upload id, never in tus
// metadata — a browser-authored metadata key would be a forged
// authorisation (027-replace-completed-media, plan.md § Contract Freeze).
// Absence of the key means NO replacement: this is a fail-closed design,
// and a Redis outage or an expired marker on a long-paused upload both
// resolve to "no replace", never the other way around.
const UPLOAD_REPLACE_KEY_PREFIX = 'upload:replace:';
// 7 days: long enough to cover a paused resumable upload, short enough that
// a stale marker for an abandoned upload eventually stops mattering.
const REPLACE_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;

// A ticket is minted for exactly one target — a movie or an episode — never
// both. `movieId` keeps its name and meaning (010-episode-acquisition §
// NFR-1); `episodeId` sits beside it rather than generalising into a single
// `mediaId`, the same restraint `006-media-search` applied everywhere except
// `MediaSearchResult`.
export type UploadTicketTarget = { movieId: number } | { episodeId: number };

// Typed twins of the plain `Error`s this service used to throw, so callers
// (`uploads.service.ts`) can branch on `instanceof` instead of matching
// English message text — the exact coupling REQ-14/`error.magnet.*` already
// broke elsewhere in this feature (spec.md § "Error table — uploads").
export class UploadTicketExpiredError extends Error {}

export class UploadTicketMismatchError extends Error {
  constructor(public readonly target: 'movie' | 'episode') {
    super(`Upload ticket does not match the ${target} being uploaded`);
  }
}

type UploadTicketPayload = {
  sub: string;
  movieId?: number;
  episodeId?: number;
  typ: 'upload';
  jti: string;
  // 027-replace-completed-media: the confirmed-replacement decision, signed
  // into the ticket at mint time (REQ-7) so `onUploadFinish` never has to
  // re-derive it from anything the browser controls. Absent on every ticket
  // minted before this feature — `verifyAndSpend` below defaults it to
  // `false` for that reason.
  force?: boolean;
};

// `jwtService.verify<T>` returns exactly `T`, so `exp` has to be declared
// here explicitly to compute how much of the ticket's 60s window is left —
// it is not part of the payload this service signs, `jsonwebtoken` adds it.
type DecodedUploadTicket = UploadTicketPayload & { exp: number };

/**
 * The upload ticket is the session, delegated: the HttpOnly session cookie
 * cannot reach the tus endpoint on a different origin, so a short-lived
 * signed token minted by an authenticated GraphQL call stands in for it at
 * the tus `POST` (REQ-11). `mint` is a thin JWT sign; `verifyAndSpend` is
 * where every failure mode this ticket exists to prevent actually lives —
 * replay, cross-movie use, expiry — so it is the part this file's spec
 * exercises hardest.
 */
@Injectable()
export class UploadTicketsService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async mint(userId: string, target: UploadTicketTarget, force = false): Promise<UploadTicket> {
    const jti = randomUUID();
    const payload: UploadTicketPayload = {
      sub: userId,
      ...('movieId' in target ? { movieId: target.movieId } : { episodeId: target.episodeId }),
      typ: 'upload',
      jti,
      force,
    };

    const token = this.jwtService.sign(payload, { expiresIn: UPLOAD_TICKET_TTL_SECONDS });

    return {
      token,
      expiresAt: new Date(Date.now() + UPLOAD_TICKET_TTL_SECONDS * 1000),
    };
  }

  /**
   * Verifies a ticket and, on success, spends it so it cannot be replayed.
   * The target check runs BEFORE the spend on purpose (AC-12/AC-11): a
   * ticket minted for one movie/episode and presented for another must not
   * be burned by the mismatch, or a client that mistakenly races two
   * uploads with the same ticket would lose the ticket it actually needed.
   * Returns the ticket's owner `userId` and its signed `force` decision on
   * success, throws on any failure — callers decide the exact HTTP shape of
   * that failure. Returning an object rather than a bare string is
   * deliberate (027-replace-completed-media): it makes `force` impossible
   * to drop silently at the one call site that reads it.
   */
  async verifyAndSpend(token: string, target: UploadTicketTarget): Promise<{ userId: string; force: boolean }> {
    let payload: DecodedUploadTicket;
    try {
      payload = this.jwtService.verify<DecodedUploadTicket>(token);
    } catch {
      throw new UploadTicketExpiredError('Invalid or expired upload ticket');
    }

    if (payload.typ !== 'upload') {
      throw new UploadTicketExpiredError('Token is not an upload ticket');
    }

    const matches =
      'movieId' in target
        ? payload.movieId !== undefined && Number(payload.movieId) === target.movieId
        : payload.episodeId !== undefined && Number(payload.episodeId) === target.episodeId;

    if (!matches) {
      throw new UploadTicketMismatchError('movieId' in target ? 'movie' : 'episode');
    }

    const secondsRemaining = payload.exp - Math.floor(Date.now() / 1000);
    if (secondsRemaining <= 0) {
      throw new UploadTicketExpiredError('Invalid or expired upload ticket');
    }

    // Atomic SET ... NX: only the first spend of a given jti succeeds. A
    // GET-then-SET here would pass a single-request test and still allow a
    // replay under concurrency — see auth/session.service.ts for the same
    // pattern applied to logout.
    const spent = await this.redis.set(
      `${UPLOAD_TICKET_KEY_PREFIX}${payload.jti}`,
      '1',
      'EX',
      secondsRemaining,
      'NX',
    );
    if (spent !== 'OK') {
      throw new UploadTicketExpiredError('Upload ticket already used');
    }

    return { userId: payload.sub, force: payload.force ?? false };
  }

  /**
   * Records that this upload id was authorised, at ticket-mint time, to
   * replace whatever the target currently has. Called by `onUploadCreate`
   * only after `verifyAndSpend` resolved `force: true` — never from tus
   * metadata (027-replace-completed-media, plan.md § Contract Freeze).
   */
  async markReplaceAuthorised(uploadId: string): Promise<void> {
    await this.redis.set(`${UPLOAD_REPLACE_KEY_PREFIX}${uploadId}`, '1', 'EX', REPLACE_MARKER_TTL_SECONDS, 'NX');
  }

  /**
   * Reads the replace decision `onUploadCreate` recorded for this upload id.
   * Absence of the key — never written, expired, or a Redis hiccup — resolves
   * to `false`: fail closed, so a replacement can only ever happen because
   * this service itself recorded that it was authorised, never by default.
   */
  async isReplaceAuthorised(uploadId: string): Promise<boolean> {
    const value = await this.redis.get(`${UPLOAD_REPLACE_KEY_PREFIX}${uploadId}`);
    return value === '1';
  }
}
