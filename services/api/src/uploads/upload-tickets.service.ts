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
const UPLOAD_OWNER_KEY_PREFIX = 'upload:owner:';
// 7 days: long enough to cover a paused resumable upload, short enough that
// a stale marker for an abandoned upload eventually stops mattering.
const REPLACE_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;

// Spec 010, NFR-1
export type UploadTicketTarget = { movieId: number } | { episodeId: number } | { mediaSourceId: number };

// Spec 018, REQ-14
export class UploadTicketExpiredError extends Error {}

export class UploadTicketMismatchError extends Error {
  constructor(public readonly target: 'movie' | 'episode' | 'session') {
    super(`Upload ticket does not match the ${target} being uploaded`);
  }
}

type UploadTicketPayload = {
  sub: string;
  movieId?: number;
  episodeId?: number;
  mediaSourceId?: number;
  typ: 'upload';
  jti: string;
  // Spec 027, REQ-7
  force?: boolean;
};

// `jwtService.verify<T>` returns exactly `T`, so `exp` has to be declared
// here explicitly to compute how much of the ticket's 60s window is left —
// it is not part of the payload this service signs, `jsonwebtoken` adds it.
type DecodedUploadTicket = UploadTicketPayload & { exp: number };

// Spec 002, REQ-11
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
      ...('movieId' in target
        ? { movieId: target.movieId }
        : 'episodeId' in target
          ? { episodeId: target.episodeId }
          : { mediaSourceId: target.mediaSourceId }),
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

  // Spec 002, AC-12; Spec 002, AC-11; Spec 027, REQ-7
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

    let matches: boolean;
    let kind: 'movie' | 'episode' | 'session';
    if ('movieId' in target) {
      kind = 'movie';
      matches = payload.movieId !== undefined && Number(payload.movieId) === target.movieId;
    } else if ('episodeId' in target) {
      kind = 'episode';
      matches = payload.episodeId !== undefined && Number(payload.episodeId) === target.episodeId;
    } else {
      kind = 'session';
      matches = payload.mediaSourceId !== undefined && Number(payload.mediaSourceId) === target.mediaSourceId;
    }

    if (!matches) {
      throw new UploadTicketMismatchError(kind);
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

  async markUploadOwner(uploadId: string, userId: string): Promise<void> {
    await this.redis.set(`${UPLOAD_OWNER_KEY_PREFIX}${uploadId}`, userId, 'EX', REPLACE_MARKER_TTL_SECONDS, 'NX');
  }

  async getUploadOwner(uploadId: string): Promise<string | null> {
    return this.redis.get(`${UPLOAD_OWNER_KEY_PREFIX}${uploadId}`);
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
