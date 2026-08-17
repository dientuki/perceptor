// src/ffmpeg/remux-detection.ts
//
// REQ-10: whether a source is a remux must be decided from its ffprobe
// metadata, not its filename. Consumes the shape `getMetadata`
// (src/ffmpeg/metadata.ts) already returns — no second ffprobe call here.

interface FfprobeStream {
  codec_type?: 'video' | 'audio' | 'subtitle';
  codec_name?: string;
  profile?: string;
  width?: number | string;
  height?: number | string;
  bit_rate?: string;
  avg_frame_rate?: string;
  tags?: {
    BPS?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface FfprobeFormat {
  size?: string;
  duration?: string;
  [key: string]: any;
}

export interface RemuxMetadata {
  streams: FfprobeStream[];
  format?: FfprobeFormat;
}

const LOSSLESS_AUDIO_CODECS = new Set(['truehd', 'mlp']);

function isLosslessAudioStream(stream: FfprobeStream): boolean {
  const codec = (stream.codec_name || '').toLowerCase();

  if (LOSSLESS_AUDIO_CODECS.has(codec)) return true;
  if (codec.startsWith('pcm_')) return true;

  if (codec === 'dts') {
    const profile = (stream.profile || '').toUpperCase();
    return profile.includes('DTS-HD MA');
  }

  return false;
}

// ffprobe reports avg_frame_rate as a rational string, e.g. "24000/1001" —
// never a plain number. Number("24000/1001") is NaN, which makes every
// bits-per-pixel-per-frame comparison false and every file classify as
// non-remux with no error anywhere (the archetypal Article IX bug this
// function exists to prevent). Parse the fraction instead.
function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;

  const parts = raw.split('/');
  const numerator = Number(parts[0]);
  const denominator = parts.length > 1 ? Number(parts[1]) : 1;

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Falling-back chain, per REQ-10: the video stream's own bit_rate, then its
// BPS tag (the same fallback getSubtitleParams already relies on for
// per-stream bitrate in an MKV — src/ffmpeg/params.ts), then a bitrate
// derived from the container's overall size and duration.
function resolveVideoBitRate(
  videoStream: FfprobeStream,
  format: FfprobeFormat | undefined,
): number | null {
  const streamBitRate = Number(videoStream.bit_rate);
  if (Number.isFinite(streamBitRate) && streamBitRate > 0) return streamBitRate;

  const bpsTag = Number(videoStream.tags?.BPS);
  if (Number.isFinite(bpsTag) && bpsTag > 0) return bpsTag;

  const size = Number(format?.size);
  const duration = Number(format?.duration);
  if (
    Number.isFinite(size) && size > 0 &&
    Number.isFinite(duration) && duration > 0
  ) {
    return (size * 8) / duration;
  }

  return null;
}

// Returns null when no bitrate at all can be computed, so the caller knows
// to fall back to the filename — the filename must never silently override
// a real, computable bitrate.
function computeBitsPerPixelPerFrame(
  videoStream: FfprobeStream | undefined,
  format: FfprobeFormat | undefined,
): number | null {
  if (!videoStream) return null;

  const width = Number(videoStream.width ?? 0);
  const height = Number(videoStream.height ?? 0);
  const pixels = width * height;
  if (!pixels) return null;

  const frameRate = parseFrameRate(videoStream.avg_frame_rate);
  if (!frameRate) return null;

  const bitRate = resolveVideoBitRate(videoStream, format);
  if (bitRate === null) return null;

  return bitRate / pixels / frameRate;
}

const REMUX_BITS_PER_PIXEL_PER_FRAME_THRESHOLD = 0.25;

export function isRemux(metadata: RemuxMetadata, filename: string): boolean {
  const streams = metadata.streams ?? [];

  const hasLosslessAudio = streams
    .filter((s) => s.codec_type === 'audio')
    .some(isLosslessAudioStream);
  if (hasLosslessAudio) return true;

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const bitsPerPixelPerFrame = computeBitsPerPixelPerFrame(videoStream, metadata.format);

  if (bitsPerPixelPerFrame !== null) {
    return bitsPerPixelPerFrame >= REMUX_BITS_PER_PIXEL_PER_FRAME_THRESHOLD;
  }

  // Last resort only: no bitrate at all could be computed from the stream.
  return (filename || '').toLowerCase().includes('remux');
}
