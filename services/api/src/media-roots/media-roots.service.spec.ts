import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { MediaRootsService } from './media-roots.service';
import { MEDIA_ROOTS, MediaRootConfig } from './media-roots.types';

// La raíz de este test es media-roots.service.ts::resolveFromRoot: es el
// único lugar del sistema que decide si una ruta escrita por el usuario en
// el form de settings puede usarse. Un bug acá es un path traversal real
// contra el filesystem del container. Por eso corre contra un mkdtemp de
// verdad (con symlinks reales), no contra mocks.
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
    // Comparte el prefijo de string con downloadsRoot a propósito: es el caso
    // que rompe una comparación ingenua con `startsWith(root)` sin el `+ sep`.
    siblingWithPrefix = join(baseDir, 'downloads-evil');
    outsideDir = join(baseDir, 'outside');

    await mkdir(libraryRoot, { recursive: true });
    await mkdir(join(libraryRoot, 'Movies'), { recursive: true });
    await mkdir(downloadsRoot, { recursive: true });
    await mkdir(siblingWithPrefix, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    // Symlink adentro de la raíz que apunta afuera de ella.
    await symlink(outsideDir, join(libraryRoot, 'Escape'));
    // Symlink adentro de la raíz que apunta a un hermano con prefijo compartido.
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
    it('expone hostPath pero nunca containerPath', async () => {
      const roots = service.getRoots();
      const library = roots.find((r) => r.id === 'library');
      expect(library?.hostPath).toBe('/host/library');
      expect(library).not.toHaveProperty('containerPath');
    });

    it('marca available=true cuando el mount existe', () => {
      const roots = service.getRoots();
      expect(roots.every((r) => r.available)).toBe(true);
    });

    it('marca available=false cuando el mount falta', async () => {
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

  describe('resolveFromRoot — casos válidos', () => {
    it('resuelve un segmento simple', async () => {
      const resolved = await service.resolveFromRoot('library', 'Movies');
      expect(resolved).toBe(join(libraryRoot, 'Movies'));
    });

    it('input vacío resuelve a la raíz misma', async () => {
      const resolved = await service.resolveFromRoot('library', '');
      expect(resolved).toBe(libraryRoot);
    });

    it('"." resuelve a la raíz misma', async () => {
      const resolved = await service.resolveFromRoot('library', '.');
      expect(resolved).toBe(libraryRoot);
    });

    it('permite una hoja que todavía no existe cuando mustExist no se pide', async () => {
      const resolved = await service.resolveFromRoot('library', 'Nueva/Subcarpeta');
      expect(resolved).toBe(join(libraryRoot, 'Nueva', 'Subcarpeta'));
    });

    it('rechaza una hoja inexistente cuando mustExist=true', async () => {
      await expect(
        service.resolveFromRoot('library', 'NoExiste', { mustExist: true }),
      ).rejects.toThrow();
    });

    it('acepta una hoja existente cuando mustExist=true', async () => {
      const resolved = await service.resolveFromRoot('library', 'Movies', { mustExist: true });
      expect(resolved).toBe(join(libraryRoot, 'Movies'));
    });
  });

  describe('resolveFromRoot — escapes', () => {
    it('rechaza ".."', async () => {
      await expect(service.resolveFromRoot('library', '..')).rejects.toThrow();
    });

    it('rechaza un traversal compuesto que termina fuera de la raíz', async () => {
      await expect(
        service.resolveFromRoot('library', 'Movies/../../downloads'),
      ).rejects.toThrow();
    });

    it('rechaza una ruta absoluta', async () => {
      await expect(service.resolveFromRoot('library', '/etc')).rejects.toThrow();
    });

    it('rechaza un byte NUL', async () => {
      await expect(service.resolveFromRoot('library', 'Movies\0evil')).rejects.toThrow();
    });

    it('rechaza un symlink que apunta afuera de la raíz', async () => {
      await expect(service.resolveFromRoot('library', 'Escape')).rejects.toThrow();
    });

    it('rechaza un symlink que apunta a un hermano con prefijo compartido', async () => {
      // Este es el caso que exige el "+ sep" en la comparación de prefijos:
      // sin él, downloadsRoot siendo prefijo string de siblingWithPrefix
      // haría que este symlink pasara el chequeo por error.
      await expect(service.resolveFromRoot('library', 'EscapeSibling')).rejects.toThrow();
    });

    it('un hermano con prefijo compartido no es alcanzable ni por composición directa', async () => {
      // downloadsRoot y siblingWithPrefix comparten prefijo de string; nada
      // en el modelo relativo permite escribir una ruta que salga de
      // libraryRoot, pero lo verificamos igual como red de seguridad.
      const resolved = await service.resolveFromRoot('downloads', '.');
      expect(resolved).toBe(downloadsRoot);
      expect(resolved.startsWith(siblingWithPrefix)).toBe(false);
    });
  });

  describe('resolveFromRoot — raíz desconocida o no montada', () => {
    it('rechaza un rootId inexistente', async () => {
      await expect(service.resolveFromRoot('nope', 'x')).rejects.toThrow();
    });

    it('rechaza cuando el mount no está disponible', async () => {
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

  it('toHostPath devuelve el hostPath de la raíz', () => {
    expect(service.toHostPath('library')).toBe('/host/library');
  });

  describe('containerToHostPath', () => {
    it('traduce un path adentro de la raíz', () => {
      const result = service.containerToHostPath('library', join(libraryRoot, 'Movies', 'x.mkv'));
      expect(result).toBe(join('/host/library', 'Movies', 'x.mkv'));
    });

    it('traduce la raíz misma', () => {
      expect(service.containerToHostPath('library', libraryRoot)).toBe('/host/library');
    });

    it('devuelve null para un hermano con prefijo compartido', () => {
      // downloadsRoot vs siblingWithPrefix ("downloads-evil"): sin el "+ sep"
      // en la comparación, esto matchearía por error.
      expect(service.containerToHostPath('downloads', siblingWithPrefix)).toBeNull();
    });

    it('devuelve null para un path de otra raíz', () => {
      expect(service.containerToHostPath('library', downloadsRoot)).toBeNull();
    });

    it('devuelve null para un path totalmente afuera', () => {
      expect(service.containerToHostPath('library', outsideDir)).toBeNull();
    });

    it('devuelve null cuando hostPath es relativo', async () => {
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

  // Sanity check de que `sep` es el separador esperado en este entorno (todo
  // el análisis de arriba asume POSIX porque el api corre en Linux dentro
  // del container).
  it('corre en un filesystem POSIX', () => {
    expect(sep).toBe('/');
  });
});
