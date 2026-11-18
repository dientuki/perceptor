import { Injectable, Logger } from '@nestjs/common';
import { SubtitleProviderKind } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { openSubtitlesApiKey } from '@/clients/opensubtitles/key';
import {
  PROVIDER_DEFAULT_KEY,
  PROVIDER_LANGUAGES_KEY,
  PROVIDER_SETTING_KEYS,
  SUBDIVX_SERVED_ISO3,
  SUBTITLE_PROVIDER_KINDS,
  configuredKinds,
  isConfigured,
  servesLanguage,
} from './registry';
import { ProviderLanguage, chain, effectiveDefault, parseLanguages } from './language-chain';
import {
  SubtitleProvider,
  SubtitleProviderSettings,
} from './entities/subtitle-provider.entity';
import {
  SubtitleProviderInput,
  SubtitleProviderLanguageInput,
} from './dto/subtitle-provider.input';

const DISPLAY_NAMES: Record<SubtitleProviderKind, string> = {
  OPENSUBTITLES: 'OpenSubtitles',
  SUBDIVX: 'Subdivx',
};

// Spec 121, REQ-1 REQ-3 REQ-5 REQ-6
@Injectable()
export class SubtitleProvidersService {
  private readonly logger = new Logger(SubtitleProvidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async read(): Promise<SubtitleProviderSettings> {
    const map = await this.settings.getMap();
    const appKeyPresent = openSubtitlesApiKey() !== null;
    const configured = configuredKinds(map, appKeyPresent);
    const defaultKind = effectiveDefault(map[PROVIDER_DEFAULT_KEY], configured);
    const spanishTags = await this.spanishTags();

    const providers: SubtitleProvider[] = SUBTITLE_PROVIDER_KINDS.map((kind) => {
      const keys = PROVIDER_SETTING_KEYS[kind];
      const username = keys.username ? (map[keys.username] ?? '').trim() : '';
      return {
        kind,
        configured: configured.includes(kind),
        isDefault: kind === defaultKind,
        username: username === '' ? null : username,
        secretSet: (map[keys.secret] ?? '').trim() !== '',
        languageTags: kind === SubtitleProviderKind.SUBDIVX ? spanishTags : null,
      };
    });

    return { providers, languages: this.languagesOf(map) };
  }

  async save(input: SubtitleProviderInput): Promise<SubtitleProviderSettings> {
    const { kind } = input;
    const keys = PROVIDER_SETTING_KEYS[kind];
    const givenUsername = (input.username ?? '').trim();

    if (kind === SubtitleProviderKind.SUBDIVX && givenUsername !== '') {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_FIELD_NOT_ALLOWED);
    }
    if (
      kind === SubtitleProviderKind.OPENSUBTITLES &&
      openSubtitlesApiKey() === null
    ) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_APP_KEY_MISSING);
    }

    const map = await this.settings.getMap();
    const username = keys.username
      ? givenUsername !== ''
        ? givenUsername
        : (map[keys.username] ?? '').trim()
      : '';
    const givenSecret = input.secret ?? '';
    const secret =
      givenSecret.trim() !== ''
        ? kind === SubtitleProviderKind.SUBDIVX
          ? givenSecret.trim()
          : givenSecret
        : (map[keys.secret] ?? '');

    if (secret.trim() === '' || (keys.username && username === '')) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_INCOMPLETE);
    }

    const writes: [string, string][] = [[keys.secret, secret]];
    if (keys.username) writes.push([keys.username, username]);

    const appKeyPresent = openSubtitlesApiKey() !== null;
    const configuredBefore = configuredKinds(map, appKeyPresent);
    if (!configuredBefore.includes(kind)) {
      const derived = effectiveDefault(map[PROVIDER_DEFAULT_KEY], configuredBefore);
      if (derived && map[PROVIDER_DEFAULT_KEY] !== derived) {
        writes.push([PROVIDER_DEFAULT_KEY, derived]);
      }
    }

    await this.writeSettings(writes);
    return this.read();
  }

  async remove(kind: SubtitleProviderKind): Promise<SubtitleProviderSettings> {
    const map = await this.settings.getMap();
    if (!isConfigured(kind, map)) {
      throw i18nError.notFound(ERROR_KEYS.SUBTITLE_PROVIDER_NOT_CONFIGURED);
    }

    const keys = PROVIDER_SETTING_KEYS[kind];
    const writes: [string, string][] = [[keys.secret, '']];
    if (keys.username) writes.push([keys.username, '']);

    const languages = this.languagesOf(map).filter((entry) => entry.provider !== kind);
    writes.push([PROVIDER_LANGUAGES_KEY, JSON.stringify(languages)]);
    if (map[PROVIDER_DEFAULT_KEY] === kind) writes.push([PROVIDER_DEFAULT_KEY, '']);

    await this.writeSettings(writes);
    return this.read();
  }

  async setLanguages(
    defaultProvider: SubtitleProviderKind,
    languages: SubtitleProviderLanguageInput[],
  ): Promise<SubtitleProviderSettings> {
    const map = await this.settings.getMap();
    const configured = configuredKinds(map);
    if (!configured.includes(defaultProvider)) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_NOT_CONFIGURED);
    }

    const tags = languages.map((entry) => entry.languageTag);
    const rows = await this.prisma.language.findMany({
      where: { tag: { in: tags } },
      select: { tag: true, iso3: true },
    });
    const iso3ByTag = new Map(rows.map((row) => [row.tag, row.iso3]));

    const seen = new Set<string>();
    for (const entry of languages) {
      const iso3 = iso3ByTag.get(entry.languageTag);
      if (iso3 === undefined) {
        throw i18nError.badRequest(ERROR_KEYS.LANGUAGE_UNAVAILABLE, {
          tag: entry.languageTag,
        });
      }
      if (!servesLanguage(entry.provider, iso3)) {
        throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_LANGUAGE_UNSUPPORTED, {
          provider: DISPLAY_NAMES[entry.provider],
          languageTag: entry.languageTag,
        });
      }
      if (entry.provider === defaultProvider || !configured.includes(entry.provider)) {
        throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_LANGUAGE_INVALID);
      }
      if (seen.has(entry.languageTag)) {
        throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_PROVIDER_LANGUAGE_DUPLICATE);
      }
      seen.add(entry.languageTag);
    }

    await this.writeSettings([
      [PROVIDER_DEFAULT_KEY, defaultProvider],
      [
        PROVIDER_LANGUAGES_KEY,
        JSON.stringify(
          languages.map((entry) => ({
            languageTag: entry.languageTag,
            provider: entry.provider,
          })),
        ),
      ],
    ]);
    return this.read();
  }

  // Spec 121, REQ-7
  async chainFor(
    iso3: string,
    variantTag: string | null | undefined,
  ): Promise<SubtitleProviderKind[]> {
    const map = await this.settings.getMap();
    const configured = configuredKinds(map);
    const base = await this.prisma.language.findMany({
      where: { iso3 },
      select: { tag: true },
    });
    return chain({
      iso3,
      variantTag,
      baseTag: base.find((row) => !row.tag.includes('-'))?.tag ?? null,
      configured,
      defaultKind: effectiveDefault(map[PROVIDER_DEFAULT_KEY], configured),
      languages: this.languagesOf(map),
    });
  }

  private languagesOf(map: Record<string, string>): ProviderLanguage[] {
    return parseLanguages(map[PROVIDER_LANGUAGES_KEY], () =>
      this.logger.warn('subtitle_provider_languages is not valid, reading it as no languages'),
    );
  }

  private async spanishTags(): Promise<string[]> {
    const rows = await this.prisma.language.findMany({
      where: { iso3: SUBDIVX_SERVED_ISO3 },
      select: { tag: true },
      orderBy: { tag: 'asc' },
    });
    return rows.map((row) => row.tag);
  }

  private async writeSettings(entries: [string, string][]): Promise<void> {
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );
  }
}
