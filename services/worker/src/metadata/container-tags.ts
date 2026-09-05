import { basename, relative, sep } from 'node:path';
import { isInsideRoot } from '../paths/is-inside-root';

export type ContainerTagsInput = {
  kind: string;
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildContainerTitle(details: ContainerTagsInput): string {
  if (details.kind === 'MOVIE') {
    return details.title;
  }

  const base = `${details.title} S${pad2(details.seasonNumber ?? 0)}-E${pad2(details.episodeNumber ?? 0)}`;

  return details.episodeTitle ? `${base} ${details.episodeTitle}` : base;
}

export function buildSourceTag(downloadsRoot: string, inputFilePath: string): string {
  if (isInsideRoot(downloadsRoot, inputFilePath)) {
    return relative(downloadsRoot, inputFilePath).split(sep).join('/');
  }

  return basename(inputFilePath);
}
