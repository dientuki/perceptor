import { PrismaClient } from '@prisma/client';
import { seedLanguages } from '../../../prisma/seeds/languages';
import { seedUsers } from '../../../prisma/seeds/users';
import { seedSettings } from '../../../prisma/seeds/settings';

export async function seedProduction(prisma: PrismaClient): Promise<void> {
  await seedLanguages(prisma);
  await seedUsers(prisma);
  await seedSettings(prisma);
}
