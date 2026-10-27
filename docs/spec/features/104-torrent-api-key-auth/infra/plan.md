---
title: qBittorrent Authenticated by API Key, Not by Subnet — infra slice
service: infra
last_updated: 2026-10-25
status: Implemented
---

# PLAN: qBittorrent Authenticated by API Key, Not by Subnet — `infra` (`infra/plan.md`)

## Scope

`infra` makes qBittorrent require the API key and makes the key exist:
- the image stops shipping the subnet whitelist;
- an init script enforces the whitelist being off, then validates and applies `TORRENT_API_KEY`;
- both installers generate the key;
- compose passes it to `torrent` and `api`;
- `indexer`'s existing key refusal stops the container for real (REQ-9).

`infra` does **not** touch how `api` uses the key (`services/api/`), the message catalogs
(`services/web/`), or the docs (orchestrator).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/torrent/Dockerfile` | Modified | Drop the `/^\[Preferences\]/a WebUI\\AuthSubnetWhitelist…` expression from the `sed`. The two `Downloads\\…Path` expressions stay. The comment above it loses "Auth bypass for Docker's internal network". |
| `services/torrent/custom-cont-init.d/30-qbittorrent-apikey` | New | Whitelist off, key validation, `WebUI\APIKey` upsert, s6 halt on a bad key. |
| `docker-compose.yaml` | Modified | `TORRENT_API_KEY=${TORRENT_API_KEY}` in `torrent.environment` and `api.environment`, with no `:-` default. |
| `.env.example` | Modified | `TORRENT_API_KEY=` beside `INDEXER_API_KEY`, with a comment on its shape and that the installers generate it. |
| `install.sh` | Modified | Generate the key when `env_var_is_empty TORRENT_API_KEY`, before the stack starts. |
| `bin/install` | Modified | Same generation, in the same spot as `INDEXER_API_KEY`. |
| `services/indexer/custom-cont-init.d/10-prowlarr-apikey` | Modified | Its two `exit 1` branches (empty key; `config.xml` with no `<ApiKey>`) halt the container through s6 first. Nothing else in the script changes. |

## Existing code to reuse

- `services/torrent/custom-cont-init.d/10-qbittorrent-password` provides:
  - the shape: `set -euo pipefail`, the `CONF_PATH` existence check, a Python heredoc editing the Qt
    INI line by line;
  - `get_value` with its quote stripping (qBittorrent re-serializes on shutdown);
  - `upsert` into `[Preferences]`.

  Copy those helpers rather than invent a parser. `configparser` cannot read this file, as the
  existing scripts already state.
- `services/indexer/custom-cont-init.d/10-prowlarr-apikey` provides the fail-loudly posture and its
  log wording. Its own `exit 1` does not stop Prowlarr, because LinuxServer's `init-custom-files`
  ignores the exit code. Step 6 fixes that with the same halt the new torrent script uses.
- `install.sh`'s `env_var_is_empty` and `ensure_env_var`, and `bin/install`'s
  `current_…=$(grep …)` and `ensure_env_var` pattern, as already used for `JWT_SECRET` and
  `INDEXER_API_KEY`. Unlike `INDEXER_API_KEY`, nothing needs adopting from an existing volume: a
  pre-`104` `qBittorrent.conf` carries no key, and REQ-2 makes `.env` authoritative anyway.

## Steps

1. **Dockerfile.** Remove the whitelist `-e` expression and fix the comment. The defaults then
   carry no `AuthSubnetWhitelist*` lines; qBittorrent's own default for the switch is off.
2. **Init script** `30-qbittorrent-apikey`, executable (`COPY --chmod=755` already covers the
   directory). Order inside the script matters:
   1. Fail with `exit 1` if `qBittorrent.conf` does not exist, as the siblings do.
   2. In `[Preferences]`, upsert `WebUI\AuthSubnetWhitelistEnabled=false` and delete any
      `WebUI\AuthSubnetWhitelist=` line. This runs **unconditionally and first** (REQ-3), so a bad
      key below can never leave a bypass behind.
   3. Validate `TORRENT_API_KEY` against `^qbt_[A-Za-z0-9]{28}$`. When it is empty or wrong, print
      one line to stderr: `[30-qbittorrent-apikey] ERROR: TORRENT_API_KEY is <empty|malformed>:
      expected qbt_ followed by 28 letters or digits. Re-run install.sh to generate it.` Then run
      `echo 1 > /run/s6-linux-init-container-results/exitcode` and `/run/s6/basedir/bin/halt`,
      then `exit 1`. **Never print the value** (NFR-1), not even a prefix.
   4. Upsert `WebUI\APIKey=<key>` in `[Preferences]`, comparing quote-stripped. Log "already has
      the declared key" or "writing the declared key", without the value.

   Run it through `with-contenv` the way `10-prowlarr-apikey` does, so `TORRENT_API_KEY` is
   visible.
3. **Compose.** Add the variable to both services. Do not add `TORRENT_API_KEY` to anything
   `environmentInfo` reads; that allowlist lives in `api` and stays as it is.
4. **`.env.example`.** Ship `TORRENT_API_KEY=` empty, with a comment in English.
5. **Installers.** Generate with `openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 28`,
   prefix `qbt_`, and regenerate in a loop until the length is exactly 32. In `install.sh`, place it
   beside the `INDEXER_API_KEY` block, before the stack starts, so the first `up` already has it.
   Re-running either installer on an existing directory adds the key and leaves every other value
   untouched (`ensure_env_var` appends when the line is missing).

6. **Prowlarr halt** (REQ-9). In `10-prowlarr-apikey`, put the same pair before each of the two
   existing `exit 1` lines: `echo 1 > /run/s6-linux-init-container-results/exitcode` and
   `/run/s6/basedir/bin/halt`. Keep the existing log lines; reword "Aborting." only if it would
   otherwise read false. The happy paths (key already matching, a differing key rewritten, a
   missing `config.xml` created) must not reach the halt.

## Contract obligations

None at the GraphQL level. The obligations are toward `api`:
- the variable name is `TORRENT_API_KEY`;
- it reaches the `api` container's environment;
- its shape is `qbt_` followed by 28 characters from `[A-Za-z0-9]`.

Do not change the name or the shape.

## Tests

No automated suite covers shell init scripts in this repository. The checks are the live ones, run
against a throwaway container of the built image (`docker run --rm` with a scratch `/config`), never
the user's running stack:

- a fresh `/config` with a valid key: the conf shows `AuthSubnetWhitelistEnabled=false` and the
  declared `WebUI\APIKey`; `curl -H "Authorization: Bearer <key>" localhost:8080/api/v2/app/version`
  answers `200` and without the header `403`;
- a pre-`104` `/config` (whitelist `true`): after boot it reads `false`, and its torrents and login
  hash are untouched;
- an empty key and a hex key: the container exits non-zero, its log names `TORRENT_API_KEY`, the key
  value appears nowhere in the log, and the conf already reads `AuthSubnetWhitelistEnabled=false`;
- the container's healthcheck (`curl -f http://localhost:${QBITTORRENT_WEBUI_PORT}/`) still goes
  green with the whitelist off. The root page serves the login form unauthenticated; confirm that
  rather than assume it.

- `indexer` with an empty `INDEXER_API_KEY`: the container exits non-zero, the log names the
  variable, and a pre-existing `config.xml` keeps its declared `<ApiKey>`;
- `indexer` with a valid key, on both a fresh and an existing `/config`: it stays up, `/ping`
  answers, and the FlareSolverr proxy is still registered.

## Done when

```bash
bin/build dev torrent
bin/build dev indexer
docker compose config --quiet
```

The six throwaway-container checks above pass, and `bin/install` on a checkout whose `.env` lacks
the key adds exactly one `TORRENT_API_KEY=qbt_…` line of length 36 (`TORRENT_API_KEY=` plus 32).
