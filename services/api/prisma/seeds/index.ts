import { PrismaService } from '../../src/prisma/prisma.service'; // Ajustá la ruta a tu proyecto
import { seedLanguages } from './languages';
import { seedUsers } from './users';

const prisma = new PrismaService();

async function main() {
  console.log('🌱 Iniciando seeders...');

  await prisma.$connect(); // Conectamos explícitamente

  await seedLanguages(prisma);
  await seedUsers(prisma);

  console.log('✅ Seeders completados con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seeders:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });