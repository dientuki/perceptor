// parse-torrent@11 es ESM puro y no publica tipos. Se carga con import() dinámico
// porque el api compila a CommonJS y el paquete no expone la condición "require".
declare module "parse-torrent" {
  export default function parseTorrent(
    input: Buffer | Uint8Array | string,
  ): Promise<{ infoHash: string }>;
}
