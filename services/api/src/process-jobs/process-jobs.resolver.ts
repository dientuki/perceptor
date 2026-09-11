import { Resolver, Query, Mutation, Args, Int, Float } from '@nestjs/graphql';
import { ProcessJobsService } from './process-jobs.service';
import { EncodeJobDetails } from './entities/encode-job-details.entity';
import { EncodeCompletedResult } from './entities/encode-completed-result.entity';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Canal de comunicación worker <-> api para el paso 3 del pipeline (encode).
// Todo lo que el worker necesita para armar el comando y la ruta de salida
// sale de `processJob`; el resto son notificaciones de progreso/resultado,
// igual de "avisos de un hecho ya ocurrido" que torrentCompleted/sourceScanned.
// Every one of these six carries the AllowService decorator — the worker
// calls them with the machine credential (SERVICE_TOKEN), not a user session.
@Resolver()
export class ProcessJobsResolver {
  constructor(private readonly processJobsService: ProcessJobsService) {}

  @AllowService()
  @Query(() => EncodeJobDetails, {
    name: 'processJob',
    description: 'Datos que el worker necesita para encodear un ProcessJob',
  })
  async processJob(@Args('id', { type: () => Int }) id: number) {
    return this.processJobsService.getEncodeJobDetails(id);
  }

  @AllowService()
  @Mutation(() => String, {
    name: 'encodeStarted',
    description: 'El worker avisa que arrancó a encodear un ProcessJob',
  })
  async encodeStarted(@Args('processJobId', { type: () => Int }) processJobId: number) {
    return this.processJobsService.encodeStarted(processJobId);
  }

  @AllowService()
  @Mutation(() => String, {
    name: 'encodeProgress',
    description: 'El worker reporta el progreso (0-100) de un encode en curso',
  })
  async encodeProgress(
    @Args('processJobId', { type: () => Int }) processJobId: number,
    @Args('progress', { type: () => Int }) progress: number,
    @Args('speed', { type: () => Float, nullable: true }) speed?: number,
  ) {
    return this.processJobsService.encodeProgress(processJobId, progress, speed);
  }

  @AllowService()
  @Mutation(() => EncodeCompletedResult, {
    name: 'encodeCompleted',
    description: 'El worker avisa que un encode terminó bien',
  })
  async encodeCompleted(
    @Args('processJobId', { type: () => Int }) processJobId: number,
    @Args('outputFilePath') outputFilePath: string,
    @Args('ffmpegCommand') ffmpegCommand: string,
  ) {
    return this.processJobsService.encodeCompleted(processJobId, outputFilePath, ffmpegCommand);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'encodeFailed',
    description: 'El worker avisa que un encode falló',
  })
  async encodeFailed(
    @Args('processJobId', { type: () => Int }) processJobId: number,
    @Args('errorKey') errorKey: string,
    @Args('errorParams', { type: () => String, nullable: true }) errorParams: string | undefined,
    @Args('errorMessage') errorMessage: string,
  ) {
    return this.processJobsService.encodeFailed(processJobId, errorKey, errorParams, errorMessage);
  }

  // 054-interrupted-encode-recovery, NFR-3: @AllowService() alone widens
  // access to service principals, it does not narrow it away from users —
  // this is the first service-only operation in the schema, so the
  // user-rejection below is load-bearing, not defensive boilerplate.
  @AllowService()
  @Mutation(() => Int, {
    name: 'encodeWorkerStarted',
    description: 'El worker avisa que acaba de arrancar; api reconcilia los ProcessJob huérfanos',
  })
  async encodeWorkerStarted(@CurrentUser() principal: AuthPrincipal): Promise<number> {
    if (principal.type !== 'service') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.processJobsService.reconcileOrphanedEncodes();
  }

  @AllowService()
  @Mutation(() => String, {
    name: 'downloadRemove',
    description: 'El worker pide borrar el torrent del cliente tras un encode exitoso',
  })
  async downloadRemove(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @Args('deleteFiles', { type: () => Boolean, nullable: true, defaultValue: true }) deleteFiles: boolean,
  ) {
    return this.processJobsService.downloadRemove(mediaSourceId, deleteFiles);
  }
}
