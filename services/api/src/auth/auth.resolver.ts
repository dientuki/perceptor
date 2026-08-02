import { Resolver, Mutation, Query, Args, Context } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { UseGuards, UnauthorizedException } from '@nestjs/common';
import { GqlAuthGuard } from './guards/gql-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  @Mutation(() => Boolean)
  async login(
    @Args('username') username: string,
    @Args('pass') pass: string,
    @Context() context: any, // Acceso a req y res de Express
  ) {
    const user = await this.authService.validateUser(username, pass);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { access_token } = await this.authService.login(user);

    // Guardamos la cookie en el objeto de respuesta de Express
    context.res.cookie('token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    });

    return true;
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