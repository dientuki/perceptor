import { PrismaClient, MediaStatus } from '@prisma/client';

export async function seedMovies(prisma: PrismaClient) {
  console.log('Seeding movies...');

  const movie = await prisma.movie.create({
    data: {
      tmdbId: 27205,
      title: 'Inception',
      overview: 'Cobb es un ladrón capaz de adentrarse en los sueños de la gente para robar sus secretos.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg',
      releaseDate: new Date('2010-07-16'),
      originalLanguage: 'en',
      isLiveAction: true,

      // La película solo está registrada en el sistema, lista para solicitar la descarga más adelante
      status: MediaStatus.MISSING,
      filePath: null,
    },
  });

  // Link the seeded film to the seeded admin — seedUsers runs before seedMovies (index.ts),
  // so the row exists. Without this, a fresh database gives the admin an empty /movies, which
  // is indistinguishable from the migration backfill having failed.
  const username = process.env.ADMIN_USER || 'admin';
  const admin = await prisma.user.findUnique({ where: { username } });
  if (admin) {
    await prisma.userMovie.upsert({
      where: { userId_movieId: { userId: admin.id, movieId: movie.id } },
      update: {},
      create: { userId: admin.id, movieId: movie.id },
    });
  }
}