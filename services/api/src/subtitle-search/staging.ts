import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MediaRootsService } from '@/media-roots/media-roots.service';

const STAGING_DIR = '.perceptor/subtitle-search';

// Spec 103, REQ-9
@Injectable()
export class SubtitleSearchStaging {
  private readonly logger = new Logger(SubtitleSearchStaging.name);

  constructor(private readonly mediaRoots: MediaRootsService) {}

  // Spec 103, REQ-9
  async write(
    searchId: number,
    attemptId: number,
    bytes: Buffer,
  ): Promise<string> {
    const path = await this.mediaRoots.resolveFromRoot(
      'downloads',
      `${STAGING_DIR}/${searchId}/${attemptId}.srt`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return path;
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
  async removeSearch(searchId: number): Promise<void> {
    try {
      const dir = await this.mediaRoots.resolveFromRoot(
        'downloads',
        `${STAGING_DIR}/${searchId}`,
      );
      if (!(await this.mediaRoots.isInsideRoot('downloads', dir))) return;
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Could not delete the staging directory of search ${searchId}: ${String(error)}`,
      );
    }
  }

  // Spec 103, NFR-4
  async sweep(keep: (searchId: number) => Promise<boolean>): Promise<void> {
    let names: string[];
    try {
      const root = await this.mediaRoots.resolveFromRoot(
        'downloads',
        STAGING_DIR,
      );
      names = await readdir(root);
    } catch {
      return;
    }

    for (const name of names) {
      const searchId = Number(name);
      if (!Number.isInteger(searchId) || String(searchId) !== name) continue;
      if (await keep(searchId)) continue;
      await this.removeSearch(searchId);
    }
  }
}
