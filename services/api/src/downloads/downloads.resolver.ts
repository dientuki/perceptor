import { Resolver, Mutation, Args } from '@nestjs/graphql';

// Sin service todavía: no hay lógica que encapsular, sólo loguear el aviso.
// Este resolver es el canal de aviso qBittorrent -> api, nada más. Escribir
// en la DB (buscar el MediaSource por infoHash, actualizar status/downloadPath)
// es un paso posterior, fuera de alcance acá.
@Resolver()
export class DownloadsResolver {
  @Mutation(() => String, {
    name: 'torrentCompleted',
    description: 'Aviso del cliente de torrents de que una descarga terminó',
  })
  torrentCompleted(@Args('infoHash') infoHash: string): string {
    console.log(`[torrentCompleted] infoHash=${infoHash}`);
    return `recibido ${infoHash}`;
  }
}
