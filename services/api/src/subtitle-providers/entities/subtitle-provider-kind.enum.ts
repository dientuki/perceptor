import { registerEnumType } from '@nestjs/graphql';
import { SubtitleProviderKind } from '@prisma/client';

registerEnumType(SubtitleProviderKind, { name: 'SubtitleProviderKind' });

export { SubtitleProviderKind };
