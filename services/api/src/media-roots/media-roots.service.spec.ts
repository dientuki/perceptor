import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { MediaRootsService } from './media-roots.service';
import { MEDIA_ROOTS, MediaRootConfig } from './media-roots.types';

// The root of this test is media-roots.service.ts::resolveFromRoot: it is the
// only place in the system that decides whether a path the user typed into
// the settings form may be used. A bug here is a real path traversal against
// the container's filesystem. That is why it runs against a real mkdtemp
// (with real symlinks), not against mocks.
describe('MediaRootsService', () => {
  let service: MediaRootsService;
  let baseDir: string;
  let libraryRoot: string;
  let downloadsRoot: string;
  let siblingWithPrefix: string;
  let outsideDir: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'media-roots-spec-'));
    libraryRoot = join(baseDir, 'library');
    downloadsRoot = join(baseDir, 'downloads');
    // Deliberately shares a string prefix with downloadsRoot: it is the case
    // that breaks a naive `startsWith(root)` comparison with no `+ sep`.
    siblingWithPrefix = join(baseDir, 'downloads-evil');
    outsideDir = join(baseDir, 'outside');

    await mkdir(libraryRoot, { recursive: true });
    await mkdir(join(libraryRoot, 'Movies'), { recursive: true });
    await mkdir(downloadsRoot, { recursive: true });
    await mkdir(siblingWithPrefix, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    // Symlink inside the root pointing outside it.
    await symlink(outsideDir, join(libraryRoot, 'Escape'));
    // Symlink inside the root pointing at a sibling with a shared prefix.
    await symlink(siblingWithPrefix, join(libraryRoot, 'EscapeSibling'));

    const roots: MediaRootConfig[] = [
      { id: 'library', label: 'Biblioteca', hostPath: '/host/library', containerPath: libraryRoot },
      { id: 'downloads', label: 'Descargas', hostPath: '/host/downloads', containerPath: downloadsRoot },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaRootsService, { provide: MEDIA_ROOTS, useValue: roots }],
    }).compile();

    service = module.get<MediaRootsService>(MediaRootsService);
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  describe('getRoots', () => {
    it('exposes hostPath but never containerPath', async () => {
      const roots = service.getRoots();
      const library = roots.find((r) => r.id === 'library');
      expect(library?.hostPath).toBe('/host/library');
      expect(library).not.toHaveProperty('containerPath');
    });

    it('marks available=true when the mount exists', () => {
      const roots = service.getRoots();
      expect(roots.every((r) => r.available)).toBe(true);
    });

    it('marks available=false when the mount is missing', async () => {
      const missingRoots: MediaRootConfig[] = [
        { id: 'library', label: 'Biblioteca', hostPath: '/host/library', containerPath: join(baseDir, 'no-existe') },
      ];
      const module: TestingModule = await Test.createTestingModule({
        providers: [MediaRootsService, { provide: MEDIA_ROOTS, useValue: missingRoots }],
      }).compile();
      const s = module.get<MediaRootsService>(MediaRootsService);
      expect(s.getRoots()[0].available).toBe(false);
    });
  });

  describe('resolveFromRoot — valid cases', () => {
    it('resolves a simple segment', async () => {
      const resolved = await service.resolveFromRoot('library', 'Movies');
      expect(resolved).toBe(join(libraryRoot, 'Movies'));
    });

    it('resolves an empty input to the root itself', async () => {
      const resolved = await service.resolveFromRoot('library', '');
      expect(resolved).toBe(libraryRoot);
    });

    it('resolves "." to the root itself', async () => {
      const resolved = await service.resolveFromRoot('library', '.');
      expect(resolved).toBe(libraryRoot);
    });

    it('allows a leaf that does not exist yet when mustExist is not requested', async () => {
      const resolved = await service.resolveFromRoot('library', 'Nueva/Subcarpeta');
      expect(resolved).toBe(join(libraryRoot, 'Nueva', 'Subcarpeta'));
    });

    it('rejects a non-existent leaf when mustExist=true', async () => {
      await expect(
        service.resolveFromRoot('library', 'NoExiste', { mustExist: true }),
      ).rejects.toThrow();
    });

    it('accepts an existing leaf when mustExist=true', async () => {
      const resolved = await service.resolveFromRoot('library', 'Movies', { mustExist: true });
      expect(resolved).toBe(join(libraryRoot, 'Movies'));
    });
  });

  describe('resolveFromRoot — escapes', () => {
    it('rejects ".."', async () => {
      await expect(service.resolveFromRoot('library', '..')).rejects.toThrow();
    });

    it('rejects a composite traversal that ends up outside the root', async () => {
      await expect(
        service.resolveFromRoot('library', 'Movies/../../downloads'),
      ).rejects.toThrow();
    });

    it('rejects an absolute path', async () => {
      await expect(service.resolveFromRoot('library', '/etc')).rejects.toThrow();
    });

    it('rejects a NUL byte', async () => {
      await expect(service.resolveFromRoot('library', 'Movies\0evil')).rejects.toThrow();
    });

    it('rejects a symlink pointing outside the root', async () => {
      await expect(service.resolveFromRoot('library', 'Escape')).rejects.toThrow();
    });

    it('rejects a symlink pointing at a sibling with a shared prefix', async () => {
      // This is the case that demands the "+ sep" in the prefix comparison:
      // without it, downloadsRoot being a string prefix of siblingWithPrefix
      // would make this symlink pass the check by mistake.
      await expect(service.resolveFromRoot('library', 'EscapeSibling')).rejects.toThrow();
    });

    it('a sibling with a shared prefix is unreachable even by direct composition', async () => {
      // downloadsRoot and siblingWithPrefix share a string prefix; nothing
      // in the relative model lets anyone write a path that escapes
      // libraryRoot, but it is still verified here as a safety net.
      const resolved = await service.resolveFromRoot('downloads', '.');
      expect(resolved).toBe(downloadsRoot);
      expect(resolved.startsWith(siblingWithPrefix)).toBe(false);
    });
  });

  describe('resolveFromRoot — unknown or unmounted root', () => {
    it('rejects a non-existent rootId', async () => {
      await expect(service.resolveFromRoot('nope', 'x')).rejects.toThrow();
    });

    it('rejects when the mount is unavailable', async () => {
      const missingRoots: MediaRootConfig[] = [
        { id: 'library', label: 'Biblioteca', hostPath: '/host/library', containerPath: join(baseDir, 'no-existe') },
      ];
      const module: TestingModule = await Test.createTestingModule({
        providers: [MediaRootsService, { provide: MEDIA_ROOTS, useValue: missingRoots }],
      }).compile();
      const s = module.get<MediaRootsService>(MediaRootsService);
      await expect(s.resolveFromRoot('library', 'x')).rejects.toThrow();
    });
  });

  it('toHostPath returns the root\'s hostPath', () => {
    expect(service.toHostPath('library')).toBe('/host/library');
  });

  describe('containerToHostPath', () => {
    it('translates a path inside the root', () => {
      const result = service.containerToHostPath('library', join(libraryRoot, 'Movies', 'x.mkv'));
      expect(result).toBe(join('/host/library', 'Movies', 'x.mkv'));
    });

    it('translates the root itself', () => {
      expect(service.containerToHostPath('library', libraryRoot)).toBe('/host/library');
    });

    it('returns null for a sibling with a shared prefix', () => {
      // downloadsRoot vs siblingWithPrefix ("downloads-evil"): without the
      // "+ sep" in the comparison, this would match by mistake.
      expect(service.containerToHostPath('downloads', siblingWithPrefix)).toBeNull();
    });

    it('returns null for a path belonging to another root', () => {
      expect(service.containerToHostPath('library', downloadsRoot)).toBeNull();
    });

    it('returns null for a path entirely outside', () => {
      expect(service.containerToHostPath('library', outsideDir)).toBeNull();
    });

    it('returns null when hostPath is relative', async () => {
      const relativeRoots: MediaRootConfig[] = [
        { id: 'library', label: 'Biblioteca', hostPath: './data/library', containerPath: libraryRoot },
      ];
      const module: TestingModule = await Test.createTestingModule({
        providers: [MediaRootsService, { provide: MEDIA_ROOTS, useValue: relativeRoots }],
      }).compile();
      const s = module.get<MediaRootsService>(MediaRootsService);
      expect(s.containerToHostPath('library', join(libraryRoot, 'Movies'))).toBeNull();
    });
  });

  // Sanity check that `sep` is the separator expected in this environment
  // (all of the analysis above assumes POSIX because `api` runs on Linux
  // inside the container).
  it('runs on a POSIX filesystem', () => {
    expect(sep).toBe('/');
  });

  // Spec 047, REQ-10: isInsideRoot is the check that guards a recursive rm
  // against a MediaSource.downloadPath the api itself no longer trusts. Wrong
  // in either direction is a real bug — true-when-outside deletes something
  // outside the downloads root, false-when-inside leaves every delete on disk
  // forever — so it gets the same real-mkdtemp, real-symlink treatment as
  // resolveFromRoot above rather than mocks.
  describe('isInsideRoot', () => {
    it('true for a path that resolves inside the root', async () => {
      expect(await service.isInsideRoot('library', join(libraryRoot, 'Movies'))).toBe(true);
    });

    it('true for the root itself', async () => {
      expect(await service.isInsideRoot('library', libraryRoot)).toBe(true);
    });

    it('false for a symlinked segment inside the root that points outside it', async () => {
      expect(await service.isInsideRoot('library', join(libraryRoot, 'Escape'))).toBe(false);
    });

    it('false for a symlinked segment pointing to a sibling with a shared string prefix', async () => {
      expect(await service.isInsideRoot('library', join(libraryRoot, 'EscapeSibling'))).toBe(false);
    });

    it('false for a path genuinely outside the root', async () => {
      expect(await service.isInsideRoot('library', outsideDir)).toBe(false);
    });

    it('false for a relative path', async () => {
      expect(await service.isInsideRoot('library', 'Movies')).toBe(false);
    });

    it('false for a NUL-bearing path', async () => {
      expect(await service.isInsideRoot('library', join(libraryRoot, 'Movies\0evil'))).toBe(false);
    });

    it('false for a non-string path', async () => {
      expect(await service.isInsideRoot('library', undefined as unknown as string)).toBe(false);
    });

    it('false for an unknown root, never throws', async () => {
      expect(await service.isInsideRoot('nope', '/whatever')).toBe(false);
    });

    it('false when the root is not mounted', async () => {
      const missingRoots: MediaRootConfig[] = [
        { id: 'library', label: 'Biblioteca', hostPath: '/host/library', containerPath: join(baseDir, 'no-existe') },
      ];
      const module: TestingModule = await Test.createTestingModule({
        providers: [MediaRootsService, { provide: MEDIA_ROOTS, useValue: missingRoots }],
      }).compile();
      const s = module.get<MediaRootsService>(MediaRootsService);
      expect(await s.isInsideRoot('library', '/no-existe/x')).toBe(false);
    });
  });
});
