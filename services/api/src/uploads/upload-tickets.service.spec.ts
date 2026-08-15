import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { UploadTicketsService } from './upload-tickets.service';

// This is the entire mechanism behind REQ-11/AC-11/AC-12: a tus POST is only
// allowed to create an upload if it carries a ticket minted by an
// authenticated user for that exact movie, and that ticket must not be
// reusable. A non-atomic spend (GET-then-SET instead of `SET ... NX`) would
// pass every one of these tests run one at a time and still allow a replay
// under real concurrency — see session.service.spec.ts for the same
// argument applied to logout. Runs against the real Redis this stack
// already depends on, because the property under test ("did the ticket
// actually get consumed") can only be asserted by construction against a
// mock.
describe('UploadTicketsService', () => {
  let redis: RedisService;
  let jwtService: JwtService;
  let service: UploadTicketsService;
  const MOVIE_ID = 42;
  const EPISODE_ID = 7;

  beforeAll(() => {
    redis = new RedisService();
    jwtService = new JwtService({ secret: 'upload-tickets-spec-secret' });
    service = new UploadTicketsService(jwtService, redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('accepts a freshly minted ticket for the movie it was minted for', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID });

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toBe('user-1');
  });

  it('rejects the same ticket presented a second time', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID });

    await service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID });

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).rejects.toThrow();
  });

  it('rejects an expired ticket', async () => {
    const expired = jwtService.sign(
      { sub: 'user-1', movieId: MOVIE_ID, typ: 'upload', jti: randomUUID() },
      { expiresIn: -10 },
    );

    await expect(service.verifyAndSpend(expired, { movieId: MOVIE_ID })).rejects.toThrow();
  });

  it('rejects a token that is not typed as an upload ticket', async () => {
    const wrongType = jwtService.sign(
      { sub: 'user-1', movieId: MOVIE_ID, typ: 'service', jti: randomUUID() },
      { expiresIn: 60 },
    );

    await expect(service.verifyAndSpend(wrongType, { movieId: MOVIE_ID })).rejects.toThrow();
  });

  it('rejects a movieId mismatch without spending the ticket', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID });

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID + 1 })).rejects.toThrow();

    // The mismatch above must not have burned the ticket — the correct
    // movieId still works afterwards (AC-12's whole point).
    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toBe('user-1');
  });

  it('rejects a ticket minted for a movie when presented for an episode, without spending it', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID });

    await expect(service.verifyAndSpend(ticket.token, { episodeId: EPISODE_ID })).rejects.toThrow();

    // Same argument as the movieId-mismatch case above, but across targets:
    // if the target check ran after the Redis spend, this cross-target
    // rejection would silently burn the ticket, and the legitimate movie
    // upload right below would then fail with "already used" — a failure
    // that would surface nowhere near the actual bug.
    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toBe('user-1');
  });
});
