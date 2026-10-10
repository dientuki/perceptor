import { join } from 'node:path';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_EPISODE_NUMBERS_MISSING } from '../i18n/error-keys';
import type { LibraryLayout } from './library-layout';

export type OutputPathInput = {
  kind: string; // 'MOVIE' | 'EPISODE'
  tmdbId: number;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  outputRoot: string;
  layout: LibraryLayout;
};

function sanitize(name: string): string {
  return name
    .replace(/[:\-']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

type EpisodeNumbers = { season: number; episode: number };

function requireEpisodeNumbers(details: OutputPathInput): EpisodeNumbers {
  if (details.seasonNumber === null || details.episodeNumber === null) {
    throw new KeyedError(
      ERROR_ENCODE_EPISODE_NUMBERS_MISSING,
      renderMessage(ERROR_ENCODE_EPISODE_NUMBERS_MISSING),
    );
  }
  return { season: details.seasonNumber, episode: details.episodeNumber };
}

function yearOf(details: OutputPathInput): string {
  return details.year ? String(details.year) : '0000';
}

function jellyfinPath(details: OutputPathInput): string {
  const cleanTitle = sanitize(details.title);
  const year = yearOf(details);
  const titledFolder = `${cleanTitle} (${year}) [tmdbid=${details.tmdbId}]`;

  if (details.kind === 'MOVIE') {
    return join(details.outputRoot, titledFolder, `${cleanTitle} (${year}).mkv`);
  }

  const { season, episode } = requireEpisodeNumbers(details);
  const seasonFolder = `Season ${pad2(season)}`;
  const episodeTitle = details.episodeTitle ? sanitize(details.episodeTitle) : '';
  const episodeFile = `${cleanTitle} S${pad2(season)}E${pad2(episode)}${episodeTitle ? ` ${episodeTitle}` : ''}.mkv`;

  return join(details.outputRoot, titledFolder, seasonFolder, episodeFile);
}

function plexPath(details: OutputPathInput): string {
  const cleanTitle = sanitize(details.title);
  const year = yearOf(details);
  const titledName = `${cleanTitle} (${year}) {tmdb-${details.tmdbId}}`;

  if (details.kind === 'MOVIE') {
    return join(details.outputRoot, titledName, `${titledName}.mkv`);
  }

  const { season, episode } = requireEpisodeNumbers(details);
  const seasonFolder = `Season ${pad2(season)}`;
  const episodeTitle = details.episodeTitle ? sanitize(details.episodeTitle) : '';
  const episodeFile = `${cleanTitle} - S${pad2(season)}E${pad2(episode)}${episodeTitle ? ` - ${episodeTitle}` : ''}.mkv`;

  return join(details.outputRoot, titledName, seasonFolder, episodeFile);
}

export function buildOutputPath(details: OutputPathInput): string {
  return details.layout === 'plex' ? plexPath(details) : jellyfinPath(details);
}
