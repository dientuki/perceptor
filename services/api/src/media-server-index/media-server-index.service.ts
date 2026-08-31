import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { createMediaServerClient } from '@/clients/media-server/registry';
import { MediaServerConfig } from '@/clients/media-server/types';
import { MediaType } from '@/types/media';

const REBUILD_CLAIM_KEY = 'mediaserver:index:rebuild';
// Long enough to cover a slow enumeration of a large library (NFR-2 gives
// listLibrary itself 5 minutes) with headroom, short enough that a crashed
// process does not wedge readState()'s derived "syncing" for too long before
// the backstop below flips it to "failed" — see readState().
const REBUILD_CLAIM_TTL_SECONDS = 60 * 20;

const STATE_KEY = 'media_server_index_state';
const SYNCED_AT_KEY = 'media_server_index_synced_at';
const COUNT_KEY = 'media_server_index_count';

const CREATE_MANY_CHUNK_SIZE = 1000;
// The Prisma default $transaction timeout (5s) will not survive a real
// library's deleteMany + chunked createMany — the symptom of leaving this at
// the default is "Re-sync does nothing" with no error surfaced anywhere.
const REBUILD_TRANSACTION_TIMEOUT_MS = 60_000;

export type MediaServerIndexState = 'never' | 'syncing' | 'ready' | 'failed';

export type MediaServerIndexStatusSnapshot = {
  state: MediaServerIndexState;
  itemCount: number;
  syncedAt: Date | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Rebuilds and serves the local index a media-server client with no native
// provider-id filter (Jellyfin) needs to resolve findByTmdbId. A leaf module
// on purpose — see media-server-index.module.ts's comment for why it must
// never import SettingsModule/SettingsService.
@Injectable()
export class MediaServerIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Composite-key lookup for MediaServerReconcileService and for the port a
  // client's own findByTmdbId is handed. mediaType is part of the key
  // because a film and a series can legitimately share a tmdbId — dropping
  // it would let one clobber lookups for the other.
  async lookup(mediaType: MediaType, tmdbId: number): Promise<string | null> {
    const row = await this.prisma.mediaServerItem.findUnique({
      where: { mediaType_tmdbId: { mediaType, tmdbId } },
    });
    return row?.externalId ?? null;
  }

  // Enumerates the configured client's whole library and replaces the index
  // wholesale. REQ-7: a rebuild already in flight is not restarted — the
  // caller (resyncMediaServerIndex, or the settings-change trigger) gets
  // back whatever state already holds. Never awaited by its callers (NFR-6);
  // the whole body is try/catch/finally so nothing here can escape as an
  // unhandled rejection.
  async rebuild(
    clientId: string,
    config: MediaServerConfig,
  ): Promise<MediaServerIndexStatusSnapshot> {
    const claimed = await this.redis.set(
      REBUILD_CLAIM_KEY,
      '1',
      'EX',
      REBUILD_CLAIM_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') return this.readState();

    try {
      const client = createMediaServerClient(clientId, config, {
        lookup: (mediaType, tmdbId) => this.lookup(mediaType, tmdbId),
      });

      // REQ-8: a client with no listLibrary resolves findByTmdbId natively
      // and never populates this index — a rebuild is a no-op for it, and
      // the recorded state is left exactly as it was (most installations:
      // "never", meaning the index concept simply does not apply).
      if (!client?.listLibrary) return this.readState();

      await this.writeState('syncing');

      const rawEntries = await client.listLibrary();
      // A real library is not guaranteed unique per (mediaType, tmdbId): two
      // items can share a TMDB id (multi-version files, a title duplicated
      // across libraries). The index only needs *some* externalId to resolve
      // a lookup, so the later entry wins — deduping here is what keeps this
      // createMany from tripping the composite unique constraint and failing
      // the whole rebuild over data this table was never meant to reject.
      const byKey = new Map(rawEntries.map((entry) => [`${entry.mediaType}:${entry.tmdbId}`, entry]));
      const entries = [...byKey.values()];

      await this.prisma.$transaction(
        [
          this.prisma.mediaServerItem.deleteMany({}),
          ...chunk(entries, CREATE_MANY_CHUNK_SIZE).map((batch) =>
            this.prisma.mediaServerItem.createMany({ data: batch }),
          ),
        ],
        { timeout: REBUILD_TRANSACTION_TIMEOUT_MS },
      );

      await this.writeState('ready', entries.length, new Date());
    } catch (err) {
      // On failure the table and media_server_index_synced_at are left
      // untouched (REQ-4/REQ-5) — only the state row moves to "failed", so a
      // stale-but-real previous index keeps answering lookups rather than
      // being wiped by a rebuild that never finished.
      console.error('[media-server-index] rebuild falló:', err);
      await this.writeState('failed');
    } finally {
      await this.redis.del(REBUILD_CLAIM_KEY);
    }

    return this.readState();
  }

  // Derives `state` rather than trusting the stored value verbatim: a
  // process that dies mid-rebuild leaves "syncing" written with no claim
  // left holding it, which would otherwise wedge the UI showing "syncing"
  // forever. The claim being live is what "syncing" actually means; its
  // absence means whatever wrote it did not finish.
  async readState(): Promise<MediaServerIndexStatusSnapshot> {
    const [claimHeld, rows] = await Promise.all([
      this.redis.exists(REBUILD_CLAIM_KEY),
      this.prisma.setting.findMany({
        where: { key: { in: [STATE_KEY, SYNCED_AT_KEY, COUNT_KEY] } },
      }),
    ]);

    const map = new Map(rows.map((row) => [row.key, row.value]));
    const storedState =
      (map.get(STATE_KEY) as MediaServerIndexState | undefined) ?? 'never';
    const state =
      storedState === 'syncing' && !claimHeld ? 'failed' : storedState;

    const syncedAtRaw = map.get(SYNCED_AT_KEY);
    const countRaw = map.get(COUNT_KEY);

    return {
      state,
      itemCount: countRaw ? parseInt(countRaw, 10) : 0,
      syncedAt: syncedAtRaw ? new Date(syncedAtRaw) : null,
    };
  }

  private async writeState(
    state: MediaServerIndexState,
    itemCount?: number,
    syncedAt?: Date,
  ): Promise<void> {
    await this.prisma.setting.update({
      where: { key: STATE_KEY },
      data: { value: state },
    });

    if (itemCount !== undefined) {
      await this.prisma.setting.update({
        where: { key: COUNT_KEY },
        data: { value: String(itemCount) },
      });
    }
    if (syncedAt !== undefined) {
      await this.prisma.setting.update({
        where: { key: SYNCED_AT_KEY },
        data: { value: syncedAt.toISOString() },
      });
    }
  }
}
