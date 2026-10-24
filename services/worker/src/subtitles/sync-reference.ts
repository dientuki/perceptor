import { subtitleGroupOf } from '../ffmpeg/params';

export type SyncReference = {
  kind: 'SUBTITLE' | 'AUDIO';
  streamSpec: string;
};

// Spec 103, T014
export function pickSyncReference(streams: any[]): SyncReference | null {
  const subtitles = streams.filter((s) => s.codec_type === 'subtitle');
  const textIndex = subtitles.findIndex(
    (s) => subtitleGroupOf(s) === 'text' && s.disposition?.forced !== 1,
  );
  if (textIndex !== -1) return { kind: 'SUBTITLE', streamSpec: `s:${textIndex}` };

  const audios = streams.filter((s) => s.codec_type === 'audio');
  if (audios.length === 0) return null;
  const defaultIndex = audios.findIndex((s) => s.disposition?.default === 1);
  return { kind: 'AUDIO', streamSpec: `a:${defaultIndex !== -1 ? defaultIndex : 0}` };
}
