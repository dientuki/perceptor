import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  findOpenSeasonSession(mediaSourceId: number, userId: string) {
    return this.prisma.mediaSource.findFirst({
      where: {
        id: mediaSourceId,
        kind: 'LOCAL_FOLDER',
        status: 'PENDING',
        seasonId: { not: null },
        season: { show: { users: { some: { userId } } } },
      },
    });
  }
}
