import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../auth/auth.types';

// All five operations here are administrator-only (REQ-2) — applied once at
// class level rather than per-method so a new operation added later cannot
// forget the guard.
@Resolver(() => User)
@UseGuards(AdminGuard)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Mutation(() => User)
  async createUser(@Args('createUserInput') createUserInput: CreateUserInput) {
    return await this.usersService.create(createUserInput);
  }

  @Query(() => [User], { name: 'users' })
  async findAll() {
    return await this.usersService.findAll();
  }

  @Query(() => User, { name: 'user' })
  async findOne(@Args('id', { type: () => ID }) id: string) {
    return await this.usersService.findOne(id);
  }

  @Mutation(() => User)
  async updateUser(
    @Args('updateUserInput') updateUserInput: UpdateUserInput,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    // AdminGuard already guarantees principal.type === 'user'; narrowed
    // again here purely for TypeScript.
    const requesterId = principal.type === 'user' ? principal.id : '';
    return await this.usersService.update(updateUserInput.id, updateUserInput, requesterId);
  }

  @Mutation(() => User)
  async removeUser(@Args('id', { type: () => ID }) id: string, @CurrentUser() principal: AuthPrincipal) {
    // AdminGuard already guarantees principal.type === 'user'; narrowed
    // again here purely for TypeScript.
    const requesterId = principal.type === 'user' ? principal.id : '';
    return await this.usersService.remove(id, requesterId);
  }
}