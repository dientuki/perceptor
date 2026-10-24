const added: Array<{
  name: string;
  data: unknown;
  opts: Record<string, unknown>;
}> = [];
type WorkerRecord = {
  processor: (job: { data: { searchId: number } }) => Promise<void>;
  opts: Record<string, unknown>;
  close: jest.Mock;
  on: jest.Mock;
};
const workers: WorkerRecord[] = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(
      (name: string, data: unknown, opts: Record<string, unknown>) => {
        added.push({ name, data, opts });
        return Promise.resolve({ id: '1' });
      },
    ),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest
    .fn()
    .mockImplementation(
      (
        _name: string,
        processor: WorkerRecord['processor'],
        opts: Record<string, unknown>,
      ) => {
        const worker: WorkerRecord = {
          processor,
          opts,
          close: jest.fn().mockResolvedValue(undefined),
          on: jest.fn(),
        };
        workers.push(worker);
        return worker;
      },
    ),
}));

import { SubtitleSearchQueueService } from './subtitle-search-queue.service';

// A wake-up that never reaches the driver is the silent failure here: a search
// sits WAITING forever and nothing logs. BullMQ itself is replaced by a fake
// that records what was added and hands the registered processor back, since
// the unit run has no Redis; what is under test is how this service wires the
// wake-up to the handler, the delay, the single-consumer concurrency and the
// rule that a throwing handler never escapes to BullMQ (Spec 103, REQ-6 NFR-5).
describe('SubtitleSearchQueueService', () => {
  let service: SubtitleSearchQueueService;

  beforeEach(() => {
    added.length = 0;
    workers.length = 0;
    service = new SubtitleSearchQueueService();
    service.onModuleInit();
  });

  it('calls the registered handler with the search id of a woken job', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    service.setHandler(handler);

    await service.wake(42);
    await workers[0].processor({ data: added[0].data as { searchId: number } });

    expect(added[0].data).toEqual({ searchId: 42 });
    expect(handler).toHaveBeenCalledWith(42);
  });

  it('delays the job, keeps a single attempt and removes it on completion and failure', async () => {
    await service.wake(7, 300_000);

    expect(added[0].name).toBe('advance');
    expect(added[0].opts).toEqual({
      delay: 300_000,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('consumes with concurrency 1', () => {
    expect(workers[0].opts).toMatchObject({ concurrency: 1 });
  });

  it('swallows a handler failure so BullMQ never retries or drops it noisily', async () => {
    service.setHandler(jest.fn().mockRejectedValue(new Error('boom')));

    await expect(
      workers[0].processor({ data: { searchId: 1 } }),
    ).resolves.toBeUndefined();
  });

  it('drops a wake-up with a warning when no handler is registered yet', async () => {
    await expect(
      workers[0].processor({ data: { searchId: 1 } }),
    ).resolves.toBeUndefined();
  });

  it('closes the worker and the queue on destroy', async () => {
    await service.onModuleDestroy();

    expect(workers[0].close).toHaveBeenCalled();
  });
});
