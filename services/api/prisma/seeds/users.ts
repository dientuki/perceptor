import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seedUsers(prisma: PrismaClient) {
  console.log('Seeding users...');

  const hashedPassword = await bcrypt.hash('pass123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@admin' },
    update: {}, // Si ya existe, no sobrescribe
    create: {
      email: 'admin@admin',
      name: 'Admin',
      password: hashedPassword,
    },
  });
}