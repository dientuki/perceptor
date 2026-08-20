import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { FfprobeLog } from './entities/ffprobe-log.entity';

@Injectable()
export class FfprobeLogsService {
  constructor(private readonly prisma: PrismaService) {}

  // The row must exist before the encode starts (REQ-1), so this rejects an
  // empty payload before ever touching Prisma — validation still runs before
  // any side effect, even though the only side effect here is a write.
  async record(file: string, ffprobe: string): Promise<FfprobeLog> {
    if (!file.trim() || !ffprobe.trim()) {
      throw i18nError.badRequest(ERROR_KEYS.FFPROBE_LOG_EMPTY_PAYLOAD);
    }

    return this.prisma.ffprobeLog.create({ data: { file, ffprobe } });
  }

  // Newest first, then id descending, so paging stays stable when several
  // probes land in the same second (REQ-3).
  async findAll(file: string | undefined, take: number, skip: number): Promise<FfprobeLog[]> {
    return this.prisma.ffprobeLog.findMany({
      where: file ? { file } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      skip,
    });
  }

  async findOne(id: number): Promise<FfprobeLog> {
    const ffprobeLog = await this.prisma.ffprobeLog.findUnique({ where: { id } });
    if (!ffprobeLog) {
      throw i18nError.notFound(ERROR_KEYS.FFPROBE_LOG_NOT_FOUND, { id });
    }
    return ffprobeLog;
  }

  // findOne first so a missing id surfaces the keyed not_found error rather
  // than Prisma's raw P2025, which carries no i18n extension.
  async remove(id: number): Promise<boolean> {
    await this.findOne(id);
    await this.prisma.ffprobeLog.delete({ where: { id } });
    return true;
  }
}
