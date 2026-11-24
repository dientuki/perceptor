import { Logger } from '@nestjs/common';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MediaRootsService } from './media-roots.service';

// Spec 124, REQ-12
export class StagingDirectory {
  private readonly logger: Logger;

  constructor(
    private readonly mediaRoots: MediaRootsService,
    private readonly dir: string,
    loggerName: string,
  ) {
    this.logger = new Logger(loggerName);
  }

  // Spec 124, REQ-12
  async write(
    ownerId: number,
    fileName: string,
    bytes: Buffer,
  ): Promise<string> {
    const path = await this.mediaRoots.resolveFromRoot(
      'downloads',
      `${this.dir}/${ownerId}/${fileName}`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return path;
  }

  // Spec 124, REQ-12
  async removeDir(ownerId: number): Promise<void> {
    try {
      const dir = await this.mediaRoots.resolveFromRoot(
        'downloads',
        `${this.dir}/${ownerId}`,
      );
      if (!(await this.mediaRoots.isInsideRoot('downloads', dir))) return;
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Could not delete the staging directory ${this.dir}/${ownerId}: ${String(error)}`,
      );
    }
  }

  // Spec 124, REQ-12
  async sweep(keep: (ownerId: number) => Promise<boolean>): Promise<void> {
    let names: string[];
    try {
      const root = await this.mediaRoots.resolveFromRoot('downloads', this.dir);
      names = await readdir(root);
    } catch {
      return;
    }

    for (const name of names) {
      const ownerId = Number(name);
      if (!Number.isInteger(ownerId) || String(ownerId) !== name) continue;
      if (await keep(ownerId)) continue;
      await this.removeDir(ownerId);
    }
  }
}
