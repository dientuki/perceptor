import { registerEnumType } from '@nestjs/graphql';

export enum TorrentGroupScope {
  MOVIE = 'MOVIE',
  SHOW = 'SHOW',
}

registerEnumType(TorrentGroupScope, { name: 'TorrentGroupScope' });
