---
title: Development Stack Contract and FlareSolverr — api slice
service: api
last_updated: 2026-08-17
status: Implemented
---

# PLAN: Development Stack Contract and FlareSolverr — `api` (`api/plan.md`)

## Scope

Two changes, unrelated to each other except that the second is what makes the first's failures
visible.

1. The settings seed takes `tracker_api_key` from the `INDEXER_API_KEY` environment variable instead
   of seeding it empty and waiting for a human to paste it in (REQ-14).
2. `ProwlarrClient` stops treating a failed HTTP response as a list of releases, and raises instead
   (REQ-15).

It is explicitly **not** doing: reading the key at request time (the seed writes it once into the
`Setting` row, and `SettingsService` stays the only reader — no fallback path, no second source of
truth), adding a GraphQL field or type, touching the Prisma schema, or rendering anything. Making
Prowlarr answer to that key belongs to the `indexer` container scripts and wiring the variable into
the container belongs to `docker-compose.yaml`, both in `../infra/plan.md`; showing the error to the
user is `../web/plan.md`.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/seeds/settings.ts` | Modified | `tracker_api_key` seeds from `process.env.INDEXER_API_KEY`; the create-only loop gains a narrow backfill for rows that exist but are empty. |
| `services/api/src/clients/indexer/client.ts` | Modified | `getData` checks the response status and raises instead of parsing a failure body. |
| `services/api/src/clients/indexer/client.spec.ts` | New | The one test this feature owes (see § Tests). |

No new module. If this slice produces one, the plan missed something — report it.

## Existing code to reuse

- `services/api/prisma/seeds/settings.ts` — the existing `settings` array and its create-only loop
  (`findUnique`, then `create` only when absent). Extend this loop; do **not** add a second pass over
  the array, and do **not** convert it to `upsert`. The comment above it explains why it is
  create-only: a re-run must never clobber a real value someone configured through the UI, and
  `tracker_api_key` is named in that comment as one of the values being protected. The change here
  narrows that protection by exactly one case — an existing row whose `value` is the empty string —
  and the comment must be rewritten in English to say so, since the block is being edited anyway
  (Article VI, `spec.md` NFR-4).
- `services/api/src/settings/settings.catalog.ts` — `tracker_api_key` is already declared
  `{ kind: 'secret' }`. The key exists in the catalog, in the seed and in `SettingsForm.tsx`; this
  slice introduces no new setting key and must not add one.
- `@nestjs/common`'s exception classes, as already used across the service — `BadRequestException`
  in `languages.service.ts` and `media-roots.service.ts`, `NotFoundException` and
  `ConflictException` in `movies.service.ts`. Follow that convention rather than throwing a bare
  `Error`; Nest maps these onto the GraphQL error the consumer reads. `ServiceUnavailableException`
  is the right one here — the caller's request was fine, the upstream indexer was not — and it is
  new to this codebase, so use it deliberately and not as a copy-paste of `BadRequestException`.
- `services/api/src/clients/torrent/magnet.spec.ts` — the model for the new test file, and the
  closest existing analogue: it exists because a bad infoHash leaves a movie stuck in `DOWNLOADING`
  with no error anywhere. Same class of bug, same shape of defence. Open the new file with a comment
  naming the failure it prevents, as that one does (Article IX).

## Steps

1. In `services/api/prisma/seeds/settings.ts`, change the `tracker_api_key` entry to take its value
   from `process.env.INDEXER_API_KEY`, defaulting to the empty string when unset — an unset variable
   must produce today's exact behaviour, not a crash. Every other entry is untouched.
2. In the same file's loop, add the backfill: when the row exists and its `value` is the empty string
   while the seeded value is not, `update` it. A row with any non-empty value is left alone,
   unconditionally. Keep this inside the existing loop rather than special-casing one key —
   `movie_db_api_key` and `media_server_api_key` get the same rule, and since neither has an
   environment variable behind it today the behaviour change is confined to keys that gain one.
3. Rewrite that block's Spanish comment in English, stating both the create-only rule and the new
   empty-row exception.
4. In `services/api/src/clients/indexer/client.ts`, make `getData` check the response before parsing
   it. On a non-success status, raise `ServiceUnavailableException` with the exact message from
   `../spec.md` § GraphQL Contract Delta, including the status code. Wrap the `fetch` itself so a
   connection failure raises the same exception with the no-status variant of the message. Both
   strings are frozen copy — copy them from the spec, do not improve them here.
5. Leave `filterData`, `resolveInfoHash`, `filterIAData` and `score.ts` alone. The bug is that a
   failure reaches `filterData` at all, not anything `filterData` does.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is this slice's to honour on the producing side. It carries **no
schema change**: `services/api/src/schema.gql` must come out byte-identical, and if `git diff` shows
it changed, that is a stop-and-report rather than a commit. `searchTorrents` keeps its exact
signature.

What is new is one error condition on that existing query, and the two Spanish strings that go with
it are user-facing copy rendered verbatim by `web`:

- non-success status → `No se pudo consultar el indexer (HTTP <status>)`
- unreachable → `No se pudo consultar el indexer`

An empty result set from a **successful** response stays an empty list and must not raise — that
distinction is the entire point of REQ-15.

Also frozen, from `../plan.md` § Contract Freeze: the environment variable is named exactly
**`INDEXER_API_KEY`**. It is written by `bin/install`, read by two shell scripts in the `indexer`
container, and read here — four places, three languages, nothing checking they agree. Do not rename
it, do not add a `TRACKER_API_KEY` alias, and do not read it through a config module that does not
exist.

## Tests

**One new test file: `services/api/src/clients/indexer/client.spec.ts`.**

This is textbook Article IX. The bug being fixed produces no error anywhere: a `401` is parsed as
JSON, handed to `filterData`, and comes out as an empty array that the UI renders as "no releases
found". Nothing logs, nothing throws, and the user concludes the title was never released. It is
also the bug that would mask every other failure this feature can produce, which is why it is worth a
test rather than only an acceptance criterion. Open the file with a comment naming exactly that,
following `services/api/src/clients/torrent/magnet.spec.ts`.

What it must cover, with `fetch` stubbed and `SettingsService` faked:

- a `401` response raises, and the message carries the status code;
- a `500` response raises;
- a rejected `fetch` (connection refused) raises the no-status message;
- a `200` response carrying an empty array returns `[]` and does **not** raise — the regression that
  matters, since over-eager raising would break the ordinary "nothing found" path.

**No test for the seed change.** Seeding the wrong value or failing to backfill is caught by AC-4,
which compares the row against `.env` and against Prowlarr's own `config.xml` — a real assertion
against a real database, stronger than a unit test here. The failure that *would* be silent —
clobbering a configured value — is prevented by a conditional this slice makes strictly narrower than
today's (`!existing` becomes `!existing || existing.value === ''`): there is no state in which the
new code writes where the old code would not, except the empty-string case the feature is for. A spec
file around it would exercise Prisma's `update`, not Perceptor's behaviour.

## Done when

```bash
bin/cli api npx --no tsc --noEmit             # 0 errors
bin/npm api test                               # 122 pre-existing still passing, plus the new suite
git diff --stat services/api/src/schema.gql    # no output
```

And, once `INDEXER_API_KEY` exists in `.env` and reaches the container (that is `../infra/plan.md`'s
step, not this one's):

```bash
bin/cli api npx --no ts-node prisma/seeds/index.ts
bin/mysql -e 'select `key`, value from settings'
```

The `tracker_api_key` row holds the value of `INDEXER_API_KEY`. Re-running the seed leaves it
unchanged, and a row edited to some other non-empty value survives a re-run untouched.
