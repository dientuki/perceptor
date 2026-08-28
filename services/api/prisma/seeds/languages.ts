import { PrismaClient } from '@prisma/client';

export async function seedLanguages(prisma: PrismaClient) {
  // originalLanguage de Movie/Show viene de TMDB en iso2. El driver de ffmpeg
  // necesita el iso3 correspondiente (process-jobs.service.ts,
  // resolveOriginalLanguage) para elegir la pista de audio/subtítulo
  // original — ffprobe reporta tags.language en iso3. Lista ampliada a los
  // orígenes más comunes de releases, no sólo los tres idiomas de la UI
  // (es/en/pt).
  //
  // `tag` is the BCP-47 identifier this feature (030) introduces: every
  // ordinary row's tag equals its iso2, but `es` now sits alongside two
  // regional variants — `es-419` and `es-ES` — that share its iso2/iso3.
  // The bare `es` row stays: it is how a title whose TMDB originalLanguage
  // is "es" resolves to spa (LanguagesService.findAll() hides it from the
  // pickable catalog, but the row itself is still needed).
  const languages = [
    { tag: 'es', iso2: 'es', iso3: 'spa' },
    { tag: 'es-419', iso2: 'es', iso3: 'spa' },
    { tag: 'es-ES', iso2: 'es', iso3: 'spa' },
    { tag: 'en', iso2: 'en', iso3: 'eng' },
    { tag: 'pt', iso2: 'pt', iso3: 'por' },
    { tag: 'ja', iso2: 'ja', iso3: 'jpn' },
    { tag: 'ko', iso2: 'ko', iso3: 'kor' },
    { tag: 'fr', iso2: 'fr', iso3: 'fre' },
    { tag: 'de', iso2: 'de', iso3: 'ger' },
    { tag: 'it', iso2: 'it', iso3: 'ita' },
    { tag: 'zh', iso2: 'zh', iso3: 'chi' },
    { tag: 'ru', iso2: 'ru', iso3: 'rus' },
    { tag: 'hi', iso2: 'hi', iso3: 'hin' },
    { tag: 'ar', iso2: 'ar', iso3: 'ara' },
    { tag: 'sv', iso2: 'sv', iso3: 'swe' },
    { tag: 'da', iso2: 'da', iso3: 'dan' },
    { tag: 'nl', iso2: 'nl', iso3: 'dut' },
    { tag: 'nb', iso2: 'nb', iso3: 'nor' },
    { tag: 'pl', iso2: 'pl', iso3: 'pol' },
    { tag: 'tr', iso2: 'tr', iso3: 'tur' },
    { tag: 'th', iso2: 'th', iso3: 'tha' },
    { tag: 'cs', iso2: 'cs', iso3: 'cze' },
  ];

  console.log('Seeding languages...');

  // Find-then-create rather than a bare `create`: `iso2` is no longer unique
  // (three rows now share `es`), so `tag` — the new unique column — is the
  // key this idempotency check runs against, letting the seed re-run against
  // a database that already holds these rows without failing on a duplicate
  // key.
  for (const lang of languages) {
    const existing = await prisma.language.findUnique({ where: { tag: lang.tag } });
    if (!existing) {
      await prisma.language.create({ data: lang });
    }
  }
}
