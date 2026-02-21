import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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
