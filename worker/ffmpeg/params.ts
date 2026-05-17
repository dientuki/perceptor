// src/core/ffmpeg/params.ts
import { logger } from "@/lib/logger";

type quality = 'remux' | 'web';

function getQuality(isLiveAction: boolean, quality: quality) {
  //anime 20, remux 22, para amz/web 24

  //if (!isLiveAction) return "20";

  if (quality === "remux") return "22";

  return "24";
}

export function getVideoParams(videoStream: any, isLiveAction: boolean, quality: quality = 'web') {
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
        ]),
  ].join(":");

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
        "-vf", "scale=1920:2160,libplacebo=w=1920:h=1080:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=auto",
        "-c:v", "libsvtav1",
        "-crf", getQuality(isLiveAction, quality),
        "-preset", "4",
        "-pix_fmt", "yuv420p10le",
        "-svtav1-params", svtav1,
        "-metadata:s:v:0", 'title=AV1 1080p (Tonemapped from 4K DoVi)'
      ];
    }

    const hasHDR10 = Array.isArray(videoStream.side_data_list) && 
      videoStream.side_data_list.some((sideData: any) => 
        sideData.side_data_type === "Mastering display metadata" || 
        sideData.side_data_type === "Content light level metadata"
      );

    if (hasHDR10) {
      return [
        "-map", "0:v:0",
        "-vf", "scale=1920:2160,libplacebo=w=1920:h=1080:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=auto",
        "-c:v", "libsvtav1",
        "-crf", getQuality(isLiveAction, quality),
        "-preset", "4",
        "-pix_fmt", "yuv420p10le",
        "-svtav1-params", svtav1,
        "-metadata:s:v:0", 'title=AV1 1080p (Tonemapped from 4K HDR10)'
      ];
    }
  }

  // REGLA: Para cualquier otra cosa (AV1, HEVC, VC1, etc.), solo copiar.
  return [
    "-map", "0:v:0",
    "-c:v", "copy",
    "-metadata:s:v:0", 'title=Video (Direct Copy)'
  ];
}

// src/core/ffmpeg/params.ts
export function getAudioParams(audioStreams: any[], originalLang: string) {
  // Aseguramos que sea 'eng' por defecto si viene vacío, pero respetamos el parámetro
  const allowedLangs = Array.from(new Set([originalLang.toLowerCase(), 'spa', 'eng'])); // Evita duplicados si original es spa
  
  const blacklistWords = ['commentary', 'description', 'visual', 'sdh'];
  const priority = ['truehd', 'dts', 'eac3', 'ac3'];

  // 1. Filtrado inicial
  const candidates = audioStreams.filter(s => {
    const lang = (s.tags?.language || "").toLowerCase();
    const title = (s.tags?.title || "").toLowerCase();
    return allowedLangs.includes(lang) && !blacklistWords.some(word => title.includes(word));
  });

  // 2. VALIDACIÓN CRUCIAL: ¿Está el idioma original entre los candidatos?
  const hasOriginal = candidates.some(s => (s.tags?.language || "").toLowerCase() === originalLang.toLowerCase());

  // Si no hay idioma original (o el filtro nos dejó vacíos), COPY ALL
  if (!hasOriginal || candidates.length === 0) {
    logger.warn({ originalLang }, "No se encontró el idioma original tras filtrar. Haciendo COPY de todos los audios.");
    return ["-map", "0:a", "-c:a", "copy"];
  }

  // 3. Selección de UN solo mejor stream por idioma
  const selectedStreams: any[] = [];
  allowedLangs.forEach(langCode => {
    let langStreams = candidates.filter(s => (s.tags?.language || "").toLowerCase() === langCode);

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
    params.push("-vbr", "on");

    let bitrate = "128k";
    let title = "Stereo";    

    if (channels >= 8) {
        // Surround 7.1
        params.push(`-b:a:${index}`, "512k");
        params.push(`-filter:a:${index}`, "channelmap=map=0|1|2|3|4|5|6|7:channel_layout=7.1");
        params.push(`-mapping_family:a:${index}`, "1");
        params.push(`-metadata:s:a:${index}`, `title=Surround 7.1 (Opus)`);
        
    } else if (channels >= 6) {
        params.push(`-b:a:${index}`, "320k");
        params.push(`-filter:a:${index}`, "aformat=channel_layouts=5.1");
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

export function getSubtitleParams(subtitleStreams: any[], originalLang: string) {
  const langOriginal = (originalLang || 'eng').toLowerCase();
  const allowedLangs = Array.from(new Set([langOriginal, 'spa', 'eng']));

  // 1. Filtrado por tus 3 reglas
  const filtered = subtitleStreams.filter(s => {
    const lang = (s.tags?.language || "").toLowerCase();
    const bps = parseInt(s.tags?.BPS || "999"); // Si no tiene BPS, asumimos que es válido
    const codec = s.codec_name.toLowerCase();

    // Regla 1: Idioma
    const isAllowedLang = allowedLangs.includes(lang);
    
    // Regla 2: BPS > 2 (Eliminar pistas vacías o corruptas)
    const hasEnoughBitrate = bps > 2;
    
    // Regla 3: Solo subrip (SRT)
    const isSubrip = codec === 'subrip';

    return isAllowedLang && hasEnoughBitrate && isSubrip;
  });

  if (filtered.length === 0) {
    logger.info("No se encontraron subtítulos Subrip que cumplan las reglas.");
    return [];
  }

  // 2. Generar parámetros de mapeo
  const params: string[] = [];
    
  filtered.forEach((s, index) => {
    const lang = (s.tags?.language || "und").toUpperCase();
    //console.log(`[Stream #${s.index}] ${lang} - Codec: ${s.codec_name} (BPS: ${s.tags?.BPS || 'N/A'})`);

    params.push("-map", `0:${s.index}`);
    params.push(`-c:s:${index}`, "copy"); // Copia directa ya que es texto
  });
  
  return params;
}