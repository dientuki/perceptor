---
title: Perceptor Constitution
version: 1.0.0
ratified_at: 2026-08-09
last_amended: 2026-08-09
---

# Perceptor Constitution

The non-negotiable rules of this codebase. Everything here is already true of the repository —
this document writes it down so that a spec, a reviewer, or an agent can be held to it.

Every article carries a **Check** line. A principle nobody can verify is decoration, not a rule.
When an article and a `CLAUDE.md` disagree, the article wins and the `CLAUDE.md` is the bug.

Amend through `/constitution`. Bump `version` (semver: MAJOR for removing or reversing an
article, MINOR for adding one, PATCH for wording) and append to the Changelog.

---

## Article I — Docker-first

Nothing runs on the host. There is no host toolchain, no host MariaDB, no host Redis. Every
command goes through a wrapper in `bin/`, which shells into the running container.

`npm`, `npx`, `nest`, `prisma`, `next`, `tsc`, `vitest` and `jest` are **never** invoked directly.

**Check** — a command in a spec, plan, task or agent report that does not start with `bin/` and
is not a plain `git`/`docker compose` invocation violates this article.

## Article II — GraphQL is the only contract

`web` and `worker` reach `api` exclusively through GraphQL. `web` uses `fetchGraphQL`
(`services/web/src/lib/graphql-client.ts`); `worker` uses its own
(`services/worker/src/api/graphql-client.ts`). Neither ever touches the database.

**One exception, and it is closed**: `POST/PATCH/HEAD /uploads` on `api`
(`services/api/src/uploads/`) is REST because a resumable multi-gigabyte tus upload fits neither a
GraphQL mutation nor a Next Server Action. It closes its own loop inside the request that receives
the last chunk. No second REST route may be added without amending this article.

**Check** — `grep -rn "@prisma/client" services/web/src services/worker/src` returns nothing.
Any hit is either a pre-GraphQL leftover to delete or a violation to reject.

## Article III — The database belongs to `api`

Prisma lives in `services/api/prisma/` and only `api` holds a client. There is no `db` service to
assign work to, and no agent owns the database independently of `api`.

Every schema change is a migration in `services/api/prisma/migrations/`, generated through
`bin/npm api run prisma:migrate`. Hand-written SQL against a running database is for **inspection
only** (`bin/mysql -e 'select …'`); it never changes schema or seeded state.

**Check** — `git status services/api/prisma/` after a schema change shows both a modified
`schema.prisma` and a new migration directory. One without the other is a violation.

## Article IV — The GraphQL schema is generated, never written

`api` is code-first: `autoSchemaFile` in `app.module.ts` regenerates
`services/api/src/schema.gql` on every boot from the decorators in each module's `entities/` and
`dto/`. The file carries a generated-file banner.

To change the schema you change a decorator. Editing `schema.gql` is always wrong — the next boot
silently reverts it.

**Check** — `schema.gql` never appears in a diff *alongside* no decorator change. It may appear
alone as a regeneration artifact; it may not appear as an authored edit.

## Article V — Paths are relative to a media root

`api` declares exactly two roots (`HOST_DOWNLOADS_DIR`, `HOST_DESTINATIONS_DIR` and their
`CONTAINER_*` twins). The `path_downloads` / `path_movies` / `path_shows` settings are **segments
relative to those roots**, never absolute container paths.

An absolute container path never crosses the GraphQL boundary in either direction. `web` shows and
edits the host-side path; `worker` receives a resolved `outputRoot` in its job payload;
`MediaRootsService` (`services/api/src/media-roots/`) owns every translation, including
`containerToHostPath()` for the media-server notification.

**Check** — no string starting with `/media/`, `/downloads/` or any `CONTAINER_*` value appears in
a GraphQL response or in `services/web/src`. `media-roots.service.spec.ts` covers the escape cases.

## Article VI — Language

Code comments are **English**. Identifiers, type names, documentation, spec files and commit
messages are **English**. Test descriptions follow the code: English `it(...)` strings.

Commits are `[scope] lowercase message`, scope being the service (`[api]`, `[web]`, `[worker]`,
`[docs]`).

**Check** — reading any new file, the comments are English and the identifiers are English.

## Article VII — No spec, no code

A change starts as a feature spec (`docs/spec/features/NNN-slug/spec.md`, via `/specify`) when it
does **any** of:

- touches more than one service,
- changes the Prisma schema,
- changes the GraphQL contract,
- adds or removes a pipeline stage.

Everything else — a bug fix, a rename, a doc correction, a change confined to one file — does not
need one. This article exists to prevent cross-service improvisation, not to add ceremony to small
work.

**Check** — a diff touching two or more `services/*` directories has a corresponding
`docs/spec/features/NNN-*/` directory.

## Article VIII — The contract is frozen before implementation starts

The GraphQL delta of a feature — every new type, field, mutation, argument and error condition —
is written into `spec.md` under `## GraphQL Contract Delta` and approved **before** any service
begins work.

While a feature is being implemented that delta is **read-only** to implementers. A service that
finds the contract wrong stops and reports; it does not adjust the contract to fit its own slice.
Changing it means going back to `spec.md`, re-approving, and telling the other services.

This is the article that makes parallel per-service work safe. There is no codegen between `api`
and its two consumers — `web` and `worker` retype the schema by hand — so an unannounced contract
change fails silently at runtime, not at compile time. See `docs/spec/graphql-contract.md`.

**Check** — the final `schema.gql` diff matches the `## GraphQL Contract Delta` in `spec.md`. Any
difference is either an unreported contract change or a stale spec; both must be resolved before
the feature closes.

## Article IX — Test where failure is silent

Coverage is not a goal. Tests are owed to code where a bug produces **no error anywhere** — wrong
results, stuck state, or a security hole that looks like success.

The two mature suites in this repository are the standard:

- `services/api/src/media-roots/media-roots.service.spec.ts` — a bug here is a real path
  traversal, so it runs against a real `mkdtemp` with real symlinks rather than mocks.
- `services/api/src/clients/torrent/magnet.spec.ts` — an infoHash that does not match what
  qBittorrent reports leaves a movie in `DOWNLOADING` forever with no error in any log.

Both open with a paragraph stating what class of bug they defend against. New specs do the same.

Conversely, the 18-line `expect(service).toBeDefined()` files under `services/api/src/users/` are
`nest g` scaffolding. Do not extend them and do not imitate them.

**Check** — every new test file opens with a comment naming the failure it prevents. If that
sentence cannot be written, the test is probably not owed.

---

## Changelog

| Version | Date | Change |
| :-- | :-- | :-- |
| 1.0.0 | 2026-08-09 | Ratified. Articles I–VI codify rules already in `CLAUDE.md`; VII–IX introduce spec-driven development. |
