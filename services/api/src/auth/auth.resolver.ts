import { Resolver, Mutation, Query, Args, Context } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginResponse } from './dto/login-response';
import { LoginInput } from './dto/login.input';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  // The only public operation in the schema (REQ-4) — every other resolver
  // requires a credential once JwtAuthGuard is registered as APP_GUARD.
  @Public()
  @Mutation(() => LoginResponse, { description: 'Inicia sesión y retorna un JWT' })
  async login(
    @Args('loginInput') loginInput: LoginInput,
  ): Promise<LoginResponse> {
    return await this.authService.login(
      loginInput.username,
      loginInput.password,
    );
  }

  @Mutation(() => Boolean)
  async logout(@Context() context: any) {
    context.res.clearCookie('token', { path: '/' });
    return true;
  }

  // TODO(T007): guard this with JwtAuthGuard, return User! via getProfile.
  @Query(() => String)
  me(@CurrentUser() user: any) {
    return user.username;
  }
}