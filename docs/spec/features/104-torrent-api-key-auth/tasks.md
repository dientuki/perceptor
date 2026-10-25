---
title: qBittorrent Authenticated by API Key, Not by Subnet — Tasks
last_updated: 2026-10-25
status: Draft
---

# TASKS: qBittorrent Authenticated by API Key, Not by Subnet (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[infra]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation and the acceptance walk. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install `ptor`, not this checkout, so
`bin/cli`/`bin/npm` may find no container. Until a `perceptor` dev stack is up without colliding
with `ptor`'s ports, run each *Done when* command through a throwaway container (memory:
`measuring-without-dev-stack`), and report which form was used. **Never edit, restart or recreate
`ptor`'s containers.** The infra checks run against `docker run --rm` containers of the freshly
built images with a scratch `/config`.

The contract (`spec.md` § GraphQL Contract Delta) is frozen and produced by nothing new in
`schema.gql`. It is one error key, so `infra`, `api` and `web` can work in parallel from the start.

## Tasks

### Group 1 — `infra`: the key exists and qBittorrent requires it

- [ ] **T001** `[infra] [P]` Per `infra/plan.md` steps 1–2:
      - drop the whitelist expression and its comment wording from `services/torrent/Dockerfile`;
      - add `services/torrent/custom-cont-init.d/30-qbittorrent-apikey`, which in order does:
        1. turns the whitelist off and deletes the `AuthSubnetWhitelist=` line, unconditionally;
        2. validates `^qbt_[A-Za-z0-9]{28}$`;
        3. on a bad key, writes one stderr line naming `TORRENT_API_KEY` (never its value), then runs
           the s6 exitcode and halt, then `exit 1`;
        4. upserts `WebUI\APIKey`, comparing with quotes stripped.

      *Done when:*
      - `bin/build dev torrent` succeeds;
      - a throwaway container of that image on a fresh scratch `/config` with a valid key: the conf
        shows `AuthSubnetWhitelistEnabled=false` and the key; `curl` to
        `localhost:8080/api/v2/app/version` answers `200` with the bearer header and `403` without;
        the healthcheck URL `/` answers `200`;
      - the same with a pre-`104` scratch conf (whitelist `true`) reads `false` after boot, with its
        `Password_PBKDF2` line unchanged;
      - an empty key and a hex key each exit non-zero, the log names `TORRENT_API_KEY`, the key
        value appears nowhere in the log, and the conf already reads `false`.
- [ ] **T002** `[infra] [P]` Per step 6: in `services/indexer/custom-cont-init.d/10-prowlarr-apikey`,
      put the s6 exitcode and halt pair before each of the two existing `exit 1` lines, and nowhere
      else.
      *Done when:*
      - `bin/build dev indexer` succeeds;
      - a throwaway container with an empty `INDEXER_API_KEY` exits non-zero, its log names the
        variable, and a pre-seeded scratch `config.xml` keeps its `<ApiKey>`;
      - with a valid key, on both a fresh and a pre-seeded `/config`, it stays up and `/ping`
        answers `200`.
- [ ] **T003** `[infra]` Per steps 3–5:
      - add `TORRENT_API_KEY=${TORRENT_API_KEY}` (no default) to `torrent` and `api` in
        `docker-compose.yaml`;
      - add `TORRENT_API_KEY=` with an English comment to `.env.example`;
      - generate the key in `install.sh` (beside `INDEXER_API_KEY`, before the stack starts) and in
        `bin/install`: `qbt_` plus 28 characters from `[A-Za-z0-9]`, looping until the length is
        exactly 32, appended only when absent or empty.

      → T001

      *Done when:*
      - `docker compose config --quiet` exits 0;
      - `docker compose config` shows `TORRENT_API_KEY` under both `torrent` and `api`;
      - running the generation block against a scratch `.env` with no key adds exactly one line
        matching `^TORRENT_API_KEY=qbt_[A-Za-z0-9]{28}$`;
      - re-running leaves it, and every other line, byte-identical (`diff` empty).

### Group 2 — `api`: send the key, name the rejection

- [ ] **T004** `[api] [P]` Per `api/plan.md` steps 1–3:
      - add `TORRENT_CLIENT_UNAUTHORIZED` to `src/i18n/error-keys.ts` and its English text (verbatim
        from the spec) to `src/i18n/messages.en.ts`;
      - add `src/downloads/torrent-client-failure.ts` with `torrentClientFailure` and
        `describeTorrentClientFailure`;
      - make `DownloadsService.callTorrentClient` delegate to it;
      - add `src/downloads/torrent-client-failure.spec.ts`, with its Article IX header and the cases
        listed in the plan, including the sentinel-key absence check.

      *Done when:*
      - `bin/npm api test -- torrent-client-failure messages.en` is green;
      - removing the `401` arm, or swapping the two keys, makes the new suite fail (fault injection,
        reverted after).
- [ ] **T005** `[api]` Per steps 4 and 7:
      - add `src/clients/torrent/auth.ts`;
      - pass `headers: torrentAuthHeaders()` on all seven `fetch` calls of `QbittorrentClient`;
      - send the same headers from `setQbittorrentLogin`, mapping `401`/`403` to reason
        `credencial rechazada (TORRENT_API_KEY)`;
      - extend `src/clients/torrent/client.spec.ts` with a test parametrized over the seven methods
        (sentinel bearer header);
      - extend `src/shared-login/shared-login.spec.ts` with the header and `403`-reason cases.

      → T004

      *Done when:*
      - `bin/npm api test -- client shared-login` is green;
      - dropping the header from `setSavePath` alone makes the parametrized case fail (fault
        injection, reverted after).
- [ ] **T006** `[api]` Per steps 5–6:
      - wrap `AttachSourceService.attach`'s reactivation `info()`/`start()` and its `add()` so a
        failure throws `torrentClientFailure(err)`;
      - log `describeTorrentClientFailure(err)` from `liveInfoByHash`, `liveInfoForHash` and
        `MediaSourcesService.downloadedFiles`, keeping their empty / `undefined` / `null` returns;
      - extend `src/acquisition/attach-source.service.spec.ts`: a `TorrentClientError(…, 403)` from
        `add()` rejects with `error.download.torrent_client_unauthorized`, and
        `prisma.mediaSource.create` is never called.

      → T004

      *Done when:*
      - `bin/npm api test -- attach-source downloads media-sources` is green;
      - moving the wrap out of `add()` makes the new case fail (fault injection, reverted after).
- [ ] **T007** `[api]` Per step 8: delete the `torrent_api_key` entry from `prisma/seeds/settings.ts`.
      Then run the slice's full gate. → T005, T006
      *Done when:*
      - `grep -rn torrent_api_key services/api/src services/api/prisma/seeds` prints nothing;
      - `bin/cli api npx --no tsc --noEmit` reports 0 errors;
      - `bin/npm api test` is green;
      - `bin/comments api` passes;
      - `git diff services/api/src/schema.gql` is empty.

### Group 3 — `web`: the copy

- [ ] **T008** `[web] [P]` Per `web/plan.md`: add `error.download.torrent_client_unauthorized` to
      `services/web/messages/en.json` and `es.json`, text verbatim from the spec, beside
      `torrent_client_rejected`.
      *Done when:*
      - both files parse;
      - a `node -e` over them prints the same `error.download` key list for `en` and `es`;
      - `bin/cli web npx --no tsc --noEmit` reports 0 errors.

### Group 4 — docs and verification

- [ ] **T009** `[docs]` `docs/spec/graphql-contract.md`:
      - add a `104` section with the new key, its HTTP class, no params, and the six acquisition
        mutations now keyed;
      - correct the `059` paragraph so it is true;
      - add the key to the § "UI internationalization" vocabulary.

      → T004

      *Done when:* `grep -n torrent_client_unauthorized docs/spec/graphql-contract.md` hits the new
      section and the vocabulary.
- [ ] **T010** `[docs]` Update the docs:
      - root `CLAUDE.md`: § Environment gets a `TORRENT_API_KEY` bullet (declared, applied by
        `30-qbittorrent-apikey`, read by `api` from the environment, never a Setting). The
        **Download** row gets a `104` note (`api` authenticates by API key; no subnet bypass). Note
        that both init scripts now halt the container on a refusal;
      - `services/api/CLAUDE.md`: `clients/torrent/` (bearer header, `auth.ts`), `downloads/`
        (`torrent-client-failure.ts`) and `shared-login`;
      - `README.md`'s update section: upgrading to this version means re-running `install.sh`, since
        pulling images alone leaves `torrent` restarting.

      → T003, T007

      *Done when:* each of the three files names `TORRENT_API_KEY`, and the README's update section
      says to re-run `install.sh` for this version.
- [ ] **T011** `[docs]` Manual pass on a live stack, per `plan.md` § Verification. Rebuild
      `torrent`, `indexer` and `api` together. Walk AC-1 to AC-10:
      - AC-1, AC-5 and AC-6 against an `install.sh` directory, both fresh and pre-`104`;
      - the rest on the dev stack.

      Tick each box in `spec.md` that passes. Mark `[~]` and log in § Blocked any that cannot be
      reached on this host.

      → T001, T002, T003, T007, T008

      *Done when:* every AC in `spec.md` is `[x]`, or `[~]` with a row below naming what it needs.
- [ ] **T012** `[docs]` Append a `104` entry to `docs/spec/history.md` (typecheck/test counts,
      migrations, contract diff). Run `/pending-acs`. Set `status: Implemented` on `spec.md`,
      `plan.md` and the three `<svc>/plan.md`, and `status: Done` here. → T009, T010, T011
      *Done when:*
      - `grep -n "^status" docs/spec/features/104-*/{spec,plan,*/plan}.md` shows `Implemented`
        everywhere;
      - `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
