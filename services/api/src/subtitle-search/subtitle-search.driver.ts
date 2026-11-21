import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  Prisma,
  SubtitleProviderKind,
  SubtitleSearchAttempt,
} from '@prisma/client';
import { basename, extname } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import {
  SubtitleEmbedService,
  TargetRef,
} from '@/subtitle-embed/subtitle-embed.service';
import { SubtitleSyncQueueService } from '@/queue/subtitle-sync-queue.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { SubtitleProbeQueueService } from '@/queue/subtitle-probe-queue.service';
import { openSubtitlesApiKey } from '@/clients/opensubtitles/key';
import { OpenSubtitlesClient } from '@/clients/opensubtitles/client';
import { SubtitleProviderHttpError } from '@/clients/subtitle-provider-error';
import { OsSearchParams } from '@/clients/opensubtitles/types';
import {
  SubdivxCandidateFetchError,
  SubdivxClient,
} from '@/clients/subdivx/client';
import { provenanceOf } from './provenance';
import { ImdbIdsService } from '@/imdb-ids/imdb-ids.service';
import { SubtitleProvidersService } from '@/subtitle-providers/subtitle-providers.service';
import { extractSrt } from './archive';
import { subdivxCandidates } from './subdivx-candidates';
import { toUtf8 } from './to-utf8';
import {
  MAX_CANDIDATES_PER_LANGUAGE,
  SubtitleCandidate,
  filterAndRank,
} from './candidates';
import {
  providerLanguageCodes,
  providerVariantCode,
} from './provider-languages';
import { LanguageRow } from './sidecar-languages';
import { SubtitleSearchQueueService } from './subtitle-search-queue.service';
import { SubtitleSearchStaging } from './staging';

type Search = Prisma.SubtitleSearchGetPayload<{ include: { attempts: true } }>;

type Target = {
  filePath: string | null;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  year?: number | null;
  imdbTitleId?: number;
};

// Spec 121, REQ-8
type Progress = Record<string, Record<string, string>>;

type StepContext = {
  errors: Record<string, string>;
  languages?: Promise<LanguageRow[]>;
  progress: Progress;
  chains: Map<string, SubtitleProviderKind[]>;
};

const MINUTE_MS = 60_000;

// Spec 107, REQ-3
const PROBE_BACKSTOP_MS = 60 * MINUTE_MS;

const PROVIDER_WIDE_KEYS: string[] = [
  ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED,
  ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED,
];

// Spec 103, NFR-4
const SYNC_BACKSTOP_MS = 6 * 60 * MINUTE_MS;
const EMBED_POLL_MS = 2 * MINUTE_MS;

const NON_TERMINAL = [
  'WAITING',
  'SEARCHING',
  'VALIDATING',
  'EMBEDDING',
] as const;
const MAX_RELEASE_NAME_LENGTH = 500;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const errorMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [language, key] of Object.entries(value)) {
      if (typeof key === 'string') out[language] = key;
    }
  }
  return out;
};

// Spec 121, REQ-8
function progressMap(value: unknown): Progress {
  const out: Progress = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return out;
  }
  for (const [language, markers] of Object.entries(value)) {
    if (
      typeof markers !== 'object' ||
      markers === null ||
      Array.isArray(markers)
    ) {
      continue;
    }
    out[language] = {};
    for (const [kind, marker] of Object.entries(markers)) {
      if (typeof marker === 'string') out[language][kind] = marker;
    }
  }
  return out;
}

const kindOf = (attempt: SubtitleSearchAttempt): SubtitleProviderKind =>
  attempt.provider ?? SubtitleProviderKind.OPENSUBTITLES;

const isTerminal = (status: string): boolean =>
  status === 'COMPLETED' || status === 'FAILED';

const inFlight = (attempt: SubtitleSearchAttempt): boolean =>
  attempt.stagedPath !== null &&
  (attempt.status === 'QUEUED' || attempt.status === 'RUNNING');

function keyOf(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return null;
  const key = (response as { i18n?: { key?: unknown } }).i18n?.key;
  return typeof key === 'string' ? key : null;
}

// Spec 103, REQ-6 REQ-8 REQ-9 REQ-11 REQ-12
@Injectable()
export class SubtitleSearchDriver implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubtitleSearchDriver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SubtitleSearchQueueService,
    private readonly syncQueue: SubtitleSyncQueueService,
    private readonly subtitleEmbed: SubtitleEmbedService,
    private readonly probeQueue: SubtitleProbeQueueService,
    private readonly openSubtitles: OpenSubtitlesClient,
    private readonly capabilities: MediaCapabilitiesService,
    private readonly staging: SubtitleSearchStaging,
    private readonly providers: SubtitleProvidersService,
    private readonly subdivx: SubdivxClient,
    private readonly imdbIds: ImdbIdsService,
  ) {
    this.queue.setHandler((searchId) => this.advance(searchId));
  }

  // Spec 103, NFR-4
  async onApplicationBootstrap(): Promise<void> {
    // Spec 107, REQ-13
    if (openSubtitlesApiKey() === null) {
      this.logger.warn(
        "OpenSubtitles API key not found (OPENSUBTITLES_API_KEY or the image's key file); subtitle search is unavailable",
      );
    }
    try {
      await this.recover();
    } catch (error) {
      this.logger.warn(
        `Subtitle search boot recovery failed: ${String(error)}`,
      );
    }
  }

  // Spec 103, NFR-4
  async recover(): Promise<void> {
    const live = await this.prisma.subtitleSearch.findMany({
      where: { status: { in: [...NON_TERMINAL] } },
      select: { id: true },
    });
    for (const { id } of live) await this.wake(id, 0);

    await this.staging.sweep((searchId) => this.keepsStaging(searchId));
  }

  async advance(searchId: number): Promise<void> {
    const search = await this.load(searchId);
    if (!search) {
      await this.staging.removeSearch(searchId);
      return;
    }
    if (isTerminal(search.status)) {
      await this.settleStaging(search.id);
      return;
    }

    const ctx: StepContext = {
      errors: errorMap(search.languageErrors),
      progress: progressMap(search.providerProgress),
      chains: new Map(),
    };
    try {
      await this.purgeRejected(search);
      switch (search.status) {
        case 'WAITING':
          await this.waiting(search);
          break;
        case 'SEARCHING':
          await this.searching(search, ctx);
          break;
        case 'VALIDATING':
          await this.validating(search, ctx);
          break;
        case 'EMBEDDING':
          await this.embedding(search);
          break;
      }
    } catch (error) {
      this.logger.warn(
        `Subtitle search ${searchId} failed in ${search.status}: ${String(error)}`,
      );
      await this.fail(
        searchId,
        keyOf(error) ??
          (search.status === 'EMBEDDING'
            ? ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED
            : search.status === 'WAITING'
              ? ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED
              : ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAVAILABLE),
      );
    }
  }

  private load(searchId: number): Promise<Search | null> {
    return this.prisma.subtitleSearch.findUnique({
      where: { id: searchId },
      include: {
        attempts: { orderBy: [{ languageIso3: 'asc' }, { rank: 'asc' }] },
      },
    });
  }

  // Spec 107, REQ-3
  private async waiting(search: Search): Promise<void> {
    if (!(await this.capabilities.isSubtitleSearchAvailable())) {
      await this.fail(
        search.id,
        ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_NOT_CONFIGURED,
      );
      return;
    }

    if (Date.now() - search.createdAt.getTime() >= PROBE_BACKSTOP_MS) {
      await this.fail(search.id, ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED);
      return;
    }

    await this.probeQueue.removeProbe(search.id);
    await this.probeQueue.addProbe({ subtitleSearchId: search.id });
    await this.wake(search.id, PROBE_BACKSTOP_MS);
  }

  // Spec 107, REQ-6 REQ-8 REQ-9; Spec 121, REQ-7 REQ-8 REQ-9
  private async searching(search: Search, ctx: StepContext): Promise<void> {
    const missing = this.missingLanguages(search);
    const withAttempts = missing
      .map((language, position) => ({ language, position }))
      .filter(({ language }) => this.attemptsOf(search, language).length > 0);
    const start =
      withAttempts.length > 0
        ? withAttempts[withAttempts.length - 1].position
        : 0;

    for (const language of missing.slice(start)) {
      const chain = await this.chainOf(search, language, ctx);
      if (chain.length === 0) {
        if (!ctx.errors[language]) {
          ctx.errors[language] = ERROR_KEYS.SUBTITLE_SEARCH_NO_PROVIDER;
          await this.writeErrors(search, ctx);
        }
        continue;
      }

      for (;;) {
        if (
          this.attemptsOf(search, language).some(
            (attempt) => attempt.status === 'ACCEPTED',
          )
        ) {
          break;
        }
        if (ctx.errors[language]) break;
        const kind = this.currentProvider(ctx, language, chain);
        if (kind === null) break;

        let own = this.attemptsOf(search, language, kind);

        if (own.length === 0) {
          let found: SubtitleCandidate[];
          try {
            found = await this.searchWith(kind, search, language, ctx);
          } catch (error) {
            if (!(error instanceof SubtitleProviderHttpError)) throw error;
            if (error.kind === 'unauthorized') {
              await this.flagProvider(
                search,
                ctx,
                kind,
                this.unresolved(search),
                ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED,
              );
              continue;
            }
            this.logger.warn(
              `Searching ${language} for subtitle search ${search.id} failed: ${error.message}`,
            );
            await this.flagProvider(
              search,
              ctx,
              kind,
              [language],
              ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAVAILABLE,
            );
            continue;
          }
          if (found.length === 0) {
            await this.mark(search, ctx, language, kind, 'empty');
            continue;
          }

          await this.prisma.subtitleSearchAttempt.createMany({
            data: found.map((candidate, position) => ({
              searchId: search.id,
              languageIso3: language,
              provider: kind,
              providerSubtitleId: candidate.id,
              releaseName: candidate.release.slice(0, MAX_RELEASE_NAME_LENGTH),
              rank: position + 1,
              providerFileName: candidate.fileName?.slice(0, 500) ?? null,
            })),
          });
          own = await this.prisma.subtitleSearchAttempt.findMany({
            where: {
              searchId: search.id,
              languageIso3: language,
              provider: kind,
            },
            orderBy: { rank: 'asc' },
          });
        }

        if (own.some((attempt) => attempt.status === 'ACCEPTED')) break;

        const running = own.find(inFlight);
        if (running) {
          await this.arm(search.id, running);
          return;
        }

        if (await this.startNext(search, own, ctx)) return;

        if (ctx.progress[language]?.[kind] === undefined) {
          await this.mark(search, ctx, language, kind, 'exhausted');
        }
        const refreshed = await this.prisma.subtitleSearchAttempt.findMany({
          where: { searchId: search.id, languageIso3: language },
          orderBy: { rank: 'asc' },
        });
        search.attempts = [
          ...search.attempts.filter((a) => a.languageIso3 !== language),
          ...refreshed,
        ];
      }
    }

    const accepted = search.attempts.some(
      (attempt) => attempt.status === 'ACCEPTED',
    );
    if (accepted) {
      if (await this.transition(search.id, 'SEARCHING', 'EMBEDDING', {})) {
        await this.wake(search.id, 0);
      }
      return;
    }

    // Spec 107, REQ-9
    const unresolved = this.unresolved(search);
    const keys = new Set(unresolved.map((language) => ctx.errors[language]));
    if (keys.size === 1) {
      const [only] = [...keys];
      if (only && PROVIDER_WIDE_KEYS.includes(only)) {
        await this.fail(search.id, only);
        return;
      }
    }
    await this.complete(search.id, 'SEARCHING');
  }

  // Spec 121, REQ-7
  private async chainOf(
    search: Search,
    language: string,
    ctx: StepContext,
  ): Promise<SubtitleProviderKind[]> {
    const cached = ctx.chains.get(language);
    if (cached) return cached;
    const wanted = (search.wantedVariants ?? null) as Record<
      string,
      string
    > | null;
    const chain = await this.providers.chainFor(
      language,
      wanted?.[language] ?? null,
    );
    ctx.chains.set(language, chain);
    return chain;
  }

  // Spec 121, REQ-8
  private currentProvider(
    ctx: StepContext,
    language: string,
    chain: SubtitleProviderKind[],
  ): SubtitleProviderKind | null {
    const marked = ctx.progress[language] ?? {};
    return chain.find((kind) => marked[kind] === undefined) ?? null;
  }

  // Spec 121, REQ-8
  private async writeProgress(search: Search, ctx: StepContext): Promise<void> {
    await this.prisma.subtitleSearch.updateMany({
      where: { id: search.id },
      data: { providerProgress: ctx.progress },
    });
  }

  private async writeErrors(search: Search, ctx: StepContext): Promise<void> {
    await this.prisma.subtitleSearch.updateMany({
      where: { id: search.id },
      data: { languageErrors: ctx.errors },
    });
  }

  // Spec 121, REQ-8
  private async mark(
    search: Search,
    ctx: StepContext,
    language: string,
    kind: SubtitleProviderKind,
    marker: string,
  ): Promise<void> {
    ctx.progress[language] = { ...(ctx.progress[language] ?? {}), [kind]: marker };
    await this.writeProgress(search, ctx);
  }

  // Spec 121, REQ-10
  private async searchWith(
    kind: SubtitleProviderKind,
    search: Search,
    language: string,
    ctx: StepContext,
  ): Promise<SubtitleCandidate[]> {
    return kind === SubtitleProviderKind.SUBDIVX
      ? this.searchSubdivx(search)
      : this.searchProvider(search, language, ctx);
  }

  // Spec 121, REQ-10 REQ-11 REQ-12
  private async searchSubdivx(search: Search): Promise<SubtitleCandidate[]> {
    const target = await this.loadTarget(search);
    if (!target) throw new Error('The subtitle search target no longer exists');
    const releaseName = await this.releaseName(search);

    if (search.movieId !== null) {
      const imdbId = await this.imdbIds.resolve('movie', search.movieId);
      const byImdb = imdbId ? await this.subdivx.search({ imdbId }) : [];
      const items =
        byImdb.length > 0
          ? byImdb
          : await this.subdivx.search({
              title: (target.title ?? '').replaceAll(':', ''),
              ...(target.year ? { year: target.year } : {}),
            });
      return subdivxCandidates(items, null, releaseName);
    }

    const episode = {
      season: target.seasonNumber!,
      episode: target.episodeNumber!,
    };
    const imdbId = target.imdbTitleId
      ? await this.imdbIds.resolve('show', target.imdbTitleId)
      : null;
    if (imdbId) {
      const found = subdivxCandidates(
        await this.subdivx.search({ imdbId }),
        episode,
        releaseName,
      );
      if (found.length > 0) return found;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return subdivxCandidates(
      await this.subdivx.search({
        query: `${target.title ?? ''} S${pad(episode.season)}E${pad(episode.episode)}`,
      }),
      episode,
      releaseName,
    );
  }

  // Spec 107, REQ-6
  private async searchProvider(
    search: Search,
    language: string,
    ctx: StepContext,
  ) {
    const target = await this.loadTarget(search);
    if (!target) throw new Error('The subtitle search target no longer exists');
    ctx.languages ??= this.prisma.language.findMany({
      select: { tag: true, iso2: true, iso3: true },
    });
    const codes = providerLanguageCodes(language, await ctx.languages);
    if (codes.length === 0) return [];

    const releaseName = await this.releaseName(search);
    const query = async (languages: string[]) => {
      const params: OsSearchParams =
        search.movieId !== null
          ? {
              tmdbId: target.tmdbId,
              languages: languages.join(','),
              moviehash: search.movieHash,
            }
          : {
              parentTmdbId: target.tmdbId,
              season: target.seasonNumber!,
              episode: target.episodeNumber!,
              languages: languages.join(','),
              moviehash: search.movieHash,
            };
      return filterAndRank(
        await this.openSubtitles.search(params),
        releaseName,
      );
    };

    // Spec 118, REQ-13
    const wanted = (search.wantedVariants ?? null) as Record<
      string,
      string
    > | null;
    const variantCode = wanted?.[language]
      ? providerVariantCode(wanted[language])
      : null;
    if (!variantCode) return query(codes);

    const preferred = await query([variantCode]);
    this.logger.debug(
      `Subtitle search ${search.id} ${language}: variant query ${variantCode} returned ${preferred.length}`,
    );
    if (preferred.length >= MAX_CANDIDATES_PER_LANGUAGE) {
      return preferred.slice(0, MAX_CANDIDATES_PER_LANGUAGE);
    }
    const plain = await query(codes);
    this.logger.debug(
      `Subtitle search ${search.id} ${language}: plain query ${codes.join(',')} returned ${plain.length}`,
    );
    const seen = new Set(preferred.map((c) => c.id));
    return [...preferred, ...plain.filter((c) => !seen.has(c.id))].slice(
      0,
      MAX_CANDIDATES_PER_LANGUAGE,
    );
  }

  private unresolved(search: Search): string[] {
    return this.missingLanguages(search).filter(
      (language) =>
        !this.attemptsOf(search, language).some(
          (attempt) => attempt.status === 'ACCEPTED',
        ),
    );
  }

  // Spec 107, REQ-9; Spec 121, REQ-8
  private async flagProvider(
    search: Search,
    ctx: StepContext,
    kind: SubtitleProviderKind,
    languages: string[],
    key: string,
  ): Promise<void> {
    const flagged: string[] = [];
    for (const language of languages) {
      const chain = await this.chainOf(search, language, ctx);
      if (this.currentProvider(ctx, language, chain) !== kind) continue;
      flagged.push(language);
      ctx.progress[language] = { ...(ctx.progress[language] ?? {}), [kind]: key };
      if (this.currentProvider(ctx, language, chain) === null) {
        ctx.errors[language] ??= key;
      }
    }
    if (flagged.length === 0) return;
    await this.prisma.subtitleSearch.updateMany({
      where: { id: search.id },
      data: { languageErrors: ctx.errors, providerProgress: ctx.progress },
    });
    await this.prisma.subtitleSearchAttempt.updateMany({
      where: {
        searchId: search.id,
        languageIso3: { in: flagged },
        provider: kind,
        status: 'QUEUED',
        stagedPath: null,
      },
      data: { status: 'FAILED', reasonKey: key, finishedAt: new Date() },
    });
  }

  // Spec 103, REQ-10 NFR-4
  private async validating(search: Search, ctx: StepContext): Promise<void> {
    for (const language of this.missingLanguages(search)) {
      let own = this.attemptsOf(search, language);
      if (own.length === 0) continue;

      if (own.some((attempt) => attempt.status === 'ACCEPTED')) {
        await this.prisma.subtitleSearchAttempt.updateMany({
          where: {
            searchId: search.id,
            languageIso3: language,
            status: 'QUEUED',
            stagedPath: null,
          },
          data: { status: 'REJECTED', finishedAt: new Date() },
        });
        continue;
      }

      const running = own.find(inFlight);
      if (running) {
        const age = await this.staging.ageMs(running.stagedPath!);
        if (age !== null && age < SYNC_BACKSTOP_MS) return;
        await this.failAttempt(
          running,
          ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED,
          ['QUEUED', 'RUNNING'],
        );
        own = own.map((attempt) =>
          attempt.id === running.id
            ? { ...attempt, status: 'FAILED' as const }
            : attempt,
        );
      }

      if (await this.startNext(search, own, ctx)) return;
    }

    if (await this.transition(search.id, 'VALIDATING', 'SEARCHING', {})) {
      await this.wake(search.id, 0);
    }
  }

  // Spec 103, REQ-11 REQ-12
  private async embedding(search: Search): Promise<void> {
    if (search.subtitleEmbedId === null) {
      const seen = new Set<string>();
      const tracks = search.attempts
        .filter(
          (attempt) =>
            attempt.status === 'ACCEPTED' &&
            attempt.stagedPath !== null &&
            attempt.offsetMs !== null,
        )
        .filter((attempt) => {
          if (seen.has(attempt.languageIso3)) return false;
          seen.add(attempt.languageIso3);
          return true;
        })
        .map((attempt) => ({
          languageIso3: attempt.languageIso3,
          stagedPath: attempt.stagedPath!,
          offsetMs: attempt.offsetMs!,
          // Spec 118, REQ-16
          variantTag: attempt.variantTag,
          // Spec 121, REQ-15
          provenance: provenanceOf(attempt),
          // Spec 123, REQ-9
          provider: kindOf(attempt).toLowerCase(),
          syncScore: attempt.score,
          framerateRatio: attempt.framerateRatio,
        }));

      if (tracks.length === 0) {
        await this.complete(search.id, 'EMBEDDING');
        return;
      }

      // Spec 107, REQ-4
      const mkvPath =
        search.libraryPath ?? (await this.loadTarget(search))?.filePath;
      if (!mkvPath) {
        await this.fail(search.id, ERROR_KEYS.SUBTITLE_SEARCH_NO_LIBRARY_PATH);
        return;
      }
      const embed = await this.subtitleEmbed.embedStaged(
        this.refOf(search),
        tracks,
        mkvPath,
        // Spec 119, REQ-5
        strings(search.replaceLanguages).filter((iso3) =>
          tracks.some((track) => track.languageIso3 === iso3),
        ),
      );
      const stored = await this.prisma.subtitleSearch.updateMany({
        where: { id: search.id, status: 'EMBEDDING', subtitleEmbedId: null },
        data: { subtitleEmbedId: embed.id },
      });
      if (stored.count === 1) await this.wake(search.id, EMBED_POLL_MS);
      return;
    }

    const embed = await this.prisma.subtitleEmbed.findUnique({
      where: { id: search.subtitleEmbedId },
    });
    if (!embed) {
      await this.fail(search.id, ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED);
    } else if (embed.status === 'COMPLETED') {
      await this.complete(search.id, 'EMBEDDING');
    } else if (embed.status === 'FAILED') {
      await this.fail(
        search.id,
        embed.errorKey ?? ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED,
      );
    } else {
      await this.wake(search.id, EMBED_POLL_MS);
    }
  }

  // Spec 103, REQ-9
  private async startNext(
    search: Search,
    own: SubtitleSearchAttempt[],
    ctx: StepContext,
  ): Promise<boolean> {
    const pending = own
      .filter(
        (attempt) => attempt.status === 'QUEUED' && attempt.stagedPath === null,
      )
      .sort((a, b) => a.rank - b.rank);

    for (const attempt of pending) {
      const kind = kindOf(attempt);
      let stagedPath: string;
      let remaining: number | null = null;
      let provenance: string | null = null;
      try {
        let bytes: Buffer;
        if (kind === SubtitleProviderKind.SUBDIVX) {
          const downloaded = await this.subdivx.download(
            attempt.providerSubtitleId,
          );
          const target = await this.loadTarget(search);
          const extracted = await extractSrt(
            downloaded.bytes,
            target?.seasonNumber !== undefined &&
              target.episodeNumber !== undefined
              ? { season: target.seasonNumber, episode: target.episodeNumber }
              : undefined,
          );
          if ('rejected' in extracted) {
            await this.failAttempt(
              attempt,
              ERROR_KEYS.SUBTITLE_SEARCH_ARCHIVE_UNUSABLE,
              ['QUEUED'],
            );
            continue;
          }
          bytes = toUtf8(extracted.srt);
          const named = extracted.entryName || downloaded.fileName;
          provenance = named ? named.slice(0, 500) : null;
        } else {
          const downloaded = await this.openSubtitles.download(
            attempt.providerSubtitleId,
          );
          remaining = downloaded.remaining;
          bytes = downloaded.bytes;
        }
        stagedPath = await this.staging.write(search.id, attempt.id, bytes);
      } catch (error) {
        if (error instanceof SubdivxCandidateFetchError) {
          this.logger.warn(
            `Fetching candidate ${attempt.id} of search ${search.id} failed: ${error.message}`,
          );
          await this.failAttempt(
            attempt,
            ERROR_KEYS.SUBTITLE_SEARCH_FETCH_FAILED,
            ['QUEUED'],
          );
          continue;
        }
        if (
          error instanceof SubtitleProviderHttpError &&
          (error.kind === 'quota' ||
            error.kind === 'unauthorized' ||
            (kind === SubtitleProviderKind.SUBDIVX &&
              (error.kind === 'rate_limited' || error.kind === 'unavailable')))
        ) {
          const key =
            error.kind === 'quota'
              ? ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED
              : error.kind === 'unauthorized'
                ? ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED
                : ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAVAILABLE;
          await this.failAttempt(attempt, key, ['QUEUED']);
          await this.flagProvider(
            search,
            ctx,
            kind,
            error.kind === 'rate_limited' || error.kind === 'unavailable'
              ? [attempt.languageIso3]
              : this.unresolved(search),
            key,
          );
          return false;
        }
        this.logger.warn(
          `Fetching candidate ${attempt.id} of search ${search.id} failed: ${String(error)}`,
        );
        await this.failAttempt(
          attempt,
          ERROR_KEYS.SUBTITLE_SEARCH_FETCH_FAILED,
          ['QUEUED'],
        );
        continue;
      }

      const claimed = await this.prisma.subtitleSearchAttempt.updateMany({
        where: { id: attempt.id, status: 'QUEUED', stagedPath: null },
        data: provenance ? { stagedPath, providerFileName: provenance } : { stagedPath },
      });
      if (claimed.count === 0) return true;

      try {
        await this.syncQueue.addSync({ subtitleSyncId: attempt.id });
      } catch (error) {
        this.logger.warn(
          `Could not queue the sync of candidate ${attempt.id}: ${String(error)}`,
        );
        await this.failAttempt(
          { ...attempt, stagedPath },
          ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED,
          ['QUEUED'],
        );
        continue;
      }

      if (remaining === 0) {
        // Spec 107, REQ-9
        await this.flagProvider(
          search,
          ctx,
          kind,
          this.unresolved(search).filter(
            (language) => language !== attempt.languageIso3,
          ),
          ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED,
        );
      }

      await this.moveToValidating(search.id);
      return true;
    }

    return false;
  }

  // Spec 103, NFR-4
  private async arm(
    searchId: number,
    attempt: SubtitleSearchAttempt,
  ): Promise<void> {
    if (attempt.status === 'QUEUED') {
      try {
        await this.syncQueue.addSync({ subtitleSyncId: attempt.id });
      } catch (error) {
        this.logger.warn(
          `Could not re-queue the sync of candidate ${attempt.id}: ${String(error)}`,
        );
      }
    }
    await this.moveToValidating(searchId);
  }

  private async moveToValidating(searchId: number): Promise<void> {
    await this.prisma.subtitleSearch.updateMany({
      where: { id: searchId, status: { in: ['SEARCHING', 'VALIDATING'] } },
      data: { status: 'VALIDATING' },
    });
    await this.wake(searchId, SYNC_BACKSTOP_MS);
  }

  private async failAttempt(
    attempt: SubtitleSearchAttempt,
    reasonKey: string,
    from: Array<'QUEUED' | 'RUNNING'>,
  ): Promise<void> {
    await this.prisma.subtitleSearchAttempt.updateMany({
      where: { id: attempt.id, status: { in: from } },
      data: { status: 'FAILED', reasonKey, finishedAt: new Date() },
    });
    if (attempt.stagedPath) await this.staging.removeFile(attempt.stagedPath);
  }

  // Spec 103, REQ-9
  private async purgeRejected(search: Search): Promise<void> {
    for (const attempt of search.attempts) {
      if (
        attempt.stagedPath &&
        (attempt.status === 'REJECTED' || attempt.status === 'FAILED')
      ) {
        await this.staging.removeFile(attempt.stagedPath);
      }
    }
  }

  private async transition(
    searchId: number,
    from: (typeof NON_TERMINAL)[number],
    to: (typeof NON_TERMINAL)[number],
    data: Prisma.SubtitleSearchUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.prisma.subtitleSearch.updateMany({
      where: { id: searchId, status: from },
      data: { ...data, status: to },
    });
    return result.count === 1;
  }

  private async complete(
    searchId: number,
    from: (typeof NON_TERMINAL)[number],
  ): Promise<void> {
    const result = await this.prisma.subtitleSearch.updateMany({
      where: { id: searchId, status: from },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
    if (result.count === 1) await this.settleStaging(searchId);
  }

  private async fail(searchId: number, errorKey: string): Promise<void> {
    const result = await this.prisma.subtitleSearch.updateMany({
      where: { id: searchId, status: { in: [...NON_TERMINAL] } },
      data: { status: 'FAILED', errorKey, finishedAt: new Date() },
    });
    if (result.count === 1) await this.settleStaging(searchId);
  }

  // Spec 103, REQ-9 REQ-12
  private async settleStaging(searchId: number): Promise<void> {
    if (await this.embedActive(searchId)) {
      await this.wake(searchId, EMBED_POLL_MS);
      return;
    }
    await this.staging.removeSearch(searchId);
  }

  private async embedActive(searchId: number): Promise<boolean> {
    const row = await this.prisma.subtitleSearch.findUnique({
      where: { id: searchId },
      select: { subtitleEmbed: { select: { status: true } } },
    });
    const status = row?.subtitleEmbed?.status;
    return status === 'QUEUED' || status === 'RUNNING';
  }

  private async keepsStaging(searchId: number): Promise<boolean> {
    const row = await this.prisma.subtitleSearch.findUnique({
      where: { id: searchId },
      select: { status: true },
    });
    if (row && !isTerminal(row.status)) return true;
    return row ? this.embedActive(searchId) : false;
  }

  private async wake(searchId: number, delayMs: number): Promise<void> {
    try {
      await this.queue.wake(searchId, delayMs);
    } catch (error) {
      this.logger.warn(
        `Could not wake subtitle search ${searchId}: ${String(error)}`,
      );
    }
  }

  private missingLanguages(search: Search): string[] {
    // Spec 119, REQ-4
    const ticked = new Set(strings(search.replaceLanguages));
    const present = new Set(
      strings(search.presentLanguages).filter((iso3) => !ticked.has(iso3)),
    );
    return strings(search.wantedLanguages).filter(
      (language) => !present.has(language),
    );
  }

  private attemptsOf(
    search: Search,
    language: string,
    kind?: SubtitleProviderKind,
  ): SubtitleSearchAttempt[] {
    return search.attempts
      .filter(
        (attempt) =>
          attempt.languageIso3 === language &&
          (kind === undefined || kindOf(attempt) === kind),
      )
      .sort((a, b) => a.rank - b.rank);
  }

  private refOf(search: Search): TargetRef {
    return search.movieId !== null
      ? { kind: 'movie', id: search.movieId }
      : { kind: 'episode', id: search.episodeId! };
  }

  private async loadTarget(search: Search): Promise<Target | null> {
    if (search.movieId !== null) {
      const movie = await this.prisma.movie.findUnique({
        where: { id: search.movieId },
        select: { filePath: true, tmdbId: true, title: true, releaseDate: true },
      });
      return movie && { ...movie, year: movie.releaseDate?.getUTCFullYear() ?? null };
    }
    const episode = await this.prisma.episode.findUnique({
      where: { id: search.episodeId! },
      select: {
        filePath: true,
        episodeNumber: true,
        season: {
          select: {
            seasonNumber: true,
            show: { select: { id: true, tmdbId: true, title: true } },
          },
        },
      },
    });
    if (!episode) return null;
    return {
      filePath: episode.filePath,
      tmdbId: episode.season.show.tmdbId,
      title: episode.season.show.title,
      imdbTitleId: episode.season.show.id,
      seasonNumber: episode.season.seasonNumber,
      episodeNumber: episode.episodeNumber,
    };
  }

  // Spec 103, REQ-8
  private async releaseName(search: Search): Promise<string> {
    const job = await this.prisma.processJob.findFirst({
      where: {
        ...(search.movieId !== null
          ? { movieId: search.movieId }
          : { episodeId: search.episodeId! }),
        status: 'COMPLETED',
      },
      orderBy: { id: 'desc' },
      select: {
        outputFilePath: true,
        sourceFile: {
          select: { mediaSource: { select: { downloadPath: true } } },
        },
      },
    });
    const downloadPath = job?.sourceFile?.mediaSource?.downloadPath;
    if (downloadPath) return basename(downloadPath);
    const output = job?.outputFilePath;
    return output ? basename(output, extname(output)) : '';
  }
}
