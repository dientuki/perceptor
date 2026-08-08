import { PrismaClient, SourceKind, SourceStatus, MediaStatus } from '@prisma/client';

// Estado de prueba: replica una MediaSource justo antes de que qBittorrent avise
// que terminó (DOWNLOADING, sin escanear todavía), para poder disparar
// torrentCompleted a mano y ejercitar el pipeline entero (process -> worker ->
// sourceScanned -> encode) sin depender de un torrent real.
export async function seedMediaSource(prisma: PrismaClient) {
  console.log('Seeding media source...');

  const movie = await prisma.movie.findUnique({ where: { tmdbId: 27205 } });
  if (!movie) {
    console.log('[seedMediaSource] Movie tmdbId 27205 no existe, se omite');
    return;
  }

  const mediaSource = await prisma.mediaSource.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      kind: SourceKind.TORRENT_SEARCH,
      status: SourceStatus.DOWNLOADING,
      infoHash: 'D8AE740F029C118B43F6C7A87F4F3D6325E94249',
      downloadPath: '/media/downloads/02ba37fd5d6d8c67',
    },
  });

  await prisma.movie.update({
    where: { id: movie.id },
    data: { mediaSourceId: mediaSource.id, status: MediaStatus.DOWNLOADING },
  });
}
