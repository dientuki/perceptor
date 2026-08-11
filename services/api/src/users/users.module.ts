import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule exports SessionService, which UsersService needs to revoke a
  // disabled user's live sessions (004-user-disable REQ-3). AuthModule does
  // not import UsersModule, so this stays acyclic.
  imports: [AuthModule],
  providers: [UsersResolver, UsersService],
})
export class UsersModule {}
