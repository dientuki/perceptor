// src/core/ffmpeg/params.ts

import { normalizeIso3 } from './iso639';

type quality = 'remux' | 'web';

function getQuality(isLiveAction: boolean, quality: quality) {
  //anime 20, remux 22, para amz/web 24

  if (!isLiveAction) return "20";

  if (quality === "remux") return "22";

  return "24";
}

export function getVideoParams(videoStream: any, isLiveAction: boolean, quality: quality = 'web') {
  // Sin stream de video no hay nada que codificar (archivo corrupto o sólo
  // audio) — mejor un error claro acá que un TypeError al leer .codec_name.
  if (!videoStream) {
    throw new Error('El archivo de entrada no tiene ningún stream de video');
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

    if (hasDolbyVision) {
        return [
        "-map", "0:v:0",
        "-vf", "libplacebo=w=1920:h=1080:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=auto",
        "-c:v", "libsvtav1",
        "-crf", getQuality(isLiveAction, quality),
        "-preset", "4",
        "-pix_fmt", "yuv420p10le",
        "-svtav1-params", svtav1,
        "-metadata:s:v:0", 'title=AV1 1080p (Tonemapped from 4K DoVi)'
      ];
    }

    //const hasHDR10 = Array.isArray(videoStream.side_data_list) && 
    //  videoStream.side_data_list.some((sideData: any) => 
    //    sideData.side_data_type === "Mastering display metadata" || 
    //    sideData.side_data_type === "Content light level metadata"
    //  );

    const hasHDR10 = 
      videoStream.color_transfer === 'smpte2084' || 
      videoStream.color_transfer === 'arib-std-b67' || 
      videoStream.color_primaries === 'bt2020' ||
      (Array.isArray(videoStream.side_data_list) && videoStream.side_data_list.some((s: any) => 
        s.side_data_type === "Mastering display metadata" ||
        s.side_data_type === "Content light level metadata"
      ));

    if (hasHDR10) {
      return [
        "-map", "0:v:0",
        "-vf", "libplacebo=w=1920:h=1080:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=auto",
        "-c:v", "libsvtav1",
        "-crf", getQuality(isLiveAction, quality),
        "-preset", "4",
        "-pix_fmt", "yuv420p10le",
        "-svtav1-params", svtav1,
        "-metadata:s:v:0", 'title=AV1 1080p (Tonemapped from 4K HDR10)'
      ];
    }

    return [
      "-map", "0:v:0",
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease",
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
    throw new Error(
      `El archivo no tiene ninguna pista de audio en el idioma original (${originalLanguageIso3})`,
    );
  }

  // 3. Selección de UN solo mejor stream por idioma
  const selectedStreams: any[] = [];
  allowedLangs.forEach(langCode => {
    let langStreams = candidates.filter(s => normalizeIso3(s.tags?.language || "") === langCode);

    // REQ-7: a requested language with no track present is not a failure —
    // log it and move on. Only the original language (checked above) is
    // mandatory.
    if (langStreams.length === 0 && langCode !== originalLang) {
      console.warn(`[ffmpeg] idioma permitido "${langCode}" no tiene pista de audio en el archivo; se continúa sin él.`);
    }

    if (langStreams.length > 0) {
      // ---- NUEVA REGLA PARA ESPAÑOL (LATINO) ----
      if (langCode === 'spa' && langStreams.length > 1) {
        // Filtramos las que tengan "latin" o "latino" de forma explícita
        const latinStreams = langStreams.filter(s => {
          const title = (s.tags?.title || "").toLowerCase();
          return title.includes('latin') || title.includes('latino');
        });

        // Si encontramos pistas con "latin/latino", trabajamos SOLO con esas para elegir la mejor
        if (latinStreams.length > 0) {
          langStreams = latinStreams;
        }
      }

      langStreams.sort((a, b) => {
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
      });

      const best = langStreams[0];
      if (!selectedStreams.some(s => s.index === best.index)) {
        selectedStreams.push(best);
      }
    }
  });

  // 4. Generar parámetros finales
  const params: string[] = [];
  
  selectedStreams.forEach((s, index) => {
    const lang = (s.tags?.language || "und").toLowerCase();
    const channels = Number(s.channels || 0);
    //const title = s.tags?.title || "Audio";
    
    //console.log(`[Stream #${s.index}] ${lang.toUpperCase()} - ${title} (${s.codec_name}) -> OPUS 320k`);

    params.push("-map", `0:${s.index}`);
    params.push(`-c:a:${index}`, "libopus");
    params.push(`-vbr:a:${index}`, "on");

    let bitrate = "128k";
    let title = "Stereo";    

    if (channels >= 8) {
        // Surround 7.1
        params.push(`-b:a:${index}`, "512k");
        //params.push(`-filter:a:${index}`, "channelmap=map=0|1|2|3|4|5|6|7:channel_layout=7.1");
        params.push(`-filter:a:${index}`, "channelmap=channel_layout=7.1");
        params.push(`-mapping_family:a:${index}`, "1");
        params.push(`-metadata:s:a:${index}`, `title=Surround 7.1 (Opus)`);
        
    } else if (channels >= 6) {
        params.push(`-b:a:${index}`, "320k");
        //params.push(`-filter:a:${index}`, "aformat=channel_layouts=5.1");
        params.push(`-filter:a:${index}`, "channelmap=channel_layout=5.1");
        params.push(`-mapping_family:a:${index}`, "1");
        params.push(`-metadata:s:a:${index}`, `title=Surround 5.1 (Opus)`);
        
    } else {
        // Stereo o inferior
        params.push(`-b:a:${index}`, "128k");
        params.push(`-metadata:s:a:${index}`, `title=Stereo (Opus)`);
    }

    // 3. Lenguaje
    params.push(`-metadata:s:a:${index}`, `language=${lang}`);
  });

  return params;
}

// src/core/ffmpeg/params.ts

const languageMap: Record<string, string> = {
    spa: "Spanish",
    eng: "English",
  };

export function getSubtitleParams(subtitleStreams: any[], allowedLanguagesIso3: string[]) {
  // Same list the caller resolved for getAudioParams (REQ-8 shares the one
  // allow-list with REQ-4 — see the assumption at the top of spec.md). Both
  // sides normalized for the same /B-vs-/T reason as the audio track match.
  const allowedLangs = Array.from(
    new Set(allowedLanguagesIso3.map((lang) => normalizeIso3(lang))),
  );

  // 1. Filtrado por tus 3 reglas
  const filtered = subtitleStreams.filter(s => {
    const lang = normalizeIso3(s.tags?.language || "");
    const bps = parseInt(s.tags?.BPS || "999"); // Si no tiene BPS, asumimos que es válido
    const codec = (s.codec_name || "").toLowerCase(); // guard: algún stream sin codec_name no debe tirar TypeError acá

    // Regla 1: Idioma
    const isAllowedLang = allowedLangs.includes(lang);
    
    // Regla 2: BPS > 2 (Eliminar pistas vacías o corruptas)
    const hasEnoughBitrate = bps > 2;
    
    // Regla 3: Solo subrip (SRT) o mov_text (MP4)
    const isSubrip = ["subrip", "mov_text", "tx3g"].includes(codec);

    return isAllowedLang && hasEnoughBitrate && isSubrip;
  });

  if (filtered.length === 0) {
    console.log('[ffmpeg] no se encontraron subtítulos Subrip que cumplan las reglas.');
    return [];
  }

  // 2. Generar parámetros de mapeo
  const params: string[] = [];
    
  filtered.forEach((s, index) => {
    const lang = (s.tags?.language || "und").toUpperCase();
    //console.log(`[Stream #${s.index}] ${lang} - Codec: ${s.codec_name} (BPS: ${s.tags?.BPS || 'N/A'})`);

    params.push("-map", `0:${s.index}`);
    //params.push(`-c:s:${index}`, "copy"); // Copia directa ya que es texto
    params.push(`-c:s:${index}`, "srt");

    const title = s.tags?.title || "";
    

    const isAllCaps =
      title.length > 0 &&
      title === title.toUpperCase() &&
      /[A-Z]/.test(title);

    const shouldReplaceTitle =
      title.trim() === "" || isAllCaps;

    if (shouldReplaceTitle) {
      const language = s.tags?.language || "und";
      const languageName = languageMap[language] || language;

      params.push(
        `-metadata:s:s:${index}`,
        `title=${languageName}`
      );
    }

    
    
  });
  
  return params;
}