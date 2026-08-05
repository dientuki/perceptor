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
  const languages = [
    { iso2: 'es', iso3: 'spa' },
    { iso2: 'en', iso3: 'eng' },
    { iso2: 'pt', iso3: 'por' },
  ];

  console.log('Seeding languages...');

  for (const lang of languages) {
    await prisma.language.create({
      data: lang,
    });
  }
}
