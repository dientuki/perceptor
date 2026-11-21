// Spec 123, REQ-15
export type ParsedEncodeCommand = {
  videoCodec: 'av1' | 'copy' | null;
  crf: number | null;
  preset: number | null;
  contentKind: 'LIVE_ACTION' | null;
  resolutionCeiling: string | null;
  outputResolution: null;
  deinterlaced: boolean | null;
  grainApplied: boolean | null;
};

const EMPTY: ParsedEncodeCommand = {
  videoCodec: null,
  crf: null,
  preset: null,
  contentKind: null,
  resolutionCeiling: null,
  outputResolution: null,
  deinterlaced: null,
  grainApplied: null,
};

// Spec 123, REQ-15
const CEILING_BOXES: Record<string, string> = {
  '1920:1080': '1080p',
  '1280:720': '720p',
  '854:480': '480p',
  '640:360': '360p',
};

// Spec 123, REQ-15
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (const char of command) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

const valueOf = (tokens: string[], flag: string): string | null => {
  const at = tokens.indexOf(flag);
  return at >= 0 && at + 1 < tokens.length ? tokens[at + 1] : null;
};

const integer = (raw: string | null): number | null =>
  raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

// Spec 123, REQ-15
export function parseEncodeCommand(
  command: string | null | undefined,
): ParsedEncodeCommand {
  try {
    if (typeof command !== 'string' || command.trim() === '') return EMPTY;
    if ((command.match(/"/g)?.length ?? 0) % 2 === 1) return EMPTY;
    const tokens = tokenize(command);

    const codec = valueOf(tokens, '-c:v');
    const videoCodec =
      codec === 'libsvtav1' ? 'av1' : codec === 'copy' ? 'copy' : null;
    if (videoCodec === null) return EMPTY;
    if (videoCodec === 'copy') return { ...EMPTY, videoCodec };

    const params = (valueOf(tokens, '-svtav1-params') ?? '').split(':');
    const grain = params
      .find((entry) => entry.startsWith('film-grain='))
      ?.slice('film-grain='.length);
    const grainValue =
      grain !== undefined && /^\d+$/.test(grain) ? Number(grain) : null;

    const filters = (valueOf(tokens, '-vf') ?? '').split(',');
    const scale = filters.find((filter) => filter.startsWith('scale='));
    const box = scale?.slice('scale='.length).split(':').slice(0, 2).join(':');

    return {
      videoCodec,
      crf: integer(valueOf(tokens, '-crf')),
      preset: integer(valueOf(tokens, '-preset')),
      contentKind: params.includes('scm=0') ? 'LIVE_ACTION' : null,
      resolutionCeiling: (box && CEILING_BOXES[box]) || null,
      outputResolution: null,
      deinterlaced: filters.some((filter) => filter.startsWith('bwdif'))
        ? true
        : null,
      grainApplied: grainValue === null ? null : grainValue > 0,
    };
  } catch {
    return EMPTY;
  }
}
