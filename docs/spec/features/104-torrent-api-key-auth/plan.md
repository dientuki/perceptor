---
title: qBittorrent Authenticated by API Key, Not by Subnet — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-10-25
status: Implemented
---

# PLAN: qBittorrent Authenticated by API Key, Not by Subnet (`plan.md`)

## Approach

The design copies `014-dev-stack-flaresolverr`'s handling of `INDEXER_API_KEY`. The key is declared
in `.env`, the third-party container writes it into its own configuration before the daemon starts,
and `api` sends it on every call. Three slices:

- **`infra`** makes qBittorrent require the key. The `[Preferences]` whitelist lines leave the
  image's defaults (`services/torrent/Dockerfile`). A new init script under
  `services/torrent/custom-cont-init.d/` turns the whitelist off in any existing `qBittorrent.conf`,
  then validates `TORRENT_API_KEY` and writes it as `WebUI\APIKey`. Both installers generate the
  key, and compose passes it to `torrent` and to `api`. `infra` also makes
  `services/indexer/custom-cont-init.d/10-prowlarr-apikey`'s two existing refusals actually stop
  the `indexer` container (REQ-9), using the same halt mechanism.
- **`api`** reads `TORRENT_API_KEY` **straight from `process.env`**, not from the `torrent_api_key`
  Settings row. It sends the key as `Authorization: Bearer` from `QbittorrentClient` and from
  `setQbittorrentLogin`. It maps a `401`/`403` from qBittorrent to the new key through one shared
  function used by both `DownloadsService.callTorrentClient` and `AttachSourceService.attach`.
- **`web`** adds the new key to both message catalogs and nothing else. `translateGraphQLError`
  (`services/web/src/lib/graphql-error.ts`) already renders any key it finds in the catalog.

**Why the environment and not the Settings row.** REQ-5 requires that a rotation in `.env` reaches
`api` with no manual step. The seed's backfill only writes a row that is still empty
(`prisma/seeds/settings.ts`), so a backfilled row would keep the old key forever after a rotation.
Making the seed overwrite would turn `.env` into a hidden writer of a Settings row, which no other
row has. `JWT_SECRET` and `SERVICE_TOKEN` are already read from the environment, and this key is the
same kind of value: a credential shared between two containers, not something an administrator
edits. The `torrent_api_key` seed entry is deleted, so the codebase holds a single source for the
key. Existing rows stay as inert data, the same treatment `076` gave the
`schedule_acquire_pending_*` rows.

**How "fail loudly" actually fails.** A script in `custom-cont-init.d` that exits non-zero does not
stop a LinuxServer container. Its `init-custom-files` runner only logs `exited 1` and carries on,
which was verified against the published image's own run script. The new script therefore stops the
container through s6-overlay: it writes the exit code to
`/run/s6-linux-init-container-results/exitcode` and calls `/run/s6/basedir/bin/halt`. In a throwaway
container this produced exit status `3`. qBittorrent still logged `WebUI will be started` during the
shutdown, so the daemon may live for a moment. That is why the script turns the whitelist off
**before** it checks the key: in that moment there is neither a bypass nor a key, and every request
answers `403`.

The same mechanism serves Prowlarr (REQ-9). There the window is harmless for a different reason:
the empty-key check runs before the script writes anything. A `config.xml` Prowlarr manages to
create in that moment, holding a random key, is rewritten to the declared key on the next boot that
has one. The script's existing "rewrite a differing `<ApiKey>`" branch already does that. Each image
carries its own two-line halt rather than a shared helper: the two images share no build context.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` and `api`, **in parallel** | The contract (one error key, its params and the six affected mutations) is frozen in `spec.md`. Neither slice reads the other's files. `infra` produces the key and the requirement for it; `api` sends it. |
| 2 | `web` | Two catalog entries. Can run alongside step 1; ordered last only because it is the smallest. |
| 3 | `docs` (orchestrator) | `docs/spec/graphql-contract.md` (new key, the six mutations, the corrected `059` paragraph); `README.md`'s update section (re-run `install.sh` for this version); the root `CLAUDE.md` § Environment note for `TORRENT_API_KEY`. |
| 4 | verify | Needs all three slices built into images (`bin/build`) and a live stack. |

Between steps 1 and 4 the dev stack is in a mixed state. A rebuilt `torrent` with the old `api`
rejects every call, and the reverse still works while the whitelist survives. Rebuild both together.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`401` and `403` both map to `torrent_client_unauthorized`.** qBittorrent 5.2.4 answers `403`
  for a wrong or missing key, verified live, and `401` is never observed. Keep both: a later version
  answering `401` must not silently fall into the generic key.
- **The acquisition mutations gain `torrent_client_rejected` for every non-auth failure.** From
  inside `api` this looks like scope creep, but it is what `graphql-contract.md` already documents
  for `addTorrentToSeason` (`059`). Today the raw `TorrentClientError` escapes unkeyed.
- **`status` is `0` when qBittorrent is unreachable**, the same as `callTorrentClient` does today.
  Do not invent a separate key for "unreachable".
- **The message names `TORRENT_API_KEY`, never its value.** No params on the new key.

## Migrations

None. Deleting the `torrent_api_key` entry from `prisma/seeds/settings.ts` is a seed change, not a
schema change: existing rows are left alone and nothing reads them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A key of the wrong shape | qBittorrent rejects it with a bare `403`: everything looks configured and nothing works | The init script validates `^qbt_[A-Za-z0-9]{28}$` and halts with the expected shape in its log line (AC-7). Installers generate exactly that shape and re-check the length before writing. |
| The init script's `exit 1` is ignored | qBittorrent starts anyway, so "fail loudly" is a log line nobody reads | s6 halt with an explicit exit code, whitelist turned off first (Approach). AC-6 checks `docker compose ps`, not just the log. |
| `setSavePath` ignores the response | A key mismatch makes a Settings change of `path_downloads` silently not reach qBittorrent. This is pre-existing: it is just as silent today for any failure | Out of scope to make it loud. The `api` slice still sends the header there and its header test covers it, so a forgotten header cannot be the cause. |
| Live reads swallow the rejection | `/downloads` shows stale state with no visible error (REQ-6 accepts this degradation) | The log line names the rejection (`describeTorrentClientFailure`); the owed test asserts the wording for a `403`. |
| Key in a log | The init script echoes the variable, or a `TorrentClientError` message embeds a header | The script never prints the value, only its length and shape problem. `TorrentClientError` messages carry the response body, never request headers. AC-9 greps the logs. |
| qBittorrent rewrites `qBittorrent.conf` on shutdown | It re-serializes values, sometimes quoting them, which would make a naive equality check rewrite the key on every boot | Strip surrounding quotes before comparing, exactly like `10-qbittorrent-password`'s `get_value`. A rewrite is harmless anyway: same value. |
| Prowlarr halts on a healthy install | A halt placed on the wrong branch (e.g. the "already has the declared key" path) would stop search on every boot | The halt sits only on the two existing `exit 1` branches; the infra checks boot a valid key and confirm Prowlarr stays up and search works. |
| Mixed rebuild in dev | Only `torrent` rebuilt, so every call answers `403` | Order of Work says rebuild both; AC-8 is this failure on purpose. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
bin/build dev torrent && bin/build dev indexer && bin/build dev api
bin/dev -d
```

Then the manual pass, against the dev stack with Traefik on (and once with `install.sh` into an
empty directory for AC-1, AC-5 and AC-6):

1. AC-1/AC-2: `curl -s -o /dev/null -w '%{http_code}'` against `torrent.<DOMAIN>/api/v2/app/version`
   and `localhost:${QBITTORRENT_WEBUI_PORT}/api/v2/app/version` both print `403`. The browser shows
   qBittorrent's login page.
2. AC-3: search a film, add a release, watch `/downloads` progress through encode.
3. AC-4: `bin/reset-password <ADMIN_USER>` reports qBittorrent updated, and the browser login works.
4. AC-5/AC-6/AC-7: on a pre-`104` install directory, first only pull the new images (torrent
   restarts, its log names `TORRENT_API_KEY`), then re-run `install.sh` (key generated, whitelist
   `false`, old torrent still listed). Separately, set a hex key (AC-7).
5. AC-8: `TORRENT_API_KEY=<other valid key> docker compose up -d --no-deps api`, then Stop a row and
   add a release, and check `docker compose logs api` for the rejection line.
6. AC-10: `INDEXER_API_KEY= docker compose up -d --no-deps --force-recreate indexer`; `indexer` restarts,
   its log names the variable, `config.xml` keeps the declared key. Recreate with the real `.env` and
   run a search.
7. AC-9: `docker compose logs torrent api | grep -c "$TORRENT_API_KEY"` prints `0`.
