const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.sub', '.sup', '.idx'];
const DROPPING_FLAGS = new Set(['forced', 'foreign']);

// Spec 107, T011
export function sidecarLanguageTags(fileNames: string[], mediaBaseName: string): string[] {
  const prefix = `${mediaBaseName}.`;
  const out = new Set<string>();
  for (const name of fileNames) {
    if (!name.startsWith(prefix)) continue;
    const lower = name.toLowerCase();
    const ext = SUBTITLE_EXTENSIONS.find((e) => lower.endsWith(e));
    if (!ext) continue;
    const middle = name.slice(prefix.length, name.length - ext.length);
    if (!middle) continue;
    const [tag, ...flags] = middle.split('.');
    if (!tag) continue;
    if (flags.some((f) => DROPPING_FLAGS.has(f.toLowerCase()))) continue;
    out.add(tag);
  }
  return [...out];
}
