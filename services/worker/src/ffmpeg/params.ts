import { normalizeIso3 } from './iso639';
import { parseFrameRate } from './remux-detection';
import { type AudioVariantResolution, detectWithTags, detectVariant, narrowToVariants, preferring, requestedVariants, titleMarks, titleWords, variantTitle } from './variants';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import type { ContentKind } from '../encode/content-kind';
import type { CompressionResolution } from '../encode/compression-resolution';
import type { SubtitleFormat } from '../encode/subtitle-formats';
import {
  ERROR_ENCODE_NO_ORIGINAL_AUDIO,
  ERROR_ENCODE_NO_VIDEO_STREAM,
} from '../i18n/error-keys';

type quality = 'remux' | 'web';

function getQuality(contentKind: ContentKind, quality: quality) {
  if (quality === "remux") return "22";

  return "24";
}

// Spec 057, REQ-11; Spec 092, REQ-7 REQ-8
function svtav1KindParams(contentKind: ContentKind, filmGrain: boolean): string[] {
  const grainParams = filmGrain ? ["film-grain=8", "film-grain-denoise=1"] : ["film-grain=0"];

  switch (contentKind) {
    case 'LIVE_ACTION':
      return ["scm=0", "aq-mode=2", "sharpness=0", ...grainParams];
    case 'ANIME':
      return ["scm=2", "aq-mode=2", "enable-qm=1", "qm-min=4", "sharpness=2", ...grainParams];
    case 'CGI':
      return ["scm=2", "aq-mode=2", "enable-qm=1", "qm-min=4", "sharpness=2", ...grainParams];
  }
}

export function buildSvtav1Params(contentKind: ContentKind, filmGrain: boolean): string {
  return [
    "keyint=10s",
    "scd=1",
    "enable-overlays=1",
    "tune=0",
    "input-depth=10",
    ...svtav1KindParams(contentKind, filmGrain),
  ].join(":");
}

type Av1EncodeOptions = {
  vf?: string;
  aspect?: string;
  colorTags?: string[];
  title: string;
};

function buildAv1EncodeArgs(
  contentKind: ContentKind,
  quality: quality,
  options: Av1EncodeOptions,
  filmGrain: boolean,
): string[] {
  const svtav1 = buildSvtav1Params(contentKind, filmGrain);

  const args: string[] = ["-map", "0:v:0"];

  if (options.vf) {
    args.push("-vf", options.vf);
  }

  args.push(
    "-c:v", "libsvtav1",
    "-crf", getQuality(contentKind, quality),
    "-preset", "4",
    "-pix_fmt", "yuv420p10le",
  );

  if (options.aspect) {
    args.push("-aspect", options.aspect);
  }

  if (options.colorTags) {
    args.push(...options.colorTags);
  }

  args.push("-svtav1-params", svtav1, "-metadata:s:v:0", `title=${options.title}`);

  return args;
}

const SDR_BT709_COLOR_TAGS = [
  "-color_range", "tv",
  "-colorspace", "bt709",
  "-color_primaries", "bt709",
  "-color_trc", "bt709",
];

const SD_PAL_COLOR_TAGS = [
  "-color_range", "tv",
  "-colorspace", "bt470bg",
  "-color_primaries", "bt470bg",
  "-color_trc", "gamma28",
];

const SD_NTSC_COLOR_TAGS = [
  "-color_range", "tv",
  "-colorspace", "smpte170m",
  "-color_primaries", "smpte170m",
  "-color_trc", "smpte170m",
];

const HDR_BT2020_COLOR_TAGS = [
  "-color_range", "tv",
  "-colorspace", "bt2020nc",
  "-color_primaries", "bt2020",
  "-color_trc", "smpte2084",
];

const HLG_BT2020_COLOR_TAGS = [
  "-color_range", "tv",
  "-colorspace", "bt2020nc",
  "-color_primaries", "bt2020",
  "-color_trc", "arib-std-b67",
];

// Spec 058, REQ-10 REQ-12
const RECOGNIZED_VIDEO_CODECS = ['h264', 'hevc', 'h265', 'vc1', 'av1', 'mpeg2video'];

type ResolutionBox = { width: number; height: number; label: string };

// Spec 058, REQ-6
export const RESOLUTION_BOXES: Record<CompressionResolution, ResolutionBox | null> = {
  '4k': null,
  '1080p': { width: 1920, height: 1080, label: '1080p' },
  '720p': { width: 1280, height: 720, label: '720p' },
  '480p': { width: 854, height: 480, label: '480p' },
  '360p': { width: 640, height: 360, label: '360p' },
};

// Spec 058, REQ-14
const SOURCE_TIER_BOXES: ResolutionBox[] = [
  { width: 640, height: 360, label: '360p' },
  { width: 854, height: 480, label: '480p' },
  { width: 1280, height: 720, label: '720p' },
  { width: 1920, height: 1080, label: '1080p' },
];

// Spec 058, REQ-7
const BOX_TOLERANCE = 1.02;

export function exceedsBox(width: number, height: number, box: ResolutionBox | null): boolean {
  if (!box) return false;
  return width > box.width * BOX_TOLERANCE || height > box.height * BOX_TOLERANCE;
}

function sourceTierLabel(width: number, height: number): string {
  const fit = SOURCE_TIER_BOXES.find((box) => !exceedsBox(width, height, box));
  return fit ? fit.label : '4K';
}

function codecLabel(codec: string): string {
  switch (codec) {
    case 'h264': return 'H264';
    case 'hevc':
    case 'h265': return 'HEVC';
    case 'vc1': return 'VC-1';
    case 'av1': return 'AV1';
    case 'mpeg2video': return 'MPEG-2';
    default: return codec.toUpperCase();
  }
}

type HdrForm = 'DoVi' | 'HDR10' | 'HLG' | 'SDR';

// Spec 058, REQ-13
function hdrFormOf(videoStream: any): HdrForm {
  const hasDolbyVision = Array.isArray(videoStream.side_data_list) &&
    videoStream.side_data_list.some((sideData: any) => sideData.side_data_type === "DOVI configuration record");
  if (hasDolbyVision) return 'DoVi';

  if (videoStream.color_transfer === 'arib-std-b67') return 'HLG';

  const hasHDR10 =
    videoStream.color_transfer === 'smpte2084' ||
    videoStream.color_primaries === 'bt2020' ||
    (Array.isArray(videoStream.side_data_list) && videoStream.side_data_list.some((s: any) =>
      s.side_data_type === "Mastering display metadata" ||
      s.side_data_type === "Content light level metadata"
    ));
  if (hasHDR10) return 'HDR10';

  return 'SDR';
}

type Bt601Set = 'PAL' | 'NTSC';

const MAX_SD_HEIGHT = 576;
const PAL_FRAME_RATE = 25;

function isUntagged(value: unknown): boolean {
  return !value || value === 'unknown' || value === 'unspecified';
}

function bt601ColorSet(videoStream: any): Bt601Set | null {
  const tags = [videoStream.color_primaries, videoStream.color_space, videoStream.color_transfer];

  for (const tag of tags) {
    if (tag === 'bt470bg') return 'PAL';
    if (tag === 'smpte170m') return 'NTSC';
  }

  const height = Number(videoStream.height ?? 0);
  if (!tags.every(isUntagged) || height <= 0 || height > MAX_SD_HEIGHT) return null;

  return height === MAX_SD_HEIGHT && parseFrameRate(videoStream.avg_frame_rate) === PAL_FRAME_RATE
    ? 'PAL'
    : 'NTSC';
}

function sdrColorTags(videoStream: any): string[] {
  switch (bt601ColorSet(videoStream)) {
    case 'PAL': return SD_PAL_COLOR_TAGS;
    case 'NTSC': return SD_NTSC_COLOR_TAGS;
    default: return SDR_BT709_COLOR_TAGS;
  }
}

function deinterlaceParity(videoStream: any): 'tff' | 'bff' | null {
  switch (videoStream.field_order) {
    case 'tt':
    case 'bt': return 'tff';
    case 'bb':
    case 'tb': return 'bff';
    default: return null;
  }
}

function deinterlaceFilter(videoStream: any): string | undefined {
  const parity = deinterlaceParity(videoStream);
  return parity ? `bwdif=mode=send_frame:parity=${parity}:deint=interlaced` : undefined;
}

const SQUARE_PIXEL_TOLERANCE = 0.01;

function isSquarePixel(sar: string): boolean {
  const [num, den] = sar.split(':').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return true;
  return Math.abs(num / den - 1) < SQUARE_PIXEL_TOLERANCE;
}

function anamorphicAspect(videoStream: any): string | undefined {
  const sar = videoStream.sample_aspect_ratio;
  const dar = videoStream.display_aspect_ratio;
  if (!sar || !dar || isSquarePixel(sar)) return undefined;
  return dar;
}

function colorTagsFor(videoStream: any, form: HdrForm): string[] {
  switch (form) {
    case 'DoVi':
    case 'HDR10':
      return HDR_BT2020_COLOR_TAGS;
    case 'HLG':
      return HLG_BT2020_COLOR_TAGS;
    case 'SDR':
      return sdrColorTags(videoStream);
  }
}

// Spec 058, REQ-14
function videoTitle(codec: string, scaled: boolean, sourceLabel: string): string {
  const codec_ = codecLabel(codec);
  if (!scaled) return `AV1 (Converted from ${codec_})`;
  return `AV1 (Downscaled from ${sourceLabel} ${codec_})`;
}

function copyVideoArgs(): string[] {
  return [
    "-map", "0:v:0",
    "-c:v", "copy",
    "-metadata:s:v:0", 'title=Video (Direct Copy)',
  ];
}

export function getVideoParams(
  videoStream: any,
  contentKind: ContentKind,
  compressionResolution: CompressionResolution,
  quality: quality = 'web',
  filmGrain: boolean = false,
) {
  if (!videoStream) {
    throw new KeyedError(
      ERROR_ENCODE_NO_VIDEO_STREAM,
      renderMessage(ERROR_ENCODE_NO_VIDEO_STREAM),
    );
  }

  const codec = (videoStream.codec_name || '').toLowerCase();
  const width = Number(videoStream.width ?? 0);
  const height = Number(videoStream.height ?? 0);
  const box = RESOLUTION_BOXES[compressionResolution] ?? null;
  const exceeds = exceedsBox(width, height, box);

  // Spec 058, REQ-12
  if (!RECOGNIZED_VIDEO_CODECS.includes(codec)) {
    console.warn(
      exceeds
        ? `[ffmpeg] unrecognized video codec "${codec}"; copying at its own resolution, compression ceiling "${compressionResolution}" not applied.`
        : `[ffmpeg] unrecognized video codec "${codec}"; copying at its own resolution.`,
    );
    return copyVideoArgs();
  }

  // Spec 058, REQ-11
  if (codec === 'av1' && !exceeds) {
    return copyVideoArgs();
  }

  const form = hdrFormOf(videoStream);
  const scale = exceeds && box
    ? `scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    : undefined;
  const vf = [deinterlaceFilter(videoStream), scale].filter(Boolean).join(',') || undefined;

  return buildAv1EncodeArgs(
    contentKind,
    quality,
    {
      vf,
      aspect: anamorphicAspect(videoStream),
      colorTags: colorTagsFor(videoStream, form),
      title: videoTitle(codec, exceeds, sourceTierLabel(width, height)),
    },
    filmGrain,
  );
}

export interface AudioSelection {
  streams: any[];
  missingLanguages: string[];
}

export interface AudioCandidates {
  candidates: any[];
  hasOriginal: boolean;
}

// Spec 122, REQ-2
export function findAudioCandidates(
  audioStreams: any[],
  allowedLanguagesIso3: string[],
  originalLanguageIso3: string,
  audioVariants: AudioVariantResolution,
): AudioCandidates {
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );
  const originalLang = normalizeIso3(originalLanguageIso3);
  const blacklistWords = ['commentary', 'description', 'visual', 'sdh'];

  const candidates = audioStreams.filter(s => {
    if (audioVariants.duplicates.has(s.index)) return false;
    const lang = normalizeIso3(s.tags?.language || "");
    const title = (s.tags?.title || "").toLowerCase();
    return allowedLangs.includes(lang) && !blacklistWords.some(word => title.includes(word));
  });

  const hasOriginal = candidates.some(s => normalizeIso3(s.tags?.language || "") === originalLang);
  return { candidates, hasOriginal };
}

// Spec 011, REQ-3 REQ-4 REQ-6 REQ-7; Spec 099, REQ-7
export function selectAudioStreams(
  audioStreams: any[],
  allowedLanguagesIso3: string[],
  originalLanguageIso3: string,
  allowedLanguageTags: string[],
  audioVariants: AudioVariantResolution,
): AudioSelection {
  const detect = detectWithTags(audioVariants.tags);
  // Both sides of every comparison go through normalizeIso3: ffprobe may tag
  // a track with the ISO-639-2/T form (e.g. "fra") while the allow-list
  // arrives in the /B form the `languages` table seeds ("fre") — see
  // src/ffmpeg/iso639.ts.
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );
  const originalLang = normalizeIso3(originalLanguageIso3);

  const priority = ['truehd', 'dts', 'eac3', 'ac3'];

  const { candidates, hasOriginal } = findAudioCandidates(
    audioStreams,
    allowedLanguagesIso3,
    originalLanguageIso3,
    audioVariants,
  );

  // Spec 011, REQ-6
  if (!hasOriginal) {
    const params = { iso3: originalLanguageIso3 };
    throw new KeyedError(
      ERROR_ENCODE_NO_ORIGINAL_AUDIO,
      renderMessage(ERROR_ENCODE_NO_ORIGINAL_AUDIO, params),
      params,
    );
  }

  // Spec 031, REQ-9
  const selectedStreams: any[] = [];
  const missingLanguages: string[] = [];
  const selectBest = (streams: any[]): any =>
    [...streams].sort((a, b) => {
      const codecA = (a.codec_name || "").toLowerCase();
      const codecB = (b.codec_name || "").toLowerCase();

      const rankA = priority.indexOf(codecA) === -1 ? 99 : priority.indexOf(codecA);
      const rankB = priority.indexOf(codecB) === -1 ? 99 : priority.indexOf(codecB);

      if (rankA !== rankB) return rankA - rankB;

      const chanA = Number(a.channels || 0);
      const chanB = Number(b.channels || 0);
      if (chanA !== chanB) return chanB - chanA;

      const bitA = Number(a.bit_rate || 0);
      const bitB = Number(b.bit_rate || 0);
      return bitB - bitA;
    })[0];
  const addSelected = (s: any) => {
    if (!selectedStreams.some((selected) => selected.index === s.index)) {
      selectedStreams.push(s);
    }
  };

  allowedLangs.forEach(langCode => {
    const langStreams = candidates.filter(s => normalizeIso3(s.tags?.language || "") === langCode);

    // Spec 011, REQ-7
    if (langStreams.length === 0 && langCode !== originalLang) {
      missingLanguages.push(langCode);
    }

    if (langStreams.length === 0) return;

    const requestedForLang = requestedVariants(langCode, allowedLanguageTags);

    // Spec 031, REQ-6
    if (requestedForLang.length === 0) {
      addSelected(selectBest(langStreams));
      return;
    }

    const narrowed = narrowToVariants(langStreams, requestedForLang, detect);

    // Spec 031, REQ-5
    if (!narrowed.matched) {
      narrowed.streams.forEach(addSelected);
      return;
    }

    // Spec 031, REQ-9
    narrowed.groups.forEach((group) => {
      addSelected(selectBest(group.streams));
    });
  });

  return { streams: selectedStreams, missingLanguages };
}

function opusLayoutTitle(channels: number): string {
  if (channels >= 8) return "Surround 7.1 (Opus)";
  if (channels >= 6) return "Surround 5.1 (Opus)";
  return "Stereo (Opus)";
}

function isOpus(stream: any): boolean {
  return (stream.codec_name || '').toLowerCase() === 'opus';
}

function opusCopyArgs(index: number): string[] {
  return [`-c:a:${index}`, "copy"];
}

function opusEncodeArgs(index: number, channels: number): string[] {
  const args = [`-c:a:${index}`, "libopus", `-vbr:a:${index}`, "on"];

  if (channels >= 8) {
    args.push(`-b:a:${index}`, "512k", `-filter:a:${index}`, "channelmap=channel_layout=7.1", `-mapping_family:a:${index}`, "1");
  } else if (channels >= 6) {
    args.push(`-b:a:${index}`, "320k", `-filter:a:${index}`, "channelmap=channel_layout=5.1", `-mapping_family:a:${index}`, "1");
  } else {
    args.push(`-b:a:${index}`, "128k");
  }

  return args;
}

function audioTagArgs(stream: any, index: number, title: string): string[] {
  const lang = (stream.tags?.language || "und").toLowerCase();
  return [`-metadata:s:a:${index}`, `title=${title}`, `-metadata:s:a:${index}`, `language=${lang}`];
}

// Spec 011, REQ-3 REQ-4 REQ-6 REQ-7
export function getAudioParams(
  audioStreams: any[],
  allowedLanguagesIso3: string[],
  originalLanguageIso3: string,
  allowedLanguageTags: string[],
  trackTitles: Record<string, string>,
  audioVariants: AudioVariantResolution,
) {
  const { streams: selectedStreams, missingLanguages } = selectAudioStreams(
    audioStreams,
    allowedLanguagesIso3,
    originalLanguageIso3,
    allowedLanguageTags,
    audioVariants,
  );
  const detect = detectWithTags(audioVariants.tags);

  missingLanguages.forEach((langCode) => {
    console.warn(`[ffmpeg] allowed language "${langCode}" has no audio track in the file; continuing without it.`);
  });

  const params: string[] = [];
  
  selectedStreams.forEach((s, index) => {
    const channels = Number(s.channels || 0);
    const languageTitle = trackLanguageTitle(s, trackTitles, detect);

    params.push("-map", `0:${s.index}`);
    params.push(...(isOpus(s) ? opusCopyArgs(index) : opusEncodeArgs(index, channels)));
    params.push(...audioTagArgs(s, index, `${languageTitle} ${opusLayoutTitle(channels)}`));
  });

  return params;
}

type SubtitleGroup = 'text' | 'image';

const SUBTITLE_FORMATS: Record<SubtitleFormat, { group: SubtitleGroup; codecs: string[] }> = {
  srt: { group: 'text', codecs: ['subrip'] },
  ass: { group: 'text', codecs: ['ass', 'ssa'] },
  webvtt: { group: 'text', codecs: ['webvtt'] },
  mov_text: { group: 'text', codecs: ['mov_text', 'tx3g'] },
  pgs: { group: 'image', codecs: ['hdmv_pgs_subtitle'] },
  vobsub: { group: 'image', codecs: ['dvd_subtitle'] },
  dvb: { group: 'image', codecs: ['dvb_subtitle'] },
};

const MIN_SUBTITLE_BYTES = 2000;
const MIN_SUBTITLE_CUES = 100;

const HEARING_IMPAIRED_MARKERS = ['sdh', 'cc'];
const HEARING_IMPAIRED_PHRASES = ['hearing impaired', 'hearing-impaired'];

function subtitleFormatOf(stream: any): SubtitleFormat | null {
  const codec = (stream.codec_name || '').toLowerCase();
  const match = (Object.keys(SUBTITLE_FORMATS) as SubtitleFormat[]).find((format) =>
    SUBTITLE_FORMATS[format].codecs.includes(codec),
  );
  return match ?? null;
}

export function subtitleGroupOf(stream: any): SubtitleGroup | null {
  const format = subtitleFormatOf(stream);
  return format ? SUBTITLE_FORMATS[format].group : null;
}

export function isImageSubtitle(stream: any): boolean {
  return subtitleGroupOf(stream) === 'image';
}

function hasCuePayload(stream: any): boolean {
  const bytes = Number(stream.tags?.NUMBER_OF_BYTES);
  if (Number.isFinite(bytes)) return bytes >= MIN_SUBTITLE_BYTES;

  const cues = Number(stream.tags?.NUMBER_OF_FRAMES);
  if (Number.isFinite(cues)) return cues >= MIN_SUBTITLE_CUES;

  const bps = Number(stream.tags?.BPS);
  if (Number.isFinite(bps)) return bps > 2;

  return true;
}

function isHearingImpaired(stream: any): boolean {
  if (stream.disposition?.hearing_impaired === 1) return true;

  const words = titleWords(stream);
  return (
    HEARING_IMPAIRED_MARKERS.some((marker) => words.includes(marker)) ||
    HEARING_IMPAIRED_PHRASES.some((phrase) => words.join(' ').includes(phrase))
  );
}

function isCommentary(stream: any): boolean {
  return stream.disposition?.comment === 1 || titleMarks(stream, ['commentary']);
}

function trackLanguageTitle(
  stream: any,
  trackTitles: Record<string, string>,
  detect: (stream: any) => string | undefined = detectVariant,
): string {
  const lang = normalizeIso3(stream.tags?.language || 'und');
  const variant = detect(stream);
  if (variant) {
    const title = variantTitle(variant);
    if (title) return title;
  }
  return trackTitles[lang] ?? lang;
}

export function selectSubtitleStreams(
  subtitleStreams: any[],
  allowedFormats: SubtitleFormat[],
  allowedLanguagesIso3: string[],
  allowedLanguageTags: string[],
  detect: (stream: any) => string | undefined = detectVariant,
): { selected: any[]; commentary: any[] } {
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );

  const eligible = subtitleStreams.filter(
    (s) =>
      allowedLangs.includes(normalizeIso3(s.tags?.language || '')) &&
      allowedFormats.includes(subtitleFormatOf(s) as SubtitleFormat),
  );
  // Spec 102, REQ-2
  const commentary = eligible.filter(isCommentary);
  const candidates = eligible.filter((s) => !isCommentary(s) && hasCuePayload(s));

  const selected: any[] = [];
  allowedLangs.forEach((langCode) => {
    let langStreams = candidates.filter(
      (s) => normalizeIso3(s.tags?.language || '') === langCode,
    );
    if (langStreams.length === 0) return;

    langStreams = preferring(langStreams, isHearingImpaired);
    langStreams = preferring(langStreams, isImageSubtitle);

    const requestedForLang = requestedVariants(langCode, allowedLanguageTags);
    if (requestedForLang.length > 0) {
      const narrowed = narrowToVariants(langStreams, requestedForLang, detect);
      langStreams = narrowed.matched
        ? narrowed.groups.flatMap((group) => group.streams)
        : narrowed.streams;
    }

    selected.push(...langStreams);
  });

  return { selected, commentary };
}

export function getSubtitleParams(
  subtitleStreams: any[],
  allowedFormats: SubtitleFormat[],
  allowedLanguagesIso3: string[],
  allowedLanguageTags: string[],
  trackTitles: Record<string, string>,
  contentDrops: ReadonlySet<number>,
  detect: (stream: any) => string | undefined = detectVariant,
) {
  if (allowedFormats.length === 0) {
    console.log('[ffmpeg] subtitles disabled by settings (allowedSubtitleFormats empty).');
    return [];
  }

  const { selected: candidates, commentary } = selectSubtitleStreams(
    subtitleStreams,
    allowedFormats,
    allowedLanguagesIso3,
    allowedLanguageTags,
    detect,
  );

  commentary.forEach((s) => console.log(`[subs] ${s.index} drop (commentary)`));

  const selected = candidates.filter((s) => !contentDrops.has(s.index));

  if (selected.length === 0) {
    console.log('[ffmpeg] no subtitle in an allowed language and format survived the rules.');
    return [];
  }

  const params: string[] = [];

  selected.forEach((s, index) => {
    params.push('-map', `0:${s.index}`);
    params.push(`-c:s:${index}`, isImageSubtitle(s) ? 'copy' : 'srt');
    params.push(`-metadata:s:s:${index}`, `title=${trackLanguageTitle(s, trackTitles, detect)}`);
  });

  return params;
}