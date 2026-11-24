import { Injectable, Logger } from '@nestjs/common';
import { rm, stat } from 'node:fs/promises';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { StagingDirectory } from '@/media-roots/staging-directory';

const STAGING_DIR = '.perceptor/subtitle-search';

// Spec 103, REQ-9
@Injectable()
export class SubtitleSearchStaging {
  private readonly logger = new Logger(SubtitleSearchStaging.name);
  private readonly directory: StagingDirectory;

  constructor(private readonly mediaRoots: MediaRootsService) {
    this.directory = new StagingDirectory(
      mediaRoots,
      STAGING_DIR,
      SubtitleSearchStaging.name,
    );
  }

  // Spec 103, REQ-9
  write(searchId: number, attemptId: number, bytes: Buffer): Promise<string> {
    return this.directory.write(searchId, `${attemptId}.srt`, bytes);
  }

  // Spec 103, REQ-9
  async ageMs(path: string): Promise<number | null> {
    try {
      return Date.now() - (await stat(path)).mtimeMs;
    } catch {
      return null;
    }
  }

  // Spec 103, REQ-9
  async removeFile(path: string): Promise<void> {
    if (!(await this.mediaRoots.isInsideRoot('downloads', path))) {
      this.logger.warn(
        `Refusing to delete a path outside the downloads root: ${path}`,
      );
      return;
    }
    await rm(path, { force: true });
  }

  // Spec 103, REQ-9
  removeSearch(searchId: number): Promise<void> {
    return this.directory.removeDir(searchId);
  }

  // Spec 103, NFR-4
  sweep(keep: (searchId: number) => Promise<boolean>): Promise<void> {
    return this.directory.sweep(keep);
  }
}
