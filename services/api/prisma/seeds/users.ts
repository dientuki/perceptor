import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seedUsers(prisma: PrismaClient) {
  console.log('Seeding users...');

  const hashedPassword = await bcrypt.hash('pass123', 10);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {}, // Si ya existe, no sobrescribe
    create: {
      username: 'admin',
      name: 'Admin',
      password: hashedPassword,
    },
  });
}