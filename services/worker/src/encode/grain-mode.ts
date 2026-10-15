// The worker-local GrainMode union, mirroring api's EffectiveGrainMode GraphQL
// enum (`AUTO` | `ON` | `OFF`) without importing it — same reasoning as
// `ContentKind` in `content-kind.ts`: this service retypes the shape it needs
// rather than coupling to the full query result. `INHERIT` (api's GrainMode
// enum, never on the wire here) is deliberately absent from this union — see
// `normalizeGrainMode` below.

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

// Spec 092, REQ-9
export function resolveFilmGrain(mode: GrainMode, metadata: unknown): boolean {
  const filmGrain = mode === 'ON';

  console.log(`[grain] resolved grainMode=${mode} -> filmGrain=${filmGrain}`);

  return filmGrain;
}
