const order: string[] = [];
let existing: { remove: jest.Mock } | null = null;
const addOpts: Array<{ name: string; data: unknown; opts: unknown }> = [];

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn((name: string, data: unknown, opts: unknown) => {
      order.push('add');
      addOpts.push({ name, data, opts });
      return Promise.resolve({ id: '1' });
    }),
    getJob: jest.fn((id: string) => {
      order.push(`get:${id}`);
      return Promise.resolve(existing);
    }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { SubtitleProbeQueueService } from './subtitle-probe-queue.service';

// BullMQ silently ignores an add whose jobId still exists, so a probe
// re-queued after a crash without removing the stale entry first is never run
// and the search sits WAITING with no error anywhere. This suite pins the
// jobId and the remove-before-add order the recovery relies on (Article IX,
// Spec 107, T005).
describe('SubtitleProbeQueueService', () => {
  beforeEach(() => {
    order.length = 0;
    addOpts.length = 0;
    existing = null;
  });

  it('adds a single-attempt job under a per-search id', async () => {
    await new SubtitleProbeQueueService().addProbe({ subtitleSearchId: 9 });
    expect(addOpts[0]).toEqual({
      name: 'subtitle-probe',
      data: { subtitleSearchId: 9 },
      opts: { jobId: 'subtitle-probe-9', attempts: 1 },
    });
  });

  it('removes the stale job before the new one is added', async () => {
    existing = {
      remove: jest.fn(() => {
        order.push('remove');
        return Promise.resolve();
      }),
    };
    const service = new SubtitleProbeQueueService();
    await service.removeProbe(9);
    await service.addProbe({ subtitleSearchId: 9 });
    expect(order).toEqual(['get:subtitle-probe-9', 'remove', 'add']);
  });

  it('does nothing when there is no job, and survives a locked one', async () => {
    const service = new SubtitleProbeQueueService();
    await expect(service.removeProbe(9)).resolves.toBeUndefined();
    existing = { remove: jest.fn().mockRejectedValue(new Error('locked')) };
    await expect(service.removeProbe(9)).resolves.toBeUndefined();
  });
});
