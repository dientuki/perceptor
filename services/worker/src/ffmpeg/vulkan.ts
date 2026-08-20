// src/ffmpeg/vulkan.ts
//
// Runtime detection of a usable Vulkan device, once per process (NFR-1).
// Follows metadata.ts's promisify(execFile) pattern deliberately, not
// runner.ts's spawn/signal-handling machinery — that one exists to survive
// hours-long jobs and is pure overhead for a sub-second probe. execFile, no
// exec: no shell involved, so there is nothing to inject even though the
// probe here takes no user-controlled input.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type VulkanReason = 'forced-off' | 'no-device' | 'available';

export interface VulkanProbeResult {
  available: boolean;
  reason: VulkanReason;
}

// A software rasterizer answering the Vulkan API as if it were a GPU is the
// worst outcome this probe can produce (see ../../docs/spec/features/017-worker-gpu-strategy/plan.md
// § Risks, first row): libplacebo would "work" but run an order of magnitude
// slower than the zscale fallback it displaced, with nothing in any log
// saying so.
const SOFTWARE_RASTERIZER_NAMES = ['llvmpipe', 'lavapipe', 'swiftshader'];

// Verified-working invocation on the reference host (see worker/plan.md
// step 1): initializes Vulkan against a tiny synthetic frame and exits.
const PROBE_ARGS = [
  '-hide_banner',
  '-loglevel', 'verbose',
  '-init_hw_device', 'vulkan=vk',
  '-f', 'lavfi',
  '-i', 'testsrc=size=64x64:duration=0.1',
  '-f', 'null',
  '-',
];

// A wedged driver must not hang the boot (NFR-2) — an explicit timeout so a
// bad probe degrades to the CPU path instead of leaving the worker starting
// forever with both queues unconsumed.
const PROBE_TIMEOUT_MS = 10_000;

let memoized: VulkanProbeResult | null = null;

export async function probeVulkan(): Promise<VulkanProbeResult> {
  // Exactly the string "false" opts out without spawning anything — see
  // ../../docs/spec/features/017-worker-gpu-strategy/plan.md § Contract
  // Freeze. Not case-insensitive, not "0", not "no": the infra side parses
  // the same variable identically, and drifting here creates a state where
  // the overlay is attached but the worker silently refuses to use it.
  if (process.env.USE_GPU === 'false') {
    const result: VulkanProbeResult = { available: false, reason: 'forced-off' };
    memoized = result;
    return result;
  }

  try {
    const { stderr } = await execFileAsync('ffmpeg', PROBE_ARGS, {
      timeout: PROBE_TIMEOUT_MS,
    });

    const output = stderr ?? '';
    const isSoftware = SOFTWARE_RASTERIZER_NAMES.some((name) =>
      output.toLowerCase().includes(name),
    );

    const result: VulkanProbeResult = isSoftware
      ? { available: false, reason: 'no-device' }
      : { available: true, reason: 'available' };
    memoized = result;
    return result;
  } catch (error) {
    // Non-zero exit, thrown error, or a timeout (execFile throws on timeout
    // too) all resolve to "no-device" — never a rejection that escapes
    // startup (NFR-2). The opposite choice yields a worker that fails every
    // 4K HDR encode on hardware where the CPU path would have worked.
    const result: VulkanProbeResult = { available: false, reason: 'no-device' };
    memoized = result;
    return result;
  }
}

// Synchronous getter the rest of the service reads. Returns false if the
// probe hasn't run yet, so a code path that forgets to await probeVulkan()
// at startup degrades to CPU rather than crashing.
export function isVulkanAvailable(): boolean {
  return memoized?.available ?? false;
}
