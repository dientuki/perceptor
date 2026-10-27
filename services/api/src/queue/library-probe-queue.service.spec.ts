const addCalls: Array<{ name: string; data: unknown; opts: unknown }> = [];
let addImpl: () => Promise<unknown> = () => Promise.resolve({ id: '1' });

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn((name: string, data: unknown, opts: unknown) => {
      addCalls.push({ name, data, opts });
      return addImpl();
    }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { LibraryProbeQueueService } from './library-probe-queue.service';

// A library probe is requested from a read path. If the enqueue threw, a Redis
// blip would fail the page that asked; if the job kept its id after finishing
// (no removeOnComplete/removeOnFail), BullMQ would silently ignore every later
// request for that title and its tracks would never refresh, with no error
// anywhere (Article IX, Spec 108, T003).
describe('LibraryProbeQueueService', () => {
  beforeEach(() => {
    addCalls.length = 0;
    addImpl = () => Promise.resolve({ id: '1' });
  });

  it('uses a per-movie job id', async () => {
    await new LibraryProbeQueueService().request({ movieId: 4 });
    expect(addCalls[0].name).toBe('library-probe');
    expect(addCalls[0].data).toEqual({ movieId: 4 });
    expect(addCalls[0].opts).toMatchObject({ jobId: 'library-probe-movie-4' });
  });

  it('uses a per-episode job id', async () => {
    await new LibraryProbeQueueService().request({ episodeId: 7 });
    expect(addCalls[0].opts).toMatchObject({
      jobId: 'library-probe-episode-7',
    });
  });

  it('frees the job id after completion or failure and does not retry', async () => {
    await new LibraryProbeQueueService().request({ movieId: 1 });
    expect(addCalls[0].opts).toEqual({
      jobId: 'library-probe-movie-1',
      attempts: 1,
      removeOnComplete: true,

      removeOnFail: true,
    });
  });

  it('swallows an enqueue failure', async () => {
    addImpl = () => Promise.reject(new Error('redis down'));
    await expect(
      new LibraryProbeQueueService().request({ movieId: 1 }),
    ).resolves.toBeUndefined();
  });
});
