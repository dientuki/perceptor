import { extname } from 'node:path';

// A `.mp4` source filed under the `.mkv` `buildOutputPath` always produces is
// a mislabelled container — one that plays and completes the job, so nothing
// in this pipeline ever notices; only the media server, reading the wrong
// codec off the wrong extension, ever complains. This is the one place the
// passthrough (compression off) path corrects that: it swaps the output's
// extension for the source's before the move.
//
// Replaces only the **last** extension, the same `/(\.[^./]+)$/` shape
// `runner.ts` and `encode.mock.ts` already use — a title containing a dot
// ("The Super Mario Bros. Movie") must not have its base name mangled. An
// input with no extension leaves the output's own extension untouched rather
// than producing a bare, extension-less name.
export function withSourceExtension(outputPath: string, inputPath: string): string {
  const sourceExt = extname(inputPath);
  if (!sourceExt) {
    return outputPath;
  }

  return outputPath.replace(/(\.[^./]+)$/, sourceExt);
}
