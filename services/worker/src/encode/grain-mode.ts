// The worker-local GrainMode union, mirroring api's EffectiveGrainMode GraphQL
// enum (`AUTO` | `ON` | `OFF`) without importing it — same reasoning as
// `ContentKind` in `content-kind.ts`: this service retypes the shape it needs
// rather than coupling to the full query result. `INHERIT` (api's GrainMode
// enum, never on the wire here) is deliberately absent from this union — see
// `normalizeGrainMode` below.

import type { EncodeInput } from './types';
import { EncodeCancelledError } from './cancellation';
import { scoreGrainGate } from './grain-gate';
import { GRAIN_PROBE_SAVED_MBPS_THRESHOLD, probeGrainSaving } from './grain-probe';

export type GrainMode = 'AUTO' | 'ON' | 'OFF';

export const GRAIN_MODE_VALUES: readonly GrainMode[] = ['AUTO', 'ON', 'OFF'];

function isGrainMode(value: string): value is GrainMode {
  return (GRAIN_MODE_VALUES as readonly string[]).includes(value);
}

// The one place in this service where a missing payload field is deliberately
// defended rather than left to fail loudly (see worker/plan.md's Contract
// obligations). An absent, null or unrecognised value — including the literal
// `INHERIT`, which api must never send on EncodeJobDetails.grainMode and which
// this service must never try to resolve itself — degrades to `OFF` and logs
// once. It must never throw.
export function normalizeGrainMode(raw: string | null | undefined): GrainMode {
  if (raw != null && isGrainMode(raw)) {
    return raw;
  }

  console.warn(`[grain] unrecognised grainMode ${JSON.stringify(raw)}, defaulting to OFF`);
  return 'OFF';
}

// Spec 094, REQ-9
const verdictCache = new Map<number, boolean>();

export function resetGrainVerdictCache(): void {
  verdictCache.clear();
}

// Spec 092, REQ-9; Spec 094, REQ-2 REQ-9 REQ-10 REQ-11 NFR-1
export async function resolveFilmGrain(
  details: EncodeInput,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<boolean> {
  const mode = details.grainMode;
  const id = details.mediaSourceId;

  if (mode === 'ON' || mode === 'OFF') {
    const filmGrain = mode === 'ON';
    console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=mode -> filmGrain=${filmGrain}`);
    return filmGrain;
  }

  const cached = verdictCache.get(id);
  if (cached !== undefined) {
    console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=cache -> filmGrain=${cached} (reused)`);
    return cached;
  }

  try {
    const gate = scoreGrainGate(metadata, input, details.year);
    const gateText = `gateScore=${gate.score} reasons=${JSON.stringify(gate.reasons)}`;

    if (!gate.passed) {
      verdictCache.set(id, false);
      console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=gate ${gateText} -> filmGrain=false`);
      return false;
    }

    if (details.isShort) {
      verdictCache.set(id, false);
      console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=short ${gateText} -> filmGrain=false`);
      return false;
    }

    console.log(`[grain] mediaSourceId=${id} mode=${mode} probe starting ${gateText}`);
    const probe = await probeGrainSaving(input, metadata, details.contentKind, signal);
    verdictCache.set(id, probe.passed);
    console.log(
      `[grain] mediaSourceId=${id} mode=${mode} stage=probe ${gateText} ` +
        `mbpsGrain0=${probe.mbpsGrain0.toFixed(3)} savingPct=${probe.savingPct.toFixed(2)} ` +
        `savedMbps=${probe.savedMbps.toFixed(3)} threshold=${GRAIN_PROBE_SAVED_MBPS_THRESHOLD} ` +
        `-> filmGrain=${probe.passed}`,
    );
    return probe.passed;
  } catch (error) {
    if (error instanceof EncodeCancelledError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[grain] mediaSourceId=${id} mode=${mode} stage=failure ${detail} -> filmGrain=false`);
    return false;
  }
}

// Spec 094, REQ-1
export function normalizeIsShort(raw: unknown): boolean {
  if (typeof raw === 'boolean') {
    return raw;
  }

  console.warn(`[grain] unrecognised isShort ${JSON.stringify(raw)}, defaulting to false`);
  return false;
}
