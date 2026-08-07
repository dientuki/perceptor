import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingInput } from './dto/setting.input';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async updateMany(entries: SettingInput[]) {
    for (const entry of entries) {
      await this.prisma.setting.upsert({
        where: { key: entry.key },
        update: { value: entry.value },
        create: { key: entry.key, value: entry.value },
      });
    }

    return this.findAll();
  }
}
