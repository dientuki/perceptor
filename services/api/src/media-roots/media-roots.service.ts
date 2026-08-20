import { Inject, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { MediaRoot } from './entities/media-root.entity';
import { MediaRootConfig, MEDIA_ROOTS } from './media-roots.types';

// Único dueño de la pregunta "¿esta ruta está adentro de una raíz declarada?".
// Todo lo demás (validación de settings, resolución de savepath de
// qBittorrent, la carpeta de salida del worker) pasa por acá — ver el
// contexto completo en el plan de "rutas configurables desde la UI".
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

  // Sólo para armar mensajes de error claros ("La ruta se escapa de <hostPath>")
  // sin que cada caller tenga que ir a buscar la config — getRoots() ya expone
  // hostPath igual, esto es puro azúcar interno.
  toHostPath(rootId: string): string {
    return this.getRootConfig(rootId).hostPath;
  }

  // Inversa de resolveFromRoot: toma una ruta absoluta DE CONTAINER y devuelve
  // la ruta equivalente del lado del host. La necesita el media server, que
  // corre afuera del stack y sólo entiende rutas del host.
  // Devuelve null si `containerAbsolutePath` no cae adentro de la raíz, o si
  // hostPath es relativo (./data/library, el default de .env.example): en ese
  // caso no hay ninguna ruta absoluta honesta que mandar.
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

  private getRootConfig(rootId: string): MediaRootConfig {
    const root = this.roots.find((r) => r.id === rootId);
    if (!root) {
      throw i18nError.notFound(ERROR_KEYS.MEDIA_ROOT_UNKNOWN, { rootId });
    }
    return root;
  }

  // Busca el ancestro existente más profundo de `path` y le hace realpath.
  // No hace falta que `path` exista entero: un segmento como "Movies/Nueva"
  // puede apuntar a una carpeta que el worker todavía no creó (ver
  // encode.ffmpeg.ts, que hace mkdir recursive antes de escribir). Lo que
  // importa es que ninguno de los tramos que SÍ existen sea un symlink que
  // se escape de la raíz.
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
          // Nunca debería pasar: '/' siempre existe. Si llegamos acá, algo
          // más grave está roto (el filesystem del container, no la ruta).
          throw new Error(`No se encontró ningún ancestro existente para "${path}"`);
        }
        current = parent;
      }
    }
  }

  // El límite de seguridad real. `relPath` es texto libre tipeado por el
  // usuario en el form de settings — nunca confiar en que ya viene sano.
  //
  // Con el modelo relativo (la DB guarda "Movies", no "/media/library/Movies")
  // el traversal con ".." se rechaza con una comparación de strings — no hace
  // falta canonicalizar para eso. Lo que SÍ hace falta igual es el chequeo de
  // symlinks: el guard de ".." impide que el usuario ESCRIBA una fuga, pero no
  // impide que un segmento válido (p. ej. "Movies") ya sea, en el filesystem,
  // un symlink que apunta afuera de la raíz.
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
