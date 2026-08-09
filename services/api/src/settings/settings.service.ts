import { Injectable, BadRequestException } from '@nestjs/common';
import { normalize } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { SettingInput } from './dto/setting.input';
import { getSettingCatalogEntry } from './settings.catalog';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaRootsService: MediaRootsService,
  ) {}

  async findAll() {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  // Shape exacto que ya esperan los clients: TmdbClient, ProwlarrClient y
  // QbittorrentClient resuelven esto como Record<string, string> por request.
  async getMap(): Promise<Record<string, string>> {
    const settings = await this.findAll();
    return settings.reduce<Record<string, string>>((map, setting) => {
      map[setting.key] = setting.value;
      return map;
    }, {});
  }

  // Valida TODAS las entries antes de escribir cualquiera — si una falla, no
  // queda un update parcial a mitad de camino. Las keys de tipo 'path' se
  // resuelven contra media-roots (rechaza absolutas, traversal y symlinks
  // que se escapan) y lo que se persiste es el relativo NORMALIZADO, nunca
  // el input crudo del usuario ni el absoluto que devuelve el resolver — así
  // un valor guardado nunca arrastra un ".." ni una forma rara ("Movies/./").
  async updateMany(entries: SettingInput[]) {
    const normalizedEntries: SettingInput[] = [];

    for (const entry of entries) {
      const catalogEntry = getSettingCatalogEntry(entry.key);
      if (!catalogEntry) {
        throw new BadRequestException(`Setting desconocida o no editable: "${entry.key}"`);
      }

      if (catalogEntry.kind === 'path') {
        // No hace falta que exista todavía: el worker crea la carpeta en el
        // primer encode (ver build-output-path.ts / encode.ffmpeg.ts).
        await this.mediaRootsService.resolveFromRoot(catalogEntry.rootId!, entry.value);
        normalizedEntries.push({ key: entry.key, value: normalize(entry.value) });
        continue;
      }

      if (catalogEntry.kind === 'boolean' && entry.value !== 'true' && entry.value !== 'false') {
        throw new BadRequestException(`"${entry.key}" tiene que ser "true" o "false"`);
      }

      if (catalogEntry.kind === 'int' && !/^\d+$/.test(entry.value)) {
        throw new BadRequestException(`"${entry.key}" tiene que ser un número`);
      }

      if (catalogEntry.kind === 'enum' && !catalogEntry.options!.includes(entry.value)) {
        throw new BadRequestException(
          `"${entry.key}" tiene que ser uno de: ${catalogEntry.options!.join(', ')}`,
        );
      }

      normalizedEntries.push(entry);
    }

    for (const entry of normalizedEntries) {
      await this.prisma.setting.upsert({
        where: { key: entry.key },
        update: { value: entry.value },
        create: { key: entry.key, value: entry.value },
      });
    }

    return this.findAll();
  }
}
