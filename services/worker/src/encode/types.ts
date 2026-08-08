// Subconjunto de EncodeJobDetails (jobs/encode.job.ts) que el driver real
// necesita para armar el comando de ffmpeg (selección de audio/subtítulo
// original, CRF de animación vs. live-action — ver src/ffmpeg/params.ts).
// Tipado acá en vez de importado para no atar este módulo a la forma completa
// de la query, mismo criterio que paths/build-output-path.ts.
export type EncodeInput = {
  originalLanguageIso3: string;
  isLiveAction: boolean;
};

// Contrato común entre drivers de encode (mock hoy, ffmpeg real después). En
// archivo aparte para que index.ts y cada driver puedan importarlo sin
// depender uno del otro (evita un ciclo entre index.ts y los drivers).
export type EncodeFn = (
  input: string,
  output: string,
  details: EncodeInput,
  onProgress: (progress: number) => Promise<void>,
) => Promise<{ ffmpegCommand: string }>;
