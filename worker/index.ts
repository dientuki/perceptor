// worker/index.ts
import { startTorrentWatcher } from '@/worker/torrentWatcher'
import { startRipWatcher } from '@/worker/ripWatcher'
import { logger } from "@/lib/logger";
import { createTorrentClient } from "@/clients/torrent/createTorrentClient";
import { TorrentClient } from "@/clients/torrent/types";

logger.info('🧠 Perceptor Worker iniciado...')
let torrentClient: TorrentClient;

async function bootstrap() {
  logger.info('🚀 Iniciando watchers...')

  const torrentClient = await createTorrentClient();

  startTorrentWatcher(torrentClient)
  startRipWatcher(torrentClient)
}

bootstrap()

// Manejo de cierre limpio
process.on('SIGINT', () => {
  logger.info('🛑 Worker detenido (SIGINT)')
  process.exit(0)
})

process.on('SIGTERM', () => {
  logger.info('🛑 Worker detenido (SIGTERM)')
  process.exit(0)
})