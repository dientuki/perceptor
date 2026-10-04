import { Inject, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { MediaRoot } from './entities/media-root.entity';
import { MediaRootConfig, MEDIA_ROOTS } from './media-roots.types';

@Injectable()
export class MediaRootsService {
  constructor(@Inject(MEDIA_ROOTS) private readonly roots: MediaRootConfig[]) {}

  getRoots(): MediaRoot[] {
    return this.roots.map((root) => ({
      id: root.id,
      label: root.label,
      hostPath: root.hostPath,
      available: existsSync(root.containerPath),
    }));
  }

  toHostPath(rootId: string): string {
    return this.getRootConfig(rootId).hostPath;
  }

  containerToHostPath(rootId: string, containerAbsolutePath: string): string | null {
    const root = this.getRootConfig(rootId);

    if (!isAbsolute(root.hostPath)) {
      return null;
    }

    if (
      containerAbsolutePath !== root.containerPath &&
      !containerAbsolutePath.startsWith(root.containerPath + sep)
    ) {
      return null;
    }

    return join(root.hostPath, relative(root.containerPath, containerAbsolutePath));
  }

  // Containment check for a path the api itself already computed and stored (a
  // MediaSource.downloadPath), not one typed by a user — hence returning false
  // rather than throwing for every failure mode (Spec 047, REQ-10): the
  // caller's job is to log and skip the delete, not to blow up the mutation. Reuses
  // the same realpath-of-deepest-existing-ancestor check resolveFromRoot ends with,
  // because a plain prefix/".." guard alone does not catch a symlinked segment.
  async isInsideRoot(rootId: string, absolutePath: string): Promise<boolean> {
    let root: MediaRootConfig;
    try {
      root = this.getRootConfig(rootId);
    } catch {
      return false;
    }

    if (!existsSync(root.containerPath)) {
      return false;
    }

    if (typeof absolutePath !== 'string' || absolutePath.includes('\0')) {
      return false;
    }

    if (!isAbsolute(absolutePath)) {
      return false;
    }

    try {
      const realRoot = await realpath(root.containerPath);
      const realAncestor = await this.realpathOfDeepestExisting(absolutePath);
      return realAncestor === realRoot || realAncestor.startsWith(realRoot + sep);
    } catch {
      return false;
    }
  }

  private getRootConfig(rootId: string): MediaRootConfig {
    const root = this.roots.find((r) => r.id === rootId);
    if (!root) {
      throw i18nError.notFound(ERROR_KEYS.MEDIA_ROOT_UNKNOWN, { rootId });
    }
    return root;
  }

  // Finds the deepest existing ancestor of `path` and realpaths it. `path`
  // does not need to exist in full: a segment like "Movies/New" can point at
  // a folder the worker has not created yet (see encode.ffmpeg.ts, which
  // does a recursive mkdir before writing). What matters is that none of the
  // segments that DO exist is a symlink escaping the root.
  private async realpathOfDeepestExisting(path: string): Promise<string> {
    let current = path;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await stat(current);
        return await realpath(current);
      } catch {
        const parent = dirname(current);
        if (parent === current) {
          // Should never happen: '/' always exists. If we get here,
          // something worse is broken (the container's filesystem, not the path).
          throw new Error(`No se encontró ningún ancestro existente para "${path}"`);
        }
        current = parent;
      }
    }
  }

  // The real security boundary. `relPath` is free text typed by the user in
  // the settings form — never trust that it already arrives sane.
  //
  // With the relative model (the DB stores "Movies", not
  // "/media/library/Movies") a ".." traversal is rejected with a string
  // comparison — no need to canonicalize for that. What IS still needed is
  // the symlink check: the ".." guard stops the user from WRITING an
  // escape, but it does not stop a valid segment (e.g. "Movies") from
  // already being, on the filesystem, a symlink pointing outside the root.
  async resolveFromRoot(
    rootId: string,
    relPath: string,
    opts: { mustExist?: boolean } = {},
  ): Promise<string> {
    const root = this.getRootConfig(rootId);

    if (!existsSync(root.containerPath)) {
      const envVar = `HOST_${root.id === 'downloads' ? 'DOWNLOADS' : 'DESTINATIONS'}_DIR`;
      throw i18nError.badRequest(ERROR_KEYS.MEDIA_ROOT_NOT_MOUNTED, { label: root.label, envVar });
    }

    if (typeof relPath !== 'string' || relPath.includes('\0')) {
      throw i18nError.badRequest(ERROR_KEYS.MEDIA_ROOT_INVALID_PATH);
    }

    if (isAbsolute(relPath)) {
      throw i18nError.forbidden(ERROR_KEYS.MEDIA_ROOT_ABSOLUTE_PATH, {
        label: root.label,
        hostPath: root.hostPath,
      });
    }

    const normalized = normalize(relPath);
    if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
      throw i18nError.forbidden(ERROR_KEYS.MEDIA_ROOT_ESCAPES_ROOT, {
        label: root.label,
        hostPath: root.hostPath,
      });
    }

    const candidate = resolve(root.containerPath, normalized);

    const realRoot = await realpath(root.containerPath);
    const realAncestor = await this.realpathOfDeepestExisting(candidate);
    if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) {
      throw i18nError.forbidden(ERROR_KEYS.MEDIA_ROOT_ESCAPES_ROOT, {
        label: root.label,
        hostPath: root.hostPath,
      });
    }

    if (opts.mustExist) {
      let stats;
      try {
        stats = await stat(candidate);
      } catch {
        throw i18nError.badRequest(ERROR_KEYS.MEDIA_ROOT_FOLDER_NOT_FOUND, { path: relPath, label: root.label });
      }
      if (!stats.isDirectory()) {
        throw i18nError.badRequest(ERROR_KEYS.MEDIA_ROOT_NOT_A_FOLDER, { path: relPath });
      }
    }

    return candidate;
  }
}
