// Contrato común entre drivers de encode (mock hoy, ffmpeg real después). En
// archivo aparte para que index.ts y cada driver puedan importarlo sin
// depender uno del otro (evita un ciclo entre index.ts y los drivers).
export type EncodeFn = (
  input: string,
  output: string,
  onProgress: (progress: number) => Promise<void>,
) => Promise<{ ffmpegCommand: string }>;
