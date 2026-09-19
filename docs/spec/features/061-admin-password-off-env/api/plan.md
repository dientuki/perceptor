---
title: Admin Password Off .env — api slice
service: api
last_updated: 2026-09-19
status: Approved
---

# PLAN: Admin Password Off .env — `api` (`api/plan.md`)

## Scope

`api` owns the one password-set command. It turns `scripts/reset-password.ts` into a command that
updates the app user and, for the shared admin, qBittorrent and Prowlarr too. It also stops the
seed from ever creating an admin with a known default password.

This slice does **not** touch `install.sh`, `bin/*`, `docker-compose.yaml`, `.env.example` or the
torrent/indexer init scripts. Those are `infra`. It adds no GraphQL surface and no Prisma
migration.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/shared-login/shared-login.ts` | New | `setQbittorrentLogin` and `setProwlarrLogin`, each taking `(config: Record<string,string>, username, password, fetchFn = fetch)` and returning `{ target, ok, reason? }` |
| `services/api/src/shared-login/shared-login.spec.ts` | New | Article IX suite, see Tests |
| `services/api/scripts/reset-password.ts` | Modified | Reject an empty password; after the app update, when `username === process.env.ADMIN_USER`, read the settings and call both functions; one output line per target; exit 1 if any failed |
| `services/api/prisma/seeds/users.ts` | Modified | No `changeme`. With `ADMIN_PASSWORD` empty, hash `crypto.randomBytes(32)` instead |

## Existing code to reuse

- `scripts/reset-password.ts`: `prompt()`, which already handles both the TTY and the pipe
  (`promptHidden` and `promptPlain` over a shared async iterator). Keep it exactly. `install.sh`
  depends on the pipe path.
- `src/prisma/prisma.service.ts`, over a relative import, as the script already does. It has no
  `@/` alias, because bare `ts-node` has no paths register.
- `SettingsService.getMap()` (`src/settings/settings.service.ts`) defines the shape. Rebuild the
  same `Record<string,string>` from `prisma.setting.findMany()` in the script, since the service
  cannot be constructed without DI.
- The keys `torrent_host`/`torrent_port` (`QbittorrentClient.baseUrl()` in
  `src/clients/torrent/client.ts`) and `tracker_host`/`tracker_port`/`tracker_api_key`
  (`src/clients/indexer/client.ts`).
- The Prowlarr body transform, which is the jq in
  `services/indexer/custom-services.d/10-prowlarr-credentials` (read it, do not edit it).
- `TorrentClientError` (`src/clients/torrent/client.ts`), for the pattern of carrying the HTTP
  status in the failure reason. Status 0 means unreachable.

## Steps

1. Write `shared-login.ts`.
   - **qBittorrent.**
     - `POST http://<torrent_host>:<torrent_port>/api/v2/app/setPreferences`, form-encoded
       `json={"web_ui_username":…,"web_ui_password":…}`.
     - Then `GET /api/v2/app/preferences`: `ok` only if both calls are 2xx and the returned
       `web_ui_username` equals the requested one.
     - Link the qBittorrent WebUI API docs above each call (Article XI exception 1).
   - **Prowlarr.**
     - `GET http://<tracker_host>:<tracker_port>/api/v1/config/host` with `X-Api-Key`.
     - Spread the result and set `authenticationMethod: 'forms'`,
       `authenticationRequired: 'enabled'`, `username`, and `password`/`passwordConfirmation`
       from the same variable.
     - `PUT` the same URL.
     - Link the Prowlarr API docs.
   - **Errors.** A thrown `fetch` gives `{ ok: false, reason: 'unreachable' }`, or the equivalent
     text. A non-2xx gives `{ ok: false, reason: 'HTTP <status>' }`. The password never goes in a
     URL or a reason string.
2. Write `shared-login.spec.ts` (see Tests).
3. Change `reset-password.ts`.
   - After the confirmation matches, reject an empty value with a Spanish message and exit 1,
     before any write.
   - After the `prisma.user.update`, print `App: contraseña actualizada para "<user>".`
   - If `username === process.env.ADMIN_USER`, build the settings map and await both functions.
     Print one line per result: `qBittorrent: actualizado` or `qBittorrent: NO actualizado
     (<reason>)`, and the same for Prowlarr.
   - If any result failed, add a closing line saying the command can be re-run once the service
     is back, then `process.exitCode = 1`.
4. Change `prisma/seeds/users.ts`.
   - `const password = process.env.ADMIN_PASSWORD || randomBytes(32).toString('hex')`, then hash.
   - The `update` branch stays `{ isAdmin: true }`, so an existing password is never touched.
5. Check that `nest build` still emits `dist/scripts/reset-password.js` (`ls dist/scripts` in the
   container after `bin/npm api run build`), and that it runs under plain `node`: every import it
   uses must be a runtime dependency present in the `prod` image.

## Contract obligations

The CLI contract frozen in `../plan.md` § Contract Freeze:
- the compiled path;
- one positional `<username>`;
- two stdin lines;
- exit 0 only when every applicable target was updated;
- one Spanish output line per target;
- always write, never skip as "already configured";
- a non-admin user touches the app only.

`infra`'s installers depend on every point. If one is wrong, stop and report.

## Tests

`src/shared-login/shared-login.spec.ts` is owed. Header: *a shared-login push that reports
success while qBittorrent or Prowlarr kept the old password leaves the three logins silently out
of sync, and the operator only finds out when a login fails later.* Cases, with an injected fake
`fetch`:

- qBittorrent: `setPreferences` 200 and the preferences read back with the new username → `ok`.
- qBittorrent: `setPreferences` 200 but the read-back username differs → not `ok`.
- qBittorrent: `fetch` throws → not `ok`, and the reason says unreachable.
- qBittorrent: `setPreferences` 403 → not `ok`, and the reason carries 403.
- Prowlarr: `GET` 401 → not `ok`, and no `PUT` is issued.
- Prowlarr: the `PUT` body has `authenticationMethod: 'forms'`, the username, and
  `password === passwordConfirmation === input`. The `X-Api-Key` header is sent.
- Neither function ever puts the password in a requested URL.

The seed change and the script's wiring are not owed tests. The seed is one expression, and the
wiring is print-and-exit over the tested functions. AC-2, AC-5 and AC-6 cover both manually.
