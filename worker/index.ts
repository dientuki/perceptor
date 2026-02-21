// worker/index.ts
import { startTorrentWatcher } from './torrentWatcher'
import { startRipWatcher } from './ripWatcher'
import { logger } from "@/lib/logger";

logger.info('🧠 Perceptor Worker iniciado...')

async function bootstrap() {
  logger.info('🚀 Iniciando watchers...')

  //startTorrentWatcher()
  startRipWatcher()
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