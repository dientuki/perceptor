import { registerEnumType } from '@nestjs/graphql';

export enum ContentKind {
  LIVE_ACTION = 'LIVE_ACTION',
  ANIME = 'ANIME',
  CGI = 'CGI',
}

registerEnumType(ContentKind, {
  name: 'ContentKind',
  description: 'The animation style of a film or series, driving the encoder\'s parameter set.',
});
