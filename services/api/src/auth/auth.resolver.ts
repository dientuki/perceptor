import { Resolver, Mutation, Query, Args, Context } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { UseGuards, UnauthorizedException } from '@nestjs/common';
import { GqlAuthGuard } from './guards/gql-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginResponse } from './dto/login-response';
import { LoginInput } from './dto/login.input';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  @Mutation(() => LoginResponse, { description: 'Inicia sesión y retorna un JWT' })
  async login(
    @Args('loginInput') loginInput: LoginInput,
  ): Promise<LoginResponse> {
    return await this.authService.login(
      loginInput.email,
      loginInput.password,
    );
  }

  @Mutation(() => Boolean)
  async logout(@Context() context: any) {
    context.res.clearCookie('token', { path: '/' });
    return true;
  }

  // Endpoint protegido usando el Guard de Nest
  @Query(() => String)
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() user: any) {
    return user.username;
  }
}