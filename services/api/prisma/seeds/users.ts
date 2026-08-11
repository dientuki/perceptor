import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seedUsers(prisma: PrismaClient) {
  console.log('Seeding users...');

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { username },
    // Re-running the seed repairs an install that lost its admin (NFR-1) —
    // it never touches name/password of an existing row, only isAdmin.
    update: { isAdmin: true },
    create: {
      username,
      name: 'Admin',
      password: hashedPassword,
      isAdmin: true,
    },
  });
}