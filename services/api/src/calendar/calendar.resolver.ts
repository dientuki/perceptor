import { Resolver, Query, Args } from '@nestjs/graphql';
import { CalendarService } from './calendar.service';
import { CalendarEntry } from './entities/calendar-entry.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver(() => CalendarEntry)
export class CalendarResolver {
  constructor(private readonly calendarService: CalendarService) {}

  @Query(() => [CalendarEntry], {
    name: 'calendar',
    description: 'Titles in the caller\'s library released between from and to, inclusive (YYYY-MM-DD).',
  })
  async getCalendar(
    @Args('from') from: string,
    @Args('to') to: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.calendarService.list(userId, from, to);
  }
}
