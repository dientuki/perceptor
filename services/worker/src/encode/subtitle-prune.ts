import { decide } from './audio-variant-score';
import { EncodeCancelledError } from './cancellation';
import type { SubtitleFormat } from './subtitle-formats';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import {
  AUDIO_VARIANT_DETECTORS,
  type AudioVariantDetector,
} from './variant-detectors';
import { decideAbsolute, SUBTITLE_DECISION_MARGIN } from './variant-score';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { normalizeIso3 } from '../ffmpeg/iso639';
import { isImageSubtitle, selectSubtitleStreams } from '../ffmpeg/params';
import { detectVariant } from '../ffmpeg/variants';
import {
  annotationShare,
  normalizeCueText,
  parseSrt,
  pruneLanguage,
  SUBTITLE_SAMPLE_SECONDS,
  type TrackSample,
  type Verdict,
} from '../ffmpeg/subtitle-content';

export interface SubtitlePruneDetails {
  allowedSubtitleFormats: SubtitleFormat[];
  allowedSubtitleLanguagesIso3: string[];
  allowedSubtitleLanguageTags?: string[];
  subtitleVariantDetection?: boolean;
}

export interface SubtitlePruning {
  drops: ReadonlySet<number>;
  variants: ReadonlyMap<number, string>;
}

// Spec 102, REQ-4
export function buildSubtitleSampleArgs(input: string, indices: number[]): string[] {
  const args = ['-v', 'error', '-nostdin', '-i', input];
  indices.forEach((index, k) => {
    args.push('-map', `0:${index}`, '-t', String(SUBTITLE_SAMPLE_SECONDS), '-c:s', 'srt', '-f', 'srt', `pipe:${3 + k}`);
  });
  return args;
}

type Group = { lang: string; streams: any[] };

function selectedStreams(metadata: any, details: SubtitlePruneDetails): any[] {
  const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const subtitles = streams.filter((s) => s?.codec_type === 'subtitle');
  return selectSubtitleStreams(
    subtitles,
    details.allowedSubtitleFormats,
    details.allowedSubtitleLanguagesIso3,
    details.allowedSubtitleLanguageTags ?? [],
  ).selected;
}

// Spec 102, REQ-3
function qualifyingGroups(selected: any[]): Group[] {
  const byLang = new Map<string, any[]>();
  for (const s of selected) {
    if (isImageSubtitle(s)) continue;
    const lang = normalizeIso3(s.tags?.language || '');
    byLang.set(lang, [...(byLang.get(lang) ?? []), s]);
  }
  return [...byLang.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([lang, group]) => ({ lang, streams: group }));
}

function wholeCueCount(stream: any): number | undefined {
  const raw = stream.tags?.NUMBER_OF_FRAMES;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function outcome(verdict: Verdict): string {
  if ('keep' in verdict) return 'keep';
  if (verdict.drop === 'sdh') return 'drop (sdh)';
  if (verdict.drop === 'same') return `drop (same as ${verdict.as})`;
  return `drop (contained in ${verdict.in})`;
}

type VariantUnit = { detector: AudioVariantDetector; indices: number[] };
type StoredVariant = { tags: Record<string, string> } | { undecided: true };

// Spec 118, REQ-5
function unresolvedByDetector(selected: any[]): { detector: AudioVariantDetector; streams: any[] }[] {
  return AUDIO_VARIANT_DETECTORS.map((detector) => ({
    detector,
    streams: selected.filter(
      (s) =>
        !isImageSubtitle(s) &&
        normalizeIso3(s.tags?.language || '') === detector.iso3 &&
        detectVariant(s) === undefined,
    ),
  })).filter((entry) => entry.streams.length > 0);
}

// Spec 118, REQ-6 REQ-6b
function buildUnits(
  candidates: { detector: AudioVariantDetector; streams: any[] }[],
  drops: ReadonlySet<number>,
): VariantUnit[] {
  const units: VariantUnit[] = [];
  for (const { detector, streams } of candidates) {
    const kept = streams.map((s) => s.index as number).filter((i) => !drops.has(i)).sort((a, b) => a - b);
    if (kept.length === 2) units.push({ detector, indices: kept });
    else kept.forEach((i) => units.push({ detector, indices: [i] }));
  }
  return units;
}

function validStored(value: unknown, unit: VariantUnit): StoredVariant | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { tags?: unknown; undecided?: unknown };
  if (candidate.undecided === true) return { undecided: true };
  const tags = candidate.tags;
  if (!tags || typeof tags !== 'object') return undefined;
  const record = tags as Record<string, unknown>;
  const entries = unit.indices.map((i) => record[String(i)]);
  if (!entries.every((tag) => typeof tag === 'string')) return undefined;
  return { tags: Object.fromEntries(unit.indices.map((i) => [String(i), record[String(i)] as string])) };
}

function sampleText(sample: TrackSample): string {
  return sample.cues.map((cue) => normalizeCueText(cue.text)).join('\n');
}

// Spec 118, REQ-5 REQ-6 REQ-6b REQ-7 REQ-8 REQ-9 REQ-10 REQ-11 NFR-1 NFR-3
export async function resolveSubtitlePruning(
  details: SubtitlePruneDetails,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<SubtitlePruning> {
  const selected = selectedStreams(metadata, details);
  const groups = qualifyingGroups(selected);
  const candidates = details.subtitleVariantDetection === true ? unresolvedByDetector(selected) : [];
  if (groups.length === 0 && candidates.length === 0) return { drops: new Set(), variants: new Map() };

  // Spec 111, REQ-4
  const base = await fileIdentity(input);
  const dropsIdentity =
    base && groups.length > 0
      ? { ...base, streams: groups.flatMap((g) => g.streams.map((s) => s.index as number)).sort((a, b) => a - b) }
      : null;
  const variantIdentity = (unit: VariantUnit) =>
    base ? { ...base, iso3: unit.detector.iso3, streams: unit.indices } : null;

  let drops: Set<number> | null = null;
  if (groups.length === 0) {
    drops = new Set();
  } else {
    const stored = await readVerdict<number[]>('subs', dropsIdentity);
    if (Array.isArray(stored)) {
      console.log(`[subs] reused drops=[${stored.join(',')}]`);
      drops = new Set(stored);
    }
  }

  const variants = new Map<number, string>();
  const verdicts = new Map<VariantUnit, StoredVariant>();
  let units: VariantUnit[] = [];

  const loadVariantVerdicts = async (dropSet: ReadonlySet<number>): Promise<VariantUnit[]> => {
    units = buildUnits(candidates, dropSet);
    const missing: VariantUnit[] = [];
    for (const unit of units) {
      const hit = validStored(await readVerdict<unknown>('subtitle-variant', variantIdentity(unit)), unit);
      if (hit) {
        verdicts.set(unit, hit);
        logVariant(unit, hit, true);
      } else {
        missing.push(unit);
      }
    }
    return missing;
  };

  const apply = () => {
    for (const verdict of verdicts.values()) {
      if ('tags' in verdict) for (const [index, tag] of Object.entries(verdict.tags)) variants.set(Number(index), tag);
    }
  };

  let missing: VariantUnit[] = [];
  const needed = new Map<number, any>();
  if (drops) {
    missing = await loadVariantVerdicts(drops);
    for (const unit of missing) {
      for (const index of unit.indices) {
        const stream = candidates.flatMap((c) => c.streams).find((s) => s.index === index);
        if (stream) needed.set(index, stream);
      }
    }
  } else {
    for (const g of groups) for (const s of g.streams) needed.set(s.index, s);
    for (const c of candidates) for (const s of c.streams) needed.set(s.index, s);
  }

  if (drops && needed.size === 0) {
    apply();
    return { drops, variants };
  }

  try {
    const streams = [...needed.values()];
    const result = await runFfmpegCapture(
      buildSubtitleSampleArgs(
        input,
        streams.map((s) => s.index),
      ),
      signal,
      { extraOutputs: streams.length },
    );
    if (result.code !== 0) throw new Error(`ffmpeg subtitle read exited with ${result.code}`);
    const outputs = result.outputs ?? [];
    if (outputs.length !== streams.length) throw new Error('subtitle read returned a missing output');

    const samples = new Map<number, TrackSample>();
    streams.forEach((s, k) => {
      samples.set(s.index, {
        index: s.index,
        cues: parseSrt(outputs[k]),
        wholeCueCount: wholeCueCount(s),
        isDefault: s.disposition?.default === 1,
      });
    });

    const pending: string[] = [];
    if (!drops) {
      const computed = new Set<number>();
      for (const group of groups) {
        const tracks = group.streams.map((s) => samples.get(s.index)!);
        const pruned = pruneLanguage(tracks);
        const parts = tracks.map((t) => {
          const verdict = pruned.get(t.index)!;
          if (!('keep' in verdict)) computed.add(t.index);
          const share = annotationShare(t.cues);
          const shown = share === null ? 'n/a' : `${(share * 100).toFixed(1)}%`;
          return `${t.index}:${t.cues.length}:${shown}=${outcome(verdict)}`;
        });
        pending.push(`[subs] ${group.lang} ${parts.join(' ')}`);
      }
      await writeVerdict('subs', dropsIdentity, [...computed].sort((a, b) => a - b));
      pending.forEach((line) => console.log(line));
      drops = computed;
      missing = await loadVariantVerdicts(drops);
    }

    for (const unit of missing) {
      const texts = unit.indices.map((i) => sampleText(samples.get(i)!));
      let verdict: StoredVariant = { undecided: true };
      if (unit.indices.length === 2) {
        const outcomePair = decide(
          [
            { index: unit.indices[0], text: texts[0] },
            { index: unit.indices[1], text: texts[1] },
          ],
          unit.detector,
          SUBTITLE_DECISION_MARGIN,
        );
        if (outcomePair.kind === 'decided') {
          verdict = { tags: { ...outcomePair.tags } };
        }
      } else {
        const tag = decideAbsolute(texts[0], unit.detector);
        if (tag !== null) verdict = { tags: { [String(unit.indices[0])]: tag } };
      }
      verdicts.set(unit, verdict);
      await writeVerdict('subtitle-variant', variantIdentity(unit), verdict);
      logVariant(unit, verdict, false);
    }

    apply();
    return { drops, variants };
  } catch (error) {
    if (error instanceof EncodeCancelledError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (drops) {
      console.log(`[subvariant] detection failed: ${message}`);
      apply();
      return { drops, variants };
    }
    console.log(`[subs] read failed: ${message}`);
    return { drops: new Set(), variants: new Map() };
  }
}

function logVariant(unit: VariantUnit, verdict: StoredVariant, reused: boolean): void {
  const shown = 'tags' in verdict
    ? Object.entries(verdict.tags).map(([i, tag]) => `${i}=${tag}`).join(' ')
    : 'undecided';
  const names = unit.indices.join(' ');
  console.log(`[subvariant] ${unit.detector.iso3} ${names} \u2192 ${shown}${reused ? ' (reused)' : ''}`);
}
