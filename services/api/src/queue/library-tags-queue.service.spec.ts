const addCalls: Array<{ name: string; data: unknown; opts: { jobId: string } }> =
  [];

jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Queue: jest.fn().mockImplementation(() => ({
    getJob: jest.fn().mockResolvedValue(undefined),
    add: jest.fn((name: string, data: unknown, opts: { jobId: string }) => {
      addCalls.push({ name, data, opts });
      return Promise.resolve({ id: opts.jobId });
    }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { Job } from 'bullmq';
const fakeQueue = {
  toKey: (k: string) => k,
  qualifiedName: 'bull:library-tags',
  opts: {},
} as never;

const validate = (name: string, data: unknown, opts: { jobId: string }) => {
  const job = new Job(fakeQueue, name, data, opts) as unknown as {
    validateOptions(d: { data: string }): void;
  };
  job.validateOptions({ data: '{}' });
};

import { LibraryTagsQueueService } from './library-tags-queue.service';

// BullMQ rejects a custom jobId containing ':' (and a purely numeric one) when
// the job is added. The producer swallows every enqueue failure by design, so a
// bad id means every library tag migration item silently never reaches the
// worker and only a warning in the api log says why (Article IX, Spec 123).
// The id is validated here by BullMQ's own Job.validateOptions, not a copy of
// its rule.
describe('LibraryTagsQueueService', () => {
  beforeEach(() => {
    addCalls.length = 0;
  });

  it('enqueues with a jobId that BullMQ itself accepts', async () => {
    await new LibraryTagsQueueService().enqueue(67);
    expect(addCalls).toHaveLength(1);
    const { name, data, opts } = addCalls[0];
    expect(opts.jobId).toBe('library-tags-67');
    expect(() => validate(name, data, opts)).not.toThrow();
  });

  it('would have been rejected with the colon form (guards the validator itself)', () => {
    expect(() =>
      validate('library-tags', {}, { jobId: 'library-tags:67' }),
    ).toThrow('Custom Id cannot contain :');
  });
});
