declare module "parse-torrent" {
  export default function parseTorrent(
    input: Buffer | Uint8Array | string,
  ): Promise<{ infoHash: string }>;
}
