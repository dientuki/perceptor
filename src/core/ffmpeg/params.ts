// src/core/ffmpeg/params.ts

export function getVideoParams(videoStream: any) {
  const codec = videoStream.codec_name;

  // REGLA: Si es h264, convertir. 
  if (codec === 'h264') {
    return [
      "-map", "0:v:0",
      "-c:v", "libsvtav1",
      "-crf", "28",
      "-preset", "4",
      //"-svtav1-params", "rc=1:tune=1:film-grain=8:film-grain-denoise=0:enable-overlays=1:scd=1",
      "-metadata:s:v:0", 'title="AV1 (Converted from H264)"'
    ];
  }

  // REGLA: Para cualquier otra cosa (AV1, HEVC, VC1, etc.), solo copiar.
  return [
    "-map", "0:v:0",
    "-c:v", "copy",
    "-metadata:s:v:0", 'title="Video (Direct Copy)"'
  ];
}

// src/core/ffmpeg/params.ts
export function getAudioParams(audioStreams: any[], originalLang: string) {
  // Aseguramos que sea 'eng' por defecto si viene vacío, pero respetamos el parámetro
  const allowedLangs = Array.from(new Set([originalLang.toLowerCase(), 'spa'])); // Evita duplicados si original es spa
  
  const blacklistWords = ['commentary', 'description', 'visual', 'sdh'];
  const priority = ['eac3', 'ac3', 'truehd'];

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
    console.log(`⚠️ Alerta: No se encontró el idioma [${originalLang.toLowerCase()}] tras filtrar. Haciendo COPY de todos los audios.`);
    return ["-map", "0:a", "-c:a", "copy"];
  }

  // 3. Selección de UN solo mejor stream por idioma
  const selectedStreams: any[] = [];
  allowedLangs.forEach(langCode => {
    const langStreams = candidates.filter(s => (s.tags?.language || "").toLowerCase() === langCode);
    
    if (langStreams.length > 0) {
      langStreams.sort((a, b) => {
        const indexA = priority.indexOf(a.codec_name);
        const indexB = priority.indexOf(b.codec_name);
        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
      });

      const best = langStreams[0];
      // Evitar meter el mismo stream si por error el archivo tiene tags raros
      if (!selectedStreams.some(s => s.index === best.index)) {
        selectedStreams.push(best);
      }
    }
  });

  // 4. Generar parámetros finales
  const params: string[] = [];
  
  selectedStreams.forEach((s, index) => {
    const lang = (s.tags?.language || "und").toLowerCase();
    const title = s.tags?.title || "Audio";
    
    //console.log(`[Stream #${s.index}] ${lang.toUpperCase()} - ${title} (${s.codec_name}) -> OPUS 320k`);

    params.push("-map", `0:${s.index}`);
    params.push(`-c:a:${index}`, "libopus");
    params.push(`-b:a:${index}`, "320k");
    
    if (s.channels === 6) {
        params.push(`-af:a:${index}`, "channelmap=channel_layout=5.1");
    }
    
    params.push(`-metadata:s:a:${index}`, `title="Surround 5.1 (Opus)"`);
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
    console.log("ℹ️ No se encontraron subtítulos Subrip que cumplan las reglas.");
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