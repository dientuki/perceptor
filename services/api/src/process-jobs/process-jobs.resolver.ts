import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { ProcessJobsService } from './process-jobs.service';
import { EncodeJobDetails } from './entities/encode-job-details.entity';

// Canal de comunicación worker <-> api para el paso 3 del pipeline (encode).
// Todo lo que el worker necesita para armar el comando y la ruta de salida
// sale de `processJob`; el resto son notificaciones de progreso/resultado,
// igual de "avisos de un hecho ya ocurrido" que torrentCompleted/sourceScanned.
@Resolver()
export class ProcessJobsResolver {
  constructor(private readonly processJobsService: ProcessJobsService) {}

  @Query(() => EncodeJobDetails, {
    name: 'processJob',
    description: 'Datos que el worker necesita para encodear un ProcessJob',
  })
  async processJob(@Args('id', { type: () => Int }) id: number) {
    return this.processJobsService.getEncodeJobDetails(id);
  }

  @Mutation(() => String, {
    name: 'encodeStarted',
    description: 'El worker avisa que arrancó a encodear un ProcessJob',
  })
  async encodeStarted(@Args('processJobId', { type: () => Int }) processJobId: number) {
    return this.processJobsService.encodeStarted(processJobId);
  }

  @Mutation(() => String, {
    name: 'encodeProgress',
    description: 'El worker reporta el progreso (0-100) de un encode en curso',
  })
  async encodeProgress(
    @Args('processJobId', { type: () => Int }) processJobId: number,
    @Args('progress', { type: () => Int }) progress: number,
  ) {
    return this.processJobsService.encodeProgress(processJobId, progress);
  }

  @Mutation(() => String, {
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

  @Mutation(() => String, {
    name: 'encodeFailed',
    description: 'El worker avisa que un encode falló',
  })
  async encodeFailed(
    @Args('processJobId', { type: () => Int }) processJobId: number,
    @Args('errorMessage') errorMessage: string,
  ) {
    return this.processJobsService.encodeFailed(processJobId, errorMessage);
  }

  @Mutation(() => String, {
    name: 'downloadRemove',
    description: 'El worker pide borrar el torrent del cliente tras un encode exitoso',
  })
  async downloadRemove(@Args('mediaSourceId', { type: () => Int }) mediaSourceId: number) {
    return this.processJobsService.downloadRemove(mediaSourceId);
  }
}
