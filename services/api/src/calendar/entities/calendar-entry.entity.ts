import { ObjectType, Field, Int } from '@nestjs/graphql';
import { CalendarEntryKind } from './calendar-entry-kind.enum';

@ObjectType()
export class CalendarEntry {
  @Field(() => CalendarEntryKind)
  kind: CalendarEntryKind;

  @Field(() => Int, { description: 'Movie.id for MOVIE/SHORT, Show.id for EPISODES — the id the detail route takes.' })
  mediaId: number;

  @Field({ description: 'Film title, or the series title for EPISODES.' })
  title: string;

  @Field({ description: 'Release day, YYYY-MM-DD, no time or timezone component.' })
  date: string;

  @Field({
    description: 'One of the eight normalized pipeline statuses (043); for EPISODES, the group status (REQ-7).',
  })
  status: string;

  @Field(() => Int, { nullable: true, description: 'Null unless kind is EPISODES.' })
  seasonNumber?: number | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Null unless kind is EPISODES. Lowest episode number in the group.',
  })
  firstEpisodeNumber?: number | null;

  @Field(() => Int, {
    nullable: true,
    description:
      'Null unless kind is EPISODES. Highest episode number in the group; equal to firstEpisodeNumber for a single episode.',
  })
  lastEpisodeNumber?: number | null;

  @Field(() => String, {
    nullable: true,
    description: 'Null unless kind is EPISODES and the group holds exactly one episode.',
  })
  episodeTitle?: string | null;

  @Field(() => Int, {
    nullable: true,
    description:
      'Null unless kind is EPISODES. Number of episodes in the group (not derivable from the span when numbers have gaps).',
  })
  episodeCount?: number | null;

  @Field(() => Int, {
    nullable: true,
    description:
      'Null unless kind is EPISODES. Number of episodes in the group whose status is COMPLETED (REQ-7b).',
  })
  completedCount?: number | null;
}
