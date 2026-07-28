import { Resolver, Query } from '@nestjs/graphql';
import { Item } from './item.model';

@Resolver(() => Item)
export class AppResolver {
  
  @Query(() => String, { name: 'ping' })
  ping(): string {
    return 'pong';
  }

  @Query(() => [Item], { name: 'items' })
  getItems(): Item[] {
    return [{ id: '1', title: 'Primer ítem' }];
  }
}