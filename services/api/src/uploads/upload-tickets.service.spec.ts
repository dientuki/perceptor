import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { UploadTicketMismatchError, UploadTicketsService } from './upload-tickets.service';

// This is the entire mechanism behind Spec 002, REQ-11 AC-11 AC-12: a tus POST is only
// allowed to create an upload if it carries a ticket minted by an
// authenticated user for that exact movie, and that ticket must not be
// reusable. A non-atomic spend (GET-then-SET instead of `SET ... NX`) would
// pass every one of these tests run one at a time and still allow a replay
// under real concurrency — see session.service.spec.ts for the same
// argument applied to logout. Runs against the real Redis this stack
// already depends on, because the property under test ("did the ticket
// actually get consumed") can only be asserted by construction against a
// mock.
//
// Spec 027, REQ-7: the `force`/replace-marker cases below defend
// against a forged replacement — a `force: false` ticket must never yield a
// `true` decision from `isReplaceAuthorised`, whatever a browser later sends
// as tus metadata. This fails silently in the worst way: the upload succeeds,
// a good library file is overwritten, and the only evidence is that it is now
// the wrong film. `verifyAndSpend` is the only place `force` can enter the
// system (it is read out of the ticket's own signed payload), so these cases
// exercise it directly rather than the resolver/service plumbing above it.
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

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toEqual({ userId: 'user-1', force: false });
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

    // Spec 002, AC-12
    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toEqual({ userId: 'user-1', force: false });
  });

  it('rejects a ticket minted for a movie when presented for an episode, without spending it', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID });

    await expect(service.verifyAndSpend(ticket.token, { episodeId: EPISODE_ID })).rejects.toThrow();

    // Same argument as the movieId-mismatch case above, but across targets:
    // if the target check ran after the Redis spend, this cross-target
    // rejection would silently burn the ticket, and the legitimate movie
    // upload right below would then fail with "already used" — a failure
    // that would surface nowhere near the actual bug.
    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID })).resolves.toEqual({ userId: 'user-1', force: false });
  });

  it('resolves force: false for a ticket minted without confirming a replacement', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID + 2 });

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID + 2 })).resolves.toEqual({
      userId: 'user-1',
      force: false,
    });
  });

  it('resolves force: true only for a ticket minted with force: true', async () => {
    const ticket = await service.mint('user-1', { movieId: MOVIE_ID + 3 }, true);

    await expect(service.verifyAndSpend(ticket.token, { movieId: MOVIE_ID + 3 })).resolves.toEqual({
      userId: 'user-1',
      force: true,
    });
  });

  // The forged-replacement defence itself (Spec 027, REQ-7): the marker must exist
  // ONLY when the ticket that authorised this upload id carried force: true.
  // If `onUploadCreate` were changed to trust `upload.metadata` instead of
  // this signed payload, a force: false ticket would still leave no marker
  // here even though a malicious client's metadata claimed otherwise — these
  // two cases would keep passing and the regression would show up only in
  // `uploads.service.ts`, which is exactly the silent failure this file
  // exists to catch before it gets that far.
  describe('the replace marker', () => {
    it('is absent for an upload id nothing ever wrote', async () => {
      await expect(service.isReplaceAuthorised('never-written-upload-id')).resolves.toBe(false);
    });

    it('is visible only after markReplaceAuthorised was called for that id', async () => {
      const uploadId = `spec-${randomUUID()}`;

      await expect(service.isReplaceAuthorised(uploadId)).resolves.toBe(false);

      await service.markReplaceAuthorised(uploadId);

      await expect(service.isReplaceAuthorised(uploadId)).resolves.toBe(true);
    });
  });

  // Spec 068: the `{ mediaSourceId }` target names an open
  // season upload session, and one ticket is minted per file of a batch. If a
  // mismatch burned the ticket, a client that mis-addressed one file would lose
  // the ticket it needed and the batch would stall with a generic "already
  // used" error far from the cause; if a session ticket verified for another
  // session, or for a movie/episode target, a file would be written into the
  // wrong folder with a 200 and nothing anywhere would say so. These cases pin
  // Spec 068, AC-7
  describe('the session target', () => {
    const SESSION_ID = 900;

    it('rejects a session mismatch with a session error and does not spend the ticket', async () => {
      const ticket = await service.mint('user-1', { mediaSourceId: SESSION_ID });

      await expect(service.verifyAndSpend(ticket.token, { mediaSourceId: SESSION_ID + 1 })).rejects.toMatchObject({
        constructor: UploadTicketMismatchError,
        target: 'session',
      });

      // Same token, real session: still spendable, exactly once.
      await expect(service.verifyAndSpend(ticket.token, { mediaSourceId: SESSION_ID })).resolves.toEqual({
        userId: 'user-1',
        force: false,
      });
      await expect(service.verifyAndSpend(ticket.token, { mediaSourceId: SESSION_ID })).rejects.toThrow();
    });

    it('never verifies a session ticket for a movie or episode target, and does not spend it', async () => {
      const ticket = await service.mint('user-1', { mediaSourceId: SESSION_ID + 2 });

      await expect(service.verifyAndSpend(ticket.token, { movieId: SESSION_ID + 2 })).rejects.toBeInstanceOf(
        UploadTicketMismatchError,
      );
      await expect(service.verifyAndSpend(ticket.token, { episodeId: SESSION_ID + 2 })).rejects.toBeInstanceOf(
        UploadTicketMismatchError,
      );

      await expect(service.verifyAndSpend(ticket.token, { mediaSourceId: SESSION_ID + 2 })).resolves.toEqual({
        userId: 'user-1',
        force: false,
      });
    });

    it('never verifies a movie or episode ticket for a session target, and does not spend it', async () => {
      const movieTicket = await service.mint('user-1', { movieId: SESSION_ID + 3 });
      const episodeTicket = await service.mint('user-1', { episodeId: SESSION_ID + 3 });

      await expect(service.verifyAndSpend(movieTicket.token, { mediaSourceId: SESSION_ID + 3 })).rejects.toMatchObject({
        target: 'session',
      });
      await expect(service.verifyAndSpend(episodeTicket.token, { mediaSourceId: SESSION_ID + 3 })).rejects.toMatchObject({
        target: 'session',
      });

      await expect(service.verifyAndSpend(movieTicket.token, { movieId: SESSION_ID + 3 })).resolves.toBeDefined();
      await expect(service.verifyAndSpend(episodeTicket.token, { episodeId: SESSION_ID + 3 })).resolves.toBeDefined();
    });
  });
});
