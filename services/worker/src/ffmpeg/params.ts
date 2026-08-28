// src/core/ffmpeg/params.ts

import { normalizeIso3 } from './iso639';
import { detectVariant, narrowToVariants, preferring, requestedVariants, titleWords, variantTitle } from './variants';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import {
  ERROR_ENCODE_NO_ORIGINAL_AUDIO,
  ERROR_ENCODE_NO_VIDEO_STREAM,
} from '../i18n/error-keys';

type quality = 'remux' | 'web';

function getQuality(isLiveAction: boolean, quality: quality) {
  //anime 20, remux 22, para amz/web 24

  if (!isLiveAction) return "20";

  if (quality === "remux") return "22";

  return "24";
}

const HDR_DOWNSCALE_VF =
  'scale=1920:1080:force_original_aspect_ratio=decrease';

export function getVideoParams(
  videoStream: any,
  isLiveAction: boolean,
  quality: quality = 'web',
) {
  // Sin stream de video no hay nada que codificar (archivo corrupto o sólo
  // audio) — mejor un error claro acá que un TypeError al leer .codec_name.
  if (!videoStream) {
    throw new KeyedError(
      ERROR_ENCODE_NO_VIDEO_STREAM,
      renderMessage(ERROR_ENCODE_NO_VIDEO_STREAM),
    );
  }

  const codec = videoStream.codec_name;
  const width = Number(videoStream.width ?? 0);
  const height = Number(videoStream.height ?? 0);
  const is4K =
    width >= 3800 || height >= 2100;

  const svtav1 = [
    "keyint=10s",
    "scd=1",
    "enable-overlays=1",
    "tune=0",
    "input-depth=10",

    ...(isLiveAction
      ? [
          "scm=0",
        ]
      : [
          "aq-mode=2",
          "enable-qm=1",
          "qm-min=4",
          // params cgi
          "sharpness=2",
          "film-grain=0",
        ]),
  ].join(":");
  /*

// Optimización para Animación Digital 3D (Transformers One)
          "aq-mode=2",      // Excelente para evitar macrobloques en fondos oscuros/espacio
          "enable-qm=1",    // Habilita matrices de cuantización (clave para conservar texturas)
          "qm-min=4",       // Evita que sea demasiado agresivo en zonas planas
          "sharpness=2",    // ¡NUEVO! Crucial para que los bordes metálicos no se vean borrosos
          "film-grain=0",   // ¡NUEVO! A menos que la fuente tenga ruido estético, en 3D digital ponlo en 0
        ]),
*/
  // REGLA: Si es h264, convertir. 
  if (codec === 'h264') {
    return [
      "-map", "0:v:0",
      "-c:v", "libsvtav1",
      //anime 20, remux 22, para amz/web 24
      "-crf", getQuality(isLiveAction, quality), // 22peli 24 seriAjusta este valor para controlar la calidad (menor es mejor calidad, pero más peso)
      "-preset", "4",
      "-pix_fmt", "yuv420p10le", //10bit, sacar para 8
      "-svtav1-params", svtav1,
      //"-svtav1-params", "keyint=10s:scd=1:enable-overlays=1:tune=0:scm=0",//live-action
      //"-svtav1-params", "keyint=10s:scd=1:enable-overlays=1:tune=0:aq-mode=2:enable-qm=1:qm-min=4",//anime
      //"-svtav1-params", "aq-mode=2:aq-strength=1.2:loop-restoration=2",
      //"-svtav1-params", "film-grain=8:film-grain-denoise=0",
      //"-svtav1-params", "rc=1:tune=1:film-grain=8:film-grain-denoise=0:enable-overlays=1:scd=1",
      "-metadata:s:v:0", 'title=AV1 (Converted from H264)'
    ];
  }

    // HEVC/H265 4K -> 1080p AV1
  if ((codec === 'hevc' || codec === 'h265') && is4K) {

    const hasDolbyVision = Array.isArray(videoStream.side_data_list) && 
      videoStream.side_data_list.some((sideData: any) => sideData.side_data_type === "DOVI configuration record");

    const hasHDR10 = 
      videoStream.color_transfer === 'smpte2084' || 
      videoStream.color_transfer === 'arib-std-b67' || 
      videoStream.color_primaries === 'bt2020' ||
      (Array.isArray(videoStream.side_data_list) && videoStream.side_data_list.some((s: any) => 
        s.side_data_type === "Mastering display metadata" ||
        s.side_data_type === "Content light level metadata"
      ));

    if (hasDolbyVision || hasHDR10) {
        const from = hasDolbyVision ? "DoVi" : "HDR10";
        return [
          "-map", "0:v:0",
          "-vf", HDR_DOWNSCALE_VF,
          "-c:v", "libsvtav1",
          "-crf", getQuality(isLiveAction, quality),
          "-preset", "4",
          "-pix_fmt", "yuv420p10le",
          "-svtav1-params", svtav1,
          "-metadata:s:v:0", `title=AV1 1080p (Downscaled from 4K ${from})`,
          "-color_range", "tv",
          "-colorspace", "bt2020nc",
          "-color_primaries", "bt2020",
          "-color_trc", "smpte2084",
        ];
    }

    return [
      "-map", "0:v:0",
      "-vf", HDR_DOWNSCALE_VF,
      "-c:v", "libsvtav1",
      "-crf", getQuality(isLiveAction, quality),
      "-preset", "4",
      "-pix_fmt", "yuv420p10le",
      "-color_range", "tv",
      "-colorspace", "bt709",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-svtav1-params", svtav1,
      "-metadata:s:v:0", 'title=AV1 1080p (Downscaled from 4K SDR)'
    ];
  }

  if (codec === 'vc1') {
    return [
      "-map", "0:v:0",
      "-c:v", "libsvtav1",
      "-crf", getQuality(isLiveAction, quality),
      "-preset", "4",
      // Convertimos de 8-bit (yuv420p) a 10-bit para evitar banding en AV1
      "-pix_fmt", "yuv420p10le",
      "-color_range", "tv",
      "-colorspace", "bt709",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-svtav1-params", `${svtav1}:tune=0`,
      "-metadata:s:v:0", "title=AV1 1080p (SDR from VC-1)"
    ];
  }

  // REGLA: Para cualquier otra cosa (AV1, HEVC, VC1, etc.), solo copiar.
  return [
    "-map", "0:v:0",
    "-c:v", "copy",
    "-metadata:s:v:0", 'title=Video (Direct Copy)'
  ];
}

// src/core/ffmpeg/params.ts
//
// REQ-4/REQ-6/REQ-7: the caller (buildFfmpegCommand) resolves the allow-list
// server-side (api merges every owner's preference — see spec.md § REQ-3)
// and hands it here already deduplicated, alongside the one language that is
// mandatory. This function never derives its own list — see
// docs/spec/features/011-av1-transcode/worker/plan.md, step 5.
export function getAudioParams(
  audioStreams: any[],
  allowedLanguagesIso3: string[],
  originalLanguageIso3: string,
  allowedLanguageTags: string[],
) {
  // Both sides of every comparison go through normalizeIso3: ffprobe may tag
  // a track with the ISO-639-2/T form (e.g. "fra") while the allow-list
  // arrives in the /B form the `languages` table seeds ("fre") — see
  // src/ffmpeg/iso639.ts.
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );
  const originalLang = normalizeIso3(originalLanguageIso3);

  const blacklistWords = ['commentary', 'description', 'visual', 'sdh'];
  const priority = ['truehd', 'dts', 'eac3', 'ac3'];

  // 1. Filtrado inicial
  const candidates = audioStreams.filter(s => {
    const lang = normalizeIso3(s.tags?.language || "");
    const title = (s.tags?.title || "").toLowerCase();
    return allowedLangs.includes(lang) && !blacklistWords.some(word => title.includes(word));
  });

  // 2. REQ-6: the original language is the only mandatory one. Its absence
  // after filtering is a hard failure — no more copy-all fallback, which
  // used to ship a file with the wrong audio and report success.
  const hasOriginal = candidates.some(s => normalizeIso3(s.tags?.language || "") === originalLang);

  if (!hasOriginal) {
    const params = { iso3: originalLanguageIso3 };
    throw new KeyedError(
      ERROR_ENCODE_NO_ORIGINAL_AUDIO,
      renderMessage(ERROR_ENCODE_NO_ORIGINAL_AUDIO, params),
      params,
    );
  }

  // 3. Selección: un mejor stream por variante pedida (REQ-9), o el mejor
  // de todo el idioma cuando no se pidió ninguna variante regional.
  const selectedStreams: any[] = [];
  const selectBest = (streams: any[]): any =>
    [...streams].sort((a, b) => {
      const codecA = (a.codec_name || "").toLowerCase();
      const codecB = (b.codec_name || "").toLowerCase();

      const rankA = priority.indexOf(codecA) === -1 ? 99 : priority.indexOf(codecA);
      const rankB = priority.indexOf(codecB) === -1 ? 99 : priority.indexOf(codecB);

      // 1. Mejor Codec (Fuente)
      if (rankA !== rankB) return rankA - rankB;

      // 2. Más Canales (Preferimos 7.1 > 5.1 > 2.0)
      const chanA = Number(a.channels || 0);
      const chanB = Number(b.channels || 0);
      if (chanA !== chanB) return chanB - chanA;

      // 3. Más Bitrate
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

    // REQ-7: a requested language with no track present is not a failure —
    // log it and move on. Only the original language (checked above) is
    // mandatory.
    if (langStreams.length === 0 && langCode !== originalLang) {
      console.warn(`[ffmpeg] idioma permitido "${langCode}" no tiene pista de audio en el archivo; se continúa sin él.`);
    }

    if (langStreams.length === 0) return;

    const requestedForLang = requestedVariants(langCode, allowedLanguageTags);

    // REQ-6: no requested variant for this language — quality decides alone,
    // exactly as before this feature.
    if (requestedForLang.length === 0) {
      addSelected(selectBest(langStreams));
      return;
    }

    const narrowed = narrowToVariants(langStreams, requestedForLang);

    // REQ-5: nothing in the file matched a requested variant — every
    // surviving stream of the language is kept rather than reduced to one.
    if (!narrowed.matched) {
      narrowed.streams.forEach(addSelected);
      return;
    }

    // REQ-9: one best stream per matched requested variant.
    narrowed.groups.forEach((group) => {
      addSelected(selectBest(group.streams));
    });
  });

  // 4. Generar parámetros finales
  const params: string[] = [];
  
  selectedStreams.forEach((s, index) => {
    const lang = (s.tags?.language || "und").toLowerCase();
    const channels = Number(s.channels || 0);
    // REQ-12: the same resolver the subtitle titles use, prefixed onto the
    // channel-layout label below — see trackLanguageTitle.
    const languageTitle = trackLanguageTitle(s);

    params.push("-map", `0:${s.index}`);
    params.push(`-c:a:${index}`, "libopus");
    params.push(`-vbr:a:${index}`, "on");

    if (channels >= 8) {
        // Surround 7.1
        params.push(`-b:a:${index}`, "512k");
        //params.push(`-filter:a:${index}`, "channelmap=map=0|1|2|3|4|5|6|7:channel_layout=7.1");
        params.push(`-filter:a:${index}`, "channelmap=channel_layout=7.1");
        params.push(`-mapping_family:a:${index}`, "1");
        params.push(`-metadata:s:a:${index}`, `title=${languageTitle} Surround 7.1 (Opus)`);
        
    } else if (channels >= 6) {
        params.push(`-b:a:${index}`, "320k");
        //params.push(`-filter:a:${index}`, "aformat=channel_layouts=5.1");
        params.push(`-filter:a:${index}`, "channelmap=channel_layout=5.1");
        params.push(`-mapping_family:a:${index}`, "1");
        params.push(`-metadata:s:a:${index}`, `title=${languageTitle} Surround 5.1 (Opus)`);
        
    } else {
        // Stereo o inferior
        params.push(`-b:a:${index}`, "128k");
        params.push(`-metadata:s:a:${index}`, `title=${languageTitle} Stereo (Opus)`);
    }

    // 3. Lenguaje
    params.push(`-metadata:s:a:${index}`, `language=${lang}`);
  });

  return params;
}

// src/core/ffmpeg/params.ts

const TEXT_SUBTITLE_CODECS = ['subrip', 'mov_text', 'tx3g'];

const MIN_SUBTITLE_BYTES = 2000;
const MIN_SUBTITLE_CUES = 100;

const HEARING_IMPAIRED_MARKERS = ['sdh', 'cc'];
const HEARING_IMPAIRED_PHRASES = ['hearing impaired', 'hearing-impaired'];

// REQ-12/REQ-18: L2 in .claude/agents/ffmpeg.md — endonym-style and
// incomplete on purpose. A language not covered here falls back to its
// ISO-639-2 code (see trackLanguageTitle below); filling it in is a
// question for the user, never a guess.
const languageTitles: Record<string, string> = {
  eng: 'English',
  spa: 'Español',
};

function isTextSubtitle(stream: any): boolean {
  return TEXT_SUBTITLE_CODECS.includes((stream.codec_name || '').toLowerCase());
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

// REQ-12: one resolver, two callers — getAudioParams prefixes its layout
// with this, getSubtitleParams uses it as the whole title. Detection is
// unconditional (REQ-3): the same track reads the same way regardless of
// who triggered the encode, never gated on what was requested.
function trackLanguageTitle(stream: any): string {
  const lang = normalizeIso3(stream.tags?.language || 'und');
  const variant = detectVariant(stream);
  if (variant) {
    const title = variantTitle(variant);
    if (title) return title;
  }
  return languageTitles[lang] ?? lang;
}

export function getSubtitleParams(
  subtitleStreams: any[],
  allowedLanguagesIso3: string[],
  allowedLanguageTags: string[],
) {
  // Same list the caller resolved for getAudioParams (REQ-8 shares the one
  // allow-list with REQ-4 — see the assumption at the top of spec.md). Both
  // sides normalized for the same /B-vs-/T reason as the audio track match.
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );

  const candidates = subtitleStreams.filter(
    (s) =>
      allowedLangs.includes(normalizeIso3(s.tags?.language || '')) &&
      isTextSubtitle(s) &&
      hasCuePayload(s),
  );

  const selected: any[] = [];
  allowedLangs.forEach((langCode) => {
    let langStreams = candidates.filter(
      (s) => normalizeIso3(s.tags?.language || '') === langCode,
    );
    if (langStreams.length === 0) return;

    // REQ-17: SDH runs first, so a hearing-impaired track can never become
    // the variant match that discards a plain one, and stays when it is the
    // only candidate.
    langStreams = preferring(langStreams, isHearingImpaired);

    // REQ-4/REQ-5/REQ-6/REQ-15: unlike audio, subtitles are never reduced to
    // one — every stream a matched variant survives with is kept, and so is
    // every stream when nothing matches or no variant was requested at all.
    const requestedForLang = requestedVariants(langCode, allowedLanguageTags);
    if (requestedForLang.length > 0) {
      const narrowed = narrowToVariants(langStreams, requestedForLang);
      langStreams = narrowed.matched
        ? narrowed.groups.flatMap((group) => group.streams)
        : narrowed.streams;
    }

    selected.push(...langStreams);
  });

  if (selected.length === 0) {
    console.log('[ffmpeg] no text subtitle in an allowed language survived the rules.');
    return [];
  }

  const params: string[] = [];

  selected.forEach((s, index) => {
    params.push('-map', `0:${s.index}`);
    params.push(`-c:s:${index}`, 'srt');
    params.push(`-metadata:s:s:${index}`, `title=${trackLanguageTitle(s)}`);
  });

  return params;
}