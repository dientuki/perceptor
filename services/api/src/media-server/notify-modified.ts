import type { Logger } from '@nestjs/common';
import type { MediaServerService } from '@/media-server/media-server.service';
import type { MediaRootsService } from '@/media-roots/media-roots.service';

// Spec 101, REQ-12; Spec 107, REQ-4; Spec 123, NFR-6
export async function notifyMediaServerModified(
  mediaServer: MediaServerService,
  mediaRoots: MediaRootsService,
  logger: Logger,
  containerFilePath: string,
): Promise<boolean> {
  try {
    const client = await mediaServer.createClient();
    if (!client) return true;
    if (!client.modifiedMedia) {
      logger.warn('Media server refresh skipped: the client cannot be notified');
      return true;
    }
    const hostPath = mediaRoots.containerToHostPath('library', containerFilePath);
    if (!hostPath) {
      logger.warn(
        `Media server refresh skipped: ${containerFilePath} has no host path`,
      );
      return false;
    }
    await client.modifiedMedia(hostPath);
    return true;
  } catch (error) {
    logger.warn(`Media server refresh failed: ${String(error)}`);
    return false;
  }
}
