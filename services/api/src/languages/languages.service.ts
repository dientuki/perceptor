import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { LanguageTrackKind } from '@prisma/client';
import { Language } from './entities/language.entity';
import { languageNameFor } from './language-names';

// The single place that turns a `languages` row into the shape `web`'s
// pickers render — see `clients/media-server/registry.ts` for the precedent
// of "options come from one place, never a hard-coded list at the call
// site". Preference read/write for the two per-title mutations lands here
// too — the per-user global level moved to a `Setting` (029-settings-screen-tabs).
//
// Every write below shares the same shape: validate the whole `tag` list
// (no unknown tag, no duplicate) *before* touching the database, then
// replace the target's rows atomically. If the validation ran after a
// partial delete, or the delete+create pair were not transactional, a
// rejected write could still leave the user with half their old preference
// gone and none of the new one written — a state the caller is told never
// happened.
@Injectable()
export class LanguagesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Language[]> {
    const rows = await this.prisma.language.findMany();
    // A base row (tag === iso2, e.g. `es`) is only hidden when at least one
    // OTHER row shares its iso2 — that is the whole rule. Hiding any row
    // whose tag equals its iso2 unconditionally would hide every ordinary
    // language (`en`, `ja`, `fr`, …), since a single-row language's tag *is*
    // its iso2, and would empty the picker down to just the variants.
    const iso2Counts = new Map<string, number>();
    for (const row of rows) {
      iso2Counts.set(row.iso2, (iso2Counts.get(row.iso2) ?? 0) + 1);
    }
    return rows
      .filter((row) => !(row.tag === row.iso2 && (iso2Counts.get(row.iso2) ?? 0) > 1))
      .map((row) => ({
        id: row.id,
        tag: row.tag,
        iso2: row.iso2,
        iso3: row.iso3,
        name: languageNameFor(row.tag),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Validates a list of BCP-47 tags and resolves each to its Language row,
  // throwing on the first unknown or duplicated tag — before any database
  // write happens for the caller. Public: `SettingsService` reuses this to
  // validate `default_languages` without duplicating the check.
  //
  // This validates against the WHOLE table, not the filtered/pickable
  // catalog `findAll()` returns above — a directly-submitted `es` tag is
  // accepted, because it is a real row that means "Spanish, no variant
  // preference" (030-language-regional-variants).
  async validateAndResolveLanguageIds(tags: string[]): Promise<number[]> {
    const seen = new Set<string>();
    for (const tag of tags) {
      if (seen.has(tag)) {
        throw i18nError.badRequest(ERROR_KEYS.LANGUAGE_DUPLICATE, { tag });
      }
      seen.add(tag);
    }

    if (tags.length === 0) return [];

    const rows = await this.prisma.language.findMany({
      where: { tag: { in: tags } },
    });
    const byTag = new Map(rows.map((row) => [row.tag, row.id]));

    return tags.map((tag) => {
      const id = byTag.get(tag);
      if (id === undefined) {
        throw i18nError.badRequest(ERROR_KEYS.LANGUAGE_UNAVAILABLE, { tag });
      }
      return id;
    });
  }

  // A user's per-title, per-kind preference for a film, added to the
  // installation's `default_languages` setting at encode time — never a
  // replacement for it (029-settings-screen-tabs). Replaces the whole set for
  // this (userId, movieId, kind) triple; [] clears it. The delete is narrowed
  // to `{ userId, movieId, kind }` — never bare `{ userId, movieId }` — so
  // writing AUDIO can never wipe the sibling SUBTITLE rows for the same title
  // (039-per-title-language-split).
  async setMoviePreferredTrackLanguagesFor(
    userId: string,
    movieId: number,
    kind: LanguageTrackKind,
    tags: string[],
  ): Promise<Language[]> {
    const languageIds = await this.validateAndResolveLanguageIds(tags);

    await this.prisma.$transaction(async (tx) => {
      await tx.userMovieLanguage.deleteMany({ where: { userId, movieId, kind } });
      if (languageIds.length > 0) {
        await tx.userMovieLanguage.createMany({
          data: languageIds.map((languageId) => ({ userId, movieId, kind, languageId })),
        });
      }
    });

    return this.findMoviePreferredTrackLanguagesFor(userId, movieId, kind);
  }

  async findMoviePreferredTrackLanguagesFor(
    userId: string,
    movieId: number,
    kind: LanguageTrackKind,
  ): Promise<Language[]> {
    const rows = await this.prisma.userMovieLanguage.findMany({
      where: { userId, movieId, kind },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  // A user's per-title, per-kind preference for a series, added to the
  // installation's `default_languages` setting at encode time — never a
  // replacement for it (029-settings-screen-tabs). Replaces the whole set for
  // this (userId, showId, kind) triple; [] clears it. Same narrowed-delete
  // reasoning as the movie twin above (039-per-title-language-split).
  async setShowPreferredTrackLanguagesFor(
    userId: string,
    showId: number,
    kind: LanguageTrackKind,
    tags: string[],
  ): Promise<Language[]> {
    const languageIds = await this.validateAndResolveLanguageIds(tags);

    await this.prisma.$transaction(async (tx) => {
      await tx.userShowLanguage.deleteMany({ where: { userId, showId, kind } });
      if (languageIds.length > 0) {
        await tx.userShowLanguage.createMany({
          data: languageIds.map((languageId) => ({ userId, showId, kind, languageId })),
        });
      }
    });

    return this.findShowPreferredTrackLanguagesFor(userId, showId, kind);
  }

  async findShowPreferredTrackLanguagesFor(
    userId: string,
    showId: number,
    kind: LanguageTrackKind,
  ): Promise<Language[]> {
    const rows = await this.prisma.userShowLanguage.findMany({
      where: { userId, showId, kind },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  // The caller's own preference, split by kind rather than per-title
  // (021-user-preferences). Replaces the whole set for this (userId, kind)
  // pair; [] clears it. The delete is narrowed to `{ userId, kind }` — never
  // `{ userId }` — so writing AUDIO can never wipe the sibling SUBTITLE rows.
  async setPreferredTrackLanguagesFor(
    userId: string,
    kind: LanguageTrackKind,
    tags: string[],
  ): Promise<Language[]> {
    const languageIds = await this.validateAndResolveLanguageIds(tags);

    await this.prisma.$transaction(async (tx) => {
      await tx.userLanguagePreference.deleteMany({ where: { userId, kind } });
      if (languageIds.length > 0) {
        await tx.userLanguagePreference.createMany({
          data: languageIds.map((languageId) => ({ userId, kind, languageId })),
        });
      }
    });

    return this.findPreferredTrackLanguagesFor(userId, kind);
  }

  async findPreferredTrackLanguagesFor(
    userId: string,
    kind: LanguageTrackKind,
  ): Promise<Language[]> {
    const rows = await this.prisma.userLanguagePreference.findMany({
      where: { userId, kind },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  private toLanguage(row: { id: number; tag: string; iso2: string; iso3: string }): Language {
    return {
      id: row.id,
      tag: row.tag,
      iso2: row.iso2,
      iso3: row.iso3,
      name: languageNameFor(row.tag),
    };
  }
}
