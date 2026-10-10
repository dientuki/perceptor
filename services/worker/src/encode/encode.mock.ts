import { mkdir, copyFile, chmod, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EncodeFn } from './types';
import { EncodeCancelledError } from './cancellation';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWorkingPath(output: string): string {
  return output.replace(/(\.[^./]+)$/, '.working$1');
}

const STEPS = 10;

export const encodeMock: EncodeFn = async (input, output, _details, onProgress, _onProbe, signal) => {
  if (signal.aborted) {
    throw new EncodeCancelledError();
  }

  const workingPath = toWorkingPath(output);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(input, workingPath);
  await chmod(workingPath, 0o664);

  const totalMs = Number(process.env.ENCODE_MOCK_SECONDS ?? 5) * 1000;
  for (let step = 1; step <= STEPS; step++) {
    await sleep(totalMs / STEPS);
    if (signal.aborted) {
      throw new EncodeCancelledError();
    }
    // Spec 053, NFR-3
    await onProgress(Math.round((step / STEPS) * 100), null);
  }

  return { ffmpegCommand: `[mock] cp "${input}" "${output}"` };
};
