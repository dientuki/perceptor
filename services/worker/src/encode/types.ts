// Subconjunto de EncodeJobDetails (jobs/encode.job.ts) que el driver real
// necesita para armar el comando de ffmpeg (selección de audio/subtítulo
// original, CRF de animación vs. live-action — ver src/ffmpeg/params.ts).
// Tipado acá en vez de importado para no atar este módulo a la forma completa
// de la query, mismo criterio que paths/build-output-path.ts.
export type EncodeInput = {
  originalLanguageIso3: string;
  allowedAudioLanguagesIso3: string[];
  allowedAudioLanguageTags: string[];
  allowedSubtitleLanguagesIso3: string[];
  allowedSubtitleLanguageTags: string[];
  isLiveAction: boolean;
  containerTitle: string;
  sourceTag: string;
  trackTitles: Record<string, string>;
};

// Contrato común entre drivers de encode (mock hoy, ffmpeg real después). En
// archivo aparte para que index.ts y cada driver puedan importarlo sin
// depender uno del otro (evita un ciclo entre index.ts y los drivers).
// onProgress's second parameter is required for the same reason onProbe is
// (023-ffprobe-log, see services/worker/CLAUDE.md): an optional callback a
// call site forgets to pass compiles clean and reports nothing forever. Here
// that would mean a driver that silently never reports a speed — required
// makes REQ-11 (053-downloads-panel-repair, passthrough reports no speed) a
// compile error instead of a discipline.
export type EncodeFn = (
  input: string,
  output: string,
  details: EncodeInput,
  onProgress: (progress: number, speed: number | null) => Promise<void>,
  onProbe: (file: string, ffprobe: string) => Promise<void>,
  signal: AbortSignal,
) => Promise<{ ffmpegCommand: string }>;
