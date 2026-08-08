import { PrismaClient } from '@prisma/client';
//import { logger } from "@/lib/logger";
/*
export async function seedLanguages() {
  const languages = [
    { iso2: 'es', iso3: 'spa' },
    { iso2: 'en', iso3: 'eng' },
    { iso2: 'ja', iso3: 'jpn' },
    // agregá más según necesites
  ];

  for (const lang of languages) {
    await prisma.language.create({ data: lang });
  }

  logger.info('Languages seeded');
}
*/
export async function seedLanguages(prisma: PrismaClient) {
  // originalLanguage de Movie/Show viene de TMDB en iso2. El driver de ffmpeg
  // necesita el iso3 correspondiente (process-jobs.service.ts, resolveIso3) para
  // elegir la pista de audio/subtítulo original — ffprobe reporta tags.language
  // en iso3. Lista ampliada a los orígenes más comunes de releases, no sólo los
  // tres idiomas de la UI (es/en/pt).
  const languages = [
    { iso2: 'es', iso3: 'spa' },
    { iso2: 'en', iso3: 'eng' },
    { iso2: 'pt', iso3: 'por' },
    { iso2: 'ja', iso3: 'jpn' },
    { iso2: 'ko', iso3: 'kor' },
    { iso2: 'fr', iso3: 'fre' },
    { iso2: 'de', iso3: 'ger' },
    { iso2: 'it', iso3: 'ita' },
    { iso2: 'zh', iso3: 'chi' },
    { iso2: 'ru', iso3: 'rus' },
    { iso2: 'hi', iso3: 'hin' },
    { iso2: 'ar', iso3: 'ara' },
    { iso2: 'sv', iso3: 'swe' },
    { iso2: 'da', iso3: 'dan' },
    { iso2: 'nl', iso3: 'dut' },
    { iso2: 'nb', iso3: 'nor' },
    { iso2: 'pl', iso3: 'pol' },
    { iso2: 'tr', iso3: 'tur' },
    { iso2: 'th', iso3: 'tha' },
    { iso2: 'cs', iso3: 'cze' },
  ];

  console.log('Seeding languages...');

  for (const lang of languages) {
    await prisma.language.create({
      data: lang,
    });
  }
}
