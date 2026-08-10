import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { UPLOAD_TICKET_TTL_SECONDS } from '../auth/auth.constants';
import { RedisService } from '../redis/redis.service';
import { UploadTicket } from './entities/upload-ticket.entity';

const UPLOAD_TICKET_KEY_PREFIX = 'upload:ticket:';

type UploadTicketPayload = {
  sub: string;
  movieId: number;
  typ: 'upload';
  jti: string;
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

  async mint(userId: string, movieId: number): Promise<UploadTicket> {
    const jti = randomUUID();
    const payload: UploadTicketPayload = { sub: userId, movieId, typ: 'upload', jti };

    const token = this.jwtService.sign(payload, { expiresIn: UPLOAD_TICKET_TTL_SECONDS });

    return {
      token,
      expiresAt: new Date(Date.now() + UPLOAD_TICKET_TTL_SECONDS * 1000),
    };
  }

  /**
   * Verifies a ticket and, on success, spends it so it cannot be replayed.
   * The movieId check runs BEFORE the spend on purpose (AC-12): a ticket
   * minted for one movie and presented for another must not be burned by
   * the mismatch, or a client that mistakenly races two uploads for
   * different movies with the same ticket would lose the ticket it actually
   * needed. Returns the ticket's owner `userId` on success, throws on any
   * failure — callers decide the exact HTTP shape of that failure.
   */
  async verifyAndSpend(token: string, movieId: number): Promise<string> {
    let payload: DecodedUploadTicket;
    try {
      payload = this.jwtService.verify<DecodedUploadTicket>(token);
    } catch {
      throw new Error('Invalid or expired upload ticket');
    }

    if (payload.typ !== 'upload') {
      throw new Error('Token is not an upload ticket');
    }

    if (Number(payload.movieId) !== movieId) {
      throw new Error('Upload ticket does not match the movie being uploaded');
    }

    const secondsRemaining = payload.exp - Math.floor(Date.now() / 1000);
    if (secondsRemaining <= 0) {
      throw new Error('Invalid or expired upload ticket');
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
      throw new Error('Upload ticket already used');
    }

    return payload.sub;
  }
}
