---
title: UI Internationalization — worker slice
service: worker
last_updated: 2026-08-20
status: Implemented
---

# PLAN: UI Internationalization — `worker` (`worker/plan.md`)

## Scope

`worker` renders nothing and shows nothing to anybody. Its slice is small and entirely about the
seam: every failure it reports must travel as a **key plus parameters** instead of a rendered
Spanish sentence, so that the row it lands in can be displayed in either language later.

`worker` does **not** define the shared vocabulary — the keys it emits are frozen in `../spec.md`,
alongside `api`'s. It ships no `es` catalog and no translation machinery: it produces English
`errorMessage` text and nothing else. It does not read a locale, and it must not start doing so.

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/i18n/error-keys.ts` | New | The worker's keys from `../spec.md`, as constants |
| `services/worker/src/i18n/messages.en.ts` | New | key → English template, for the `errorMessage` argument |
| `services/worker/src/i18n/keyed-error.ts` | New | An `Error` subclass carrying `key` + `params` |
| `services/worker/src/jobs/encode.job.ts` | Modified | Reports `errorKey`/`errorParams`/`errorMessage`; new `encodeFailed` arity |
| `services/worker/src/jobs/source-ready.job.ts` | Modified | Its three throws become keyed |
| `services/worker/src/ffmpeg/params.ts` | Modified | Two keyed throws |
| `services/worker/src/ffmpeg/metadata.ts` | Modified | One keyed throw |
| `services/worker/src/ffmpeg/runner.ts` | Modified | Three keyed throws — stderr tail becomes a **param** |
| `services/worker/src/paths/build-output-path.ts` | Modified | One keyed throw |
| `services/worker/src/encode/index.ts` | Modified | Unknown-driver throw |
| `services/worker/src/api/graphql-client.ts` | Modified | Propagate `api`'s `extensions.i18n` instead of stringifying the error array |

## Existing code to reuse

- **`src/api/graphql-client.ts`** — it throws on `json.errors`, deliberately, and that stays: a
  worker that swallowed an API error would mark a job complete having written nothing
  (`docs/spec/graphql-contract.md`). What changes is line 50, which today does
  `` `Error de GraphQL: ${JSON.stringify(json.errors)}` ``. Under REQ-11 it must lift the incoming
  `extensions.i18n` onto the thrown error, so an `api` key round-trips as a key. Today it
  round-trips as unreadable JSON that gets persisted verbatim into `ProcessJob.errorMessage`.
- **`src/ffmpeg/runner.ts:9-10`** — the stderr tail is already kept specifically so it can reach
  `encodeFailed`. That intent is unchanged; the tail simply moves from inside the sentence into
  `errorParams`. Do not stop capturing it, and do not truncate it differently.
- **The small-pure-module pattern** — `EncodeInput` in `encode/types.ts` and `OutputPathInput` in
  `paths/build-output-path.ts` retype a local subset rather than importing a bigger shape. The
  `i18n/` files follow the same house style: plain modules, relative imports, no path aliases.
- **`src/queue/types.ts`'s hand-sync rule** — the worker's key list is the same kind of contract as
  that file: duplicated on purpose because the Docker build context (`./services/worker`) physically
  cannot see `../api`. **Do not invent a shared package** to unify the two key lists. Keep them in
  sync by hand against `../spec.md`, which is the source of truth.
- **`src/encode/` driver seam** — new failure behaviour goes behind `EncodeFn`, never inline in a job
  handler. Keying existing throws does not change that.

## Steps

1. Write `src/i18n/error-keys.ts` and `messages.en.ts` from `../spec.md` § Error table — `worker`.
   Copy the keys exactly; a typo here is invisible until a user hits that failure.
2. Write `src/i18n/keyed-error.ts` — an `Error` subclass with `key` and `params`, so an existing
   `throw` keeps working for every `catch` already in the pipeline.
3. Convert the throw sites in `ffmpeg/params.ts`, `ffmpeg/metadata.ts`, `ffmpeg/runner.ts`,
   `paths/build-output-path.ts`, `encode/index.ts` and `jobs/source-ready.job.ts`. `stderr`, exit
   `code`, `filePath` and `iso3` become **params**, never parts of a formatted sentence.
4. Change `src/api/graphql-client.ts` to propagate `extensions.i18n` from an `api` error.
5. Rewrite `encode.job.ts:139-144` to call `encodeFailed` with the new four-argument signature,
   reading `key`/`params` off a `KeyedError` and falling back — for a genuinely unexpected throw —
   to a catch-all key carrying the raw message as a param. **A failure must never report no key.**
6. Leave the three infrastructure errors in `graphql-client.ts` (`INTERNAL_GRAPHQL_URL` unset,
   `SERVICE_TOKEN` unset, the HTTP-status throw) **unkeyed**. They are boot-time operator errors that
   no user ever sees; per Article VI they simply become English. Keying them would imply a UI that
   will never exist.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
encodeFailed(
  processJobId: Int!
  errorKey: String!
  errorParams: String
  errorMessage: String!
): Boolean!
```

- `errorKey` is **required**. There is no path where the worker reports a failure without one.
- `errorParams` is a JSON object **encoded as a string** — `JSON.stringify` it. Not a JSON scalar,
  not an object.
- `errorMessage` stays required and English. It is what keeps a row legible from `bin/mysql` and in
  `api`'s logs without a catalog, which is what makes NFR-3 hold going forward. It is not redundant;
  do not drop it.
- Keys the worker emits that are **owned by `api`** — `error.processJob.not_found`,
  `error.source.no_target`, `error.source.no_download_path` — must be spelled identically to
  `api`'s. They are the same key, not a worker-local variant.

If the contract looks wrong, stop and report. Do not adapt it locally (Article VIII).

## Tests

Two units qualify under Article IX. Both are silent failures, and one is the sharpest in the feature.

- **`src/jobs/encode.job.spec.ts`** (extend, or add if absent) — defends against a failure that is
  never recorded. `encode.job.ts:139` ends in `.catch((err) => console.error(...))`: if the
  `encodeFailed` call is malformed — wrong arity, missing `errorKey`, unstringified params — the
  rejection is **swallowed into a console line**. The `ProcessJob` stays `ENCODING` forever, the user
  watches a job that never finishes, and nothing surfaces anywhere. Assert the mutation is called
  with all four arguments, that `errorParams` is a string, and that an unexpected non-`KeyedError`
  throw still produces a key. Verify the test fails when `errorKey` is dropped.
- **`src/i18n/messages.en.spec.ts`** (new) — defends against a key with no English rendering, which
  persists `undefined` into `ProcessJob.errorMessage` with no error at any point. Assert every
  constant in `error-keys.ts` has a message and that every placeholder is supplied.

**Not owed a test**: the individual throw-site conversions in `ffmpeg/` and `paths/`. Those modules
already have suites covering what they compute; swapping a message for a key changes no behaviour,
and the failure mode — the wrong English sentence on a failed encode — is immediately visible in the
row.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Typecheck reports **0 errors**. The suite is green and larger than the 75/9 baseline recorded in the
root `CLAUDE.md`. Report the before/after counts.

**This slice must ship in the same release as `api`'s.** `encodeFailed` changes signature, and a
worker running against the other version does not crash — it fails to report, silently, exactly as
described above.
