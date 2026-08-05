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
}