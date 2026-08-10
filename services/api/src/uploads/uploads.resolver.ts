import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { UploadTicket } from './entities/upload-ticket.entity';
import { UploadTicketsService } from './upload-tickets.service';

@Resolver()
export class UploadsResolver {
  constructor(private readonly uploadTickets: UploadTicketsService) {}

  // Deliberately no @AllowService() — an upload ticket is delegated from a
  // user session (REQ-11), and a service principal has no user to delegate
  // for. The guard's missing @AllowService() already keeps a service
  // principal out; the `principal.type` narrowing below is for TypeScript.
  @UseGuards(JwtAuthGuard)
  @Mutation(() => UploadTicket)
  async createUploadTicket(
    @Args('movieId', { type: () => Int }) movieId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<UploadTicket> {
    if (principal.type !== 'user') {
      throw new UnauthorizedException('No autenticado');
    }
    return await this.uploadTickets.mint(principal.id, movieId);
  }
}
