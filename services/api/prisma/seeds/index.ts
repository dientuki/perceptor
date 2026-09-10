import { PrismaService } from '../../src/prisma/prisma.service'; // Ajustá la ruta a tu proyecto
import { seedProduction } from '../../src/database/seed/production-seed';
import { seedMovies } from './movie';
import { seedMediaSource } from './media-source';

const prisma = new PrismaService();

async function main() {
  console.log('🌱 Iniciando seeders...');

  await prisma.$connect(); // Conectamos explícitamente

  // The production seed first — languages, admin user, settings — then the
  // development-only fixtures (Inception + a fake in-flight MediaSource),
  // which a real installation must never receive (REQ-11).
  await seedProduction(prisma);
  await seedMovies(prisma);
  await seedMediaSource(prisma);

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
