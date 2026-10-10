import { PrismaService } from '../src/prisma/prisma.service';
import { TitleStatusService } from '../src/title-status/title-status.service';

// Spec 089, NFR-3 AC-16
export async function recomputeAllStatuses(prisma: PrismaService): Promise<void> {
  const titleStatus = new TitleStatusService(prisma);

  const movies = await prisma.movie.findMany({ select: { id: true } });
  for (const movie of movies) {
    await titleStatus.recomputeMovie(movie.id);
  }

  const episodes = await prisma.episode.findMany({ select: { id: true } });
  for (const episode of episodes) {
    await titleStatus.recomputeEpisode(episode.id);
  }

  const shows = await prisma.show.findMany({ select: { id: true } });
  for (const show of shows) {
    await titleStatus.recomputeShow(show.id);
  }
}

async function main() {
  const prisma = new PrismaService();

  try {
    await prisma.$connect();
    await recomputeAllStatuses(prisma);
    process.stdout.write('Recomputed every Movie, Episode and Show status.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Error running recompute-statuses:', e);
    process.exit(1);
  });
}
