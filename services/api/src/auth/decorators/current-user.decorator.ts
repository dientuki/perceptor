import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { AuthPrincipal } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): AuthPrincipal => {
    if (context.getType<GqlContextType>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext().req.user;
    }
    return context.switchToHttp().getRequest().user;
  },
);
