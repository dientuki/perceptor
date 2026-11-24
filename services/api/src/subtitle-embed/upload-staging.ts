import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { StagingDirectory } from '@/media-roots/staging-directory';
import { ACTIVE_EMBED_STATUSES } from './active-embed.guard';

const STAGING_DIR = '.perceptor/subtitle-upload';

// Spec 124, REQ-12
@Injectable()
export class SubtitleUploadStaging implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubtitleUploadStaging.name);
  private readonly directory: StagingDirectory;

  constructor(
    mediaRoots: MediaRootsService,
    private readonly prisma: PrismaService,
  ) {
    this.directory = new StagingDirectory(
      mediaRoots,
      STAGING_DIR,
      SubtitleUploadStaging.name,
    );
  }

  // Spec 124, REQ-12
  write(embedId: number, index: number, bytes: Buffer): Promise<string> {
    return this.directory.write(embedId, `${index}.srt`, bytes);
  }

  // Spec 124, REQ-12
  removeEmbed(embedId: number): Promise<void> {
    return this.directory.removeDir(embedId);
  }

  // Spec 124, REQ-12
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `Could not sweep the upload staging directories: ${String(error)}`,
      );
    }
  }

  // Spec 124, REQ-12
  async sweep(): Promise<void> {
    await this.directory.sweep(async (embedId) => {
      const row = await this.prisma.subtitleEmbed.findUnique({
        where: { id: embedId },
        select: { status: true },
      });
      return (
        row !== null &&
        (ACTIVE_EMBED_STATUSES as readonly string[]).includes(row.status)
      );
    });
  }
}
