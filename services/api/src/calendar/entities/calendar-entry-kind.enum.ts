import { registerEnumType } from '@nestjs/graphql';

export enum CalendarEntryKind {
  MOVIE = 'MOVIE',
  SHORT = 'SHORT',
  EPISODES = 'EPISODES',
}

registerEnumType(CalendarEntryKind, {
  name: 'CalendarEntryKind',
  description: 'What a calendar entry stands for: a film, a short, or a same-day group of episodes.',
});
