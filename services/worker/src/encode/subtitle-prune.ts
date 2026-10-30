import { EncodeCancelledError } from './cancellation';
import type { SubtitleFormat } from './subtitle-formats';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { normalizeIso3 } from '../ffmpeg/iso639';
import { isImageSubtitle, selectSubtitleStreams } from '../ffmpeg/params';
import {
  annotationShare,
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

// Spec 102, REQ-3
function qualifyingGroups(metadata: any, details: SubtitlePruneDetails): Group[] {
  const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const subtitles = streams.filter((s) => s?.codec_type === 'subtitle');
  const { selected } = selectSubtitleStreams(
    subtitles,
    details.allowedSubtitleFormats,
    details.allowedSubtitleLanguagesIso3,
    details.allowedSubtitleLanguageTags ?? [],
  );

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

// Spec 102, REQ-1 REQ-3 REQ-4 REQ-13 NFR-1 NFR-3
export async function resolveSubtitlePruning(
  details: SubtitlePruneDetails,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<ReadonlySet<number>> {
  const groups = qualifyingGroups(metadata, details);
  if (groups.length === 0) return new Set();

  // Spec 111, REQ-4
  const base = await fileIdentity(input);
  const identity = base
    ? { ...base, streams: groups.flatMap((g) => g.streams.map((s) => s.index as number)).sort((a, b) => a - b) }
    : null;
  const stored = await readVerdict<number[]>('subs', identity);
  if (Array.isArray(stored)) {
    console.log(`[subs] reused drops=[${stored.join(',')}]`);
    return new Set(stored);
  }

  try {
    const streams = groups.flatMap((g) => g.streams);
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

    const drops = new Set<number>();
    const lines: string[] = [];
    for (const group of groups) {
      const tracks = group.streams.map((s) => samples.get(s.index)!);
      const verdicts = pruneLanguage(tracks);
      const parts = tracks.map((t) => {
        const verdict = verdicts.get(t.index)!;
        if (!('keep' in verdict)) drops.add(t.index);
        const share = annotationShare(t.cues);
        const shown = share === null ? 'n/a' : `${(share * 100).toFixed(1)}%`;
        return `${t.index}:${t.cues.length}:${shown}=${outcome(verdict)}`;
      });
      lines.push(`[subs] ${group.lang} ${parts.join(' ')}`);
    }

    await writeVerdict('subs', identity, [...drops].sort((a, b) => a - b));
    lines.forEach((line) => console.log(line));
    return drops;
  } catch (error) {
    if (error instanceof EncodeCancelledError) throw error;
    console.log(`[subs] read failed: ${error instanceof Error ? error.message : String(error)}`);
    return new Set();
  }
}
