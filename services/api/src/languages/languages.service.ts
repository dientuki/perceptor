import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { Language } from './entities/language.entity';
import { languageNameFor } from './language-names';

// The single place that turns a `languages` row into the shape `web`'s
// pickers render — see `clients/media-server/registry.ts` for the precedent
// of "options come from one place, never a hard-coded list at the call
// site". Preference read/write for the three mutations lands here too.
//
// Every write below shares the same shape: validate the whole `iso2` list
// (no unknown code, no duplicate) *before* touching the database, then
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
    return rows
      .map((row) => ({
        id: row.id,
        iso2: row.iso2,
        iso3: row.iso3,
        name: languageNameFor(row.iso2),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Resolves every iso2 to its Language row, throwing on the first unknown
  // or duplicated code — before any database write happens for the caller.
  private async resolveLanguageIds(iso2Codes: string[]): Promise<number[]> {
    const seen = new Set<string>();
    for (const iso2 of iso2Codes) {
      if (seen.has(iso2)) {
        throw i18nError.badRequest(ERROR_KEYS.LANGUAGE_DUPLICATE, { iso2 });
      }
      seen.add(iso2);
    }

    if (iso2Codes.length === 0) return [];

    const rows = await this.prisma.language.findMany({
      where: { iso2: { in: iso2Codes } },
    });
    const byIso2 = new Map(rows.map((row) => [row.iso2, row.id]));

    return iso2Codes.map((iso2) => {
      const id = byIso2.get(iso2);
      if (id === undefined) {
        throw i18nError.badRequest(ERROR_KEYS.LANGUAGE_UNAVAILABLE, { iso2 });
      }
      return id;
    });
  }

  // A user's global preference (User.preferredLanguages). Replaces the
  // whole set; [] clears it.
  async setPreferredLanguagesFor(userId: string, iso2Codes: string[]): Promise<Language[]> {
    const languageIds = await this.resolveLanguageIds(iso2Codes);

    await this.prisma.$transaction(async (tx) => {
      await tx.userLanguage.deleteMany({ where: { userId } });
      if (languageIds.length > 0) {
        await tx.userLanguage.createMany({
          data: languageIds.map((languageId) => ({ userId, languageId })),
        });
      }
    });

    return this.findPreferredLanguagesFor(userId);
  }

  async findPreferredLanguagesFor(userId: string): Promise<Language[]> {
    const rows = await this.prisma.userLanguage.findMany({
      where: { userId },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  // A user's per-title preference for a film, added to their global
  // preference at encode time — never a replacement for it. Replaces the
  // whole set for this (userId, movieId) pair; [] clears it.
  async setMoviePreferredLanguagesFor(
    userId: string,
    movieId: number,
    iso2Codes: string[],
  ): Promise<Language[]> {
    const languageIds = await this.resolveLanguageIds(iso2Codes);

    await this.prisma.$transaction(async (tx) => {
      await tx.userMovieLanguage.deleteMany({ where: { userId, movieId } });
      if (languageIds.length > 0) {
        await tx.userMovieLanguage.createMany({
          data: languageIds.map((languageId) => ({ userId, movieId, languageId })),
        });
      }
    });

    return this.findMoviePreferredLanguagesFor(userId, movieId);
  }

  async findMoviePreferredLanguagesFor(userId: string, movieId: number): Promise<Language[]> {
    const rows = await this.prisma.userMovieLanguage.findMany({
      where: { userId, movieId },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  // A user's per-title preference for a series, added to their global
  // preference at encode time — never a replacement for it. Replaces the
  // whole set for this (userId, showId) pair; [] clears it.
  async setShowPreferredLanguagesFor(
    userId: string,
    showId: number,
    iso2Codes: string[],
  ): Promise<Language[]> {
    const languageIds = await this.resolveLanguageIds(iso2Codes);

    await this.prisma.$transaction(async (tx) => {
      await tx.userShowLanguage.deleteMany({ where: { userId, showId } });
      if (languageIds.length > 0) {
        await tx.userShowLanguage.createMany({
          data: languageIds.map((languageId) => ({ userId, showId, languageId })),
        });
      }
    });

    return this.findShowPreferredLanguagesFor(userId, showId);
  }

  async findShowPreferredLanguagesFor(userId: string, showId: number): Promise<Language[]> {
    const rows = await this.prisma.userShowLanguage.findMany({
      where: { userId, showId },
      include: { language: true },
    });
    return rows.map((row) => this.toLanguage(row.language));
  }

  private toLanguage(row: { id: number; iso2: string; iso3: string }): Language {
    return { id: row.id, iso2: row.iso2, iso3: row.iso3, name: languageNameFor(row.iso2) };
  }
}
