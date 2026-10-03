import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({}),
}));

import { runFfmpeg } from './runner';

class FakeChild extends EventEmitter {
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    return true;
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Defends against Docker's shutdown signal being silently ignored: Docker
// sends SIGTERM on `docker compose stop`/`restart`, never SIGINT, so a
// runner that only listens for SIGINT leaves the FFmpeg child process alive
// after its own container has already exited — a core burns indefinitely
// with the job gone from the queue and no error in any log (the orphaned
// `ffmpeg`/`mkvmerge` this used to leave behind). Both signals must be
// registered, and each one must kill whichever child is currently running.
describe('runFfmpeg — shutdown signal handling', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    spawnMock.mockReset();
  });

  it('registers a handler for both SIGTERM and SIGINT', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');

    const signal = new AbortController().signal;
    void runFfmpeg(['-i', 'in.mkv'], '/tmp/in.working.mkv', '/tmp/out.part.mkv', '/tmp/out.mkv', 100, vi.fn(), signal);
    await flush();

    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1);
  });

  it('kills the active ffmpeg child on SIGTERM', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const signal = new AbortController().signal;
    void runFfmpeg(['-i', 'in.mkv'], '/tmp/in.working.mkv', '/tmp/out.part.mkv', '/tmp/out.mkv', 100, vi.fn(), signal);
    await flush();

    process.emit('SIGTERM' as any);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills the active ffmpeg child on SIGINT', async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    const signal = new AbortController().signal;
    void runFfmpeg(['-i', 'in.mkv'], '/tmp/in.working.mkv', '/tmp/out.part.mkv', '/tmp/out.mkv', 100, vi.fn(), signal);
    await flush();

    process.emit('SIGINT' as any);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
