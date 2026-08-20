// Defends src/ffmpeg/vulkan.ts against the USE_GPU semantic drift named in
// docs/spec/features/017-worker-gpu-strategy/plan.md § Contract Freeze and §
// Risks: the variable is read on both the worker side and the infra side
// with supposedly the same rule (exactly "false" opts out, everything else
// is auto). A worker that also treats "0"/"no"/case-insensitive "false" as
// opt-out ends up silently slower than the overlay it was given — no error
// anywhere. It also defends NFR-2: a probe that throws, times out or exits
// non-zero must degrade to the CPU path rather than reject out of process
// startup, which would otherwise fail every 4K HDR encode on a host where
// the CPU path would have worked fine.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_USE_GPU = process.env.USE_GPU;

function setUseGpu(value: string | undefined) {
  if (value === undefined) delete process.env.USE_GPU;
  else process.env.USE_GPU = value;
}

afterEach(() => {
  setUseGpu(ORIGINAL_USE_GPU);
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

describe('probeVulkan — USE_GPU opt-out parse', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves forced-off without spawning anything when USE_GPU is exactly "false"', async () => {
    setUseGpu('false');
    const execFile = vi.fn();
    vi.doMock('node:child_process', () => ({ execFile }));

    const { probeVulkan } = await import('./vulkan.js');
    const result = await probeVulkan();

    expect(result).toEqual({ available: false, reason: 'forced-off' });
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(['true', undefined, 'False', '0', 'no'])(
    'falls through to probing when USE_GPU is %j',
    async (value) => {
      setUseGpu(value);
      const execFile = vi.fn((_cmd, _args, _opts, callback) => {
        callback(null, { stdout: '', stderr: 'Using device: Intel(R) UHD Graphics' });
      });
      vi.doMock('node:child_process', () => ({ execFile }));

      const { probeVulkan } = await import('./vulkan.js');
      const result = await probeVulkan();

      expect(execFile).toHaveBeenCalled();
      expect(result.reason).toBe('available');
      expect(result.available).toBe(true);
    },
  );
});

describe('probeVulkan — failure and software-rasterizer handling (NFR-2)', () => {
  beforeEach(() => {
    vi.resetModules();
    setUseGpu(undefined);
  });

  it('resolves unusable rather than throwing when ffmpeg exits non-zero', async () => {
    const execFile = vi.fn((_cmd, _args, _opts, callback) => {
      callback(new Error('Command failed with exit code 1'), null);
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    const { probeVulkan } = await import('./vulkan.js');

    await expect(probeVulkan()).resolves.toEqual({ available: false, reason: 'no-device' });
  });

  it('resolves unusable rather than throwing when the probe times out', async () => {
    const execFile = vi.fn((_cmd, _args, _opts, callback) => {
      const err = Object.assign(new Error('ETIMEDOUT'), { killed: true, signal: 'SIGTERM' });
      callback(err, null);
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    const { probeVulkan } = await import('./vulkan.js');

    await expect(probeVulkan()).resolves.toEqual({ available: false, reason: 'no-device' });
  });

  it('resolves unusable when the selected device is a software rasterizer (llvmpipe)', async () => {
    const execFile = vi.fn((_cmd, _args, _opts, callback) => {
      callback(null, { stdout: '', stderr: 'Using device: llvmpipe (LLVM 17.0.0, 256 bits)' });
    });
    vi.doMock('node:child_process', () => ({ execFile }));

    const { probeVulkan } = await import('./vulkan.js');

    await expect(probeVulkan()).resolves.toEqual({ available: false, reason: 'no-device' });
  });
});

describe('isVulkanAvailable', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns false before any probe has run', async () => {
    const { isVulkanAvailable } = await import('./vulkan.js');

    expect(isVulkanAvailable()).toBe(false);
  });
});
