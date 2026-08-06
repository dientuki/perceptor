import { Module } from '@nestjs/common';
import { MoviesResolver } from './movies.resolver';
import { MoviesService } from './movies.service';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [MoviesResolver, MoviesService],
})
export class MoviesModule {}
