import { normalizeIso3 } from '../ffmpeg/iso639';

export interface VerifyStream {
  codec_type?: string;
  codec_name?: string;
  tags?: { language?: string };
  disposition?: { default?: number; forced?: number };
}

export interface VerifyMetadata {
  streams?: VerifyStream[];
  format?: { duration?: string | number };
}

export interface VerifyTrack {
  languageIso3: string;
  isDefault: boolean;
  isForced: boolean;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const MAX_DRIFT_SECONDS = 1;

const lang = (stream: VerifyStream) => normalizeIso3(stream.tags?.language ?? '');
const fail = (reason: string): VerifyResult => ({ ok: false, reason });

// Spec 101, REQ-9 REQ-10
export function verifyEmbed(
  original: VerifyMetadata,
  result: VerifyMetadata,
  tracks: VerifyTrack[],
): VerifyResult {
  const before = original.streams ?? [];
  const after = result.streams ?? [];

  if (after.length !== before.length + tracks.length) {
    return fail(`expected ${before.length + tracks.length} streams, found ${after.length}`);
  }

  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (
      a.codec_type !== b.codec_type ||
      a.codec_name !== b.codec_name ||
      lang(a) !== lang(b)
    ) {
      return fail(`original stream ${i} changed`);
    }
  }

  for (let i = 0; i < tracks.length; i++) {
    const stream = after[before.length + i];
    const wanted = tracks[i];
    if (stream.codec_type !== 'subtitle') {
      return fail(`stream ${before.length + i} is not a subtitle`);
    }
    if (lang(stream) !== normalizeIso3(wanted.languageIso3)) {
      return fail(`new track ${i} has language ${lang(stream) || '(none)'}`);
    }
    if (Boolean(stream.disposition?.forced) !== wanted.isForced) {
      return fail(`new track ${i} has the wrong forced flag`);
    }
  }

  const drift = Math.abs(Number(original.format?.duration) - Number(result.format?.duration));
  if (!Number.isFinite(drift) || drift > MAX_DRIFT_SECONDS) {
    return fail('duration differs from the original by more than 1 s');
  }

  const defaultIndex = tracks.findIndex((track) => track.isDefault);
  if (defaultIndex !== -1) {
    const defaults = after
      .map((stream, i) => (stream.codec_type === 'subtitle' && stream.disposition?.default ? i : -1))
      .filter((i) => i !== -1);
    if (defaults.length !== 1 || defaults[0] !== before.length + defaultIndex) {
      return fail('the default subtitle flag is not on the requested track alone');
    }
  }

  return { ok: true };
}
