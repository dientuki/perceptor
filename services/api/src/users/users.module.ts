import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { ProfileResolver } from './profile.resolver';
import { AuthModule } from '../auth/auth.module';

@Module({
  // Spec 004, REQ-3
  imports: [AuthModule],
  providers: [UsersResolver, ProfileResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
