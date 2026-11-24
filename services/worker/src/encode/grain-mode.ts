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
import { readVerdict, writeVerdict } from './verdict-store';

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

export type GrainDecidedBy = 'title' | 'gate' | 'short' | 'probe';

export interface GrainResolution {
  filmGrain: boolean;
  decidedBy?: GrainDecidedBy;
}

const DECIDED_BY_VALUES: readonly string[] = ['title', 'gate', 'short', 'probe'];

interface StoredGrainVerdict {
  filmGrain: boolean;
  decidedBy?: GrainDecidedBy;
}

// Spec 123, REQ-6
function readStored(cached: unknown): GrainResolution | undefined {
  if (typeof cached === 'boolean') {
    return { filmGrain: cached };
  }
  if (cached !== null && typeof cached === 'object') {
    const { filmGrain, decidedBy } = cached as Record<string, unknown>;
    if (typeof filmGrain === 'boolean') {
      return typeof decidedBy === 'string' && DECIDED_BY_VALUES.includes(decidedBy)
        ? { filmGrain, decidedBy: decidedBy as GrainDecidedBy }
        : { filmGrain };
    }
  }
  return undefined;
}

// Spec 092, REQ-9; Spec 094, REQ-2 REQ-9 REQ-10 REQ-11 NFR-1; Spec 111, REQ-1; Spec 123, REQ-6
export async function resolveFilmGrain(
  details: EncodeInput,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<GrainResolution> {
  const mode = details.grainMode;
  const id = details.mediaSourceId;

  if (mode === 'ON' || mode === 'OFF') {
    const filmGrain = mode === 'ON';
    console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=mode -> filmGrain=${filmGrain}`);
    return filmGrain ? { filmGrain, decidedBy: 'title' } : { filmGrain };
  }

  const identity = { mediaSourceId: id };
  const cached = readStored(await readVerdict<unknown>('grain', identity));
  if (cached !== undefined) {
    console.log(
      `[grain] mediaSourceId=${id} mode=${mode} stage=cache -> filmGrain=${cached.filmGrain} (reused)`,
    );
    return cached;
  }

  const store = async (verdict: StoredGrainVerdict): Promise<GrainResolution> => {
    await writeVerdict('grain', identity, verdict);
    return verdict;
  };

  try {
    const gate = scoreGrainGate(metadata, input, details.year);
    const gateText = `gateScore=${gate.score} reasons=${JSON.stringify(gate.reasons)}`;

    if (!gate.passed) {
      const verdict = await store({ filmGrain: false, decidedBy: 'gate' });
      console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=gate ${gateText} -> filmGrain=false`);
      return verdict;
    }

    if (details.isShort) {
      const verdict = await store({ filmGrain: false, decidedBy: 'short' });
      console.log(`[grain] mediaSourceId=${id} mode=${mode} stage=short ${gateText} -> filmGrain=false`);
      return verdict;
    }

    console.log(`[grain] mediaSourceId=${id} mode=${mode} probe starting ${gateText}`);
    const probe = await probeGrainSaving(input, metadata, details.contentKind, signal);
    const verdict = await store({ filmGrain: probe.passed, decidedBy: 'probe' });
    console.log(
      `[grain] mediaSourceId=${id} mode=${mode} stage=probe ${gateText} ` +
        `mbpsGrain0=${probe.mbpsGrain0.toFixed(3)} savingPct=${probe.savingPct.toFixed(2)} ` +
        `savedMbps=${probe.savedMbps.toFixed(3)} threshold=${GRAIN_PROBE_SAVED_MBPS_THRESHOLD} ` +
        `-> filmGrain=${probe.passed}`,
    );
    return verdict;
  } catch (error) {
    if (error instanceof EncodeCancelledError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[grain] mediaSourceId=${id} mode=${mode} stage=failure ${detail} -> filmGrain=false`);
    return { filmGrain: false };
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
