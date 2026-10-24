export interface ProbedStream {
  index: number;
  codec_type?: string;
}

export interface EmbedTrack {
  normalizedPath: string;
  languageIso3: string;
  trackTitle: string;
  isDefault: boolean;
  isForced: boolean;
}

export interface EmbedArgsInput {
  originalPath: string;
  partPath: string;
  originalStreams: ProbedStream[];
  tracks: EmbedTrack[];
}

const flag = (value: boolean) => (value ? '1' : '0');

// Spec 101, REQ-5 REQ-6 REQ-9
export function buildEmbedArgs(input: EmbedArgsInput): string[] {
  const args = ['-o', input.partPath];

  if (input.tracks.some((track) => track.isDefault)) {
    for (const stream of input.originalStreams) {
      if (stream.codec_type === 'subtitle') {
        args.push('--default-track-flag', `${stream.index}:0`);
      }
    }
  }

  args.push(input.originalPath);

  for (const track of input.tracks) {
    args.push(
      '--language', `0:${track.languageIso3}`,
      '--track-name', `0:${track.trackTitle}`,
      '--default-track-flag', `0:${flag(track.isDefault)}`,
      '--forced-display-flag', `0:${flag(track.isForced)}`,
      '--sub-charset', '0:UTF-8',
      track.normalizedPath,
    );
  }

  return args;
}
