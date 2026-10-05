---
title: Comment Locator Convention — api slice
service: api
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Comment Locator Convention — `api` (`api/plan.md`)

## Scope

You sweep the comments in `services/api/src` and nothing else. This is the largest of the three
slices by a wide margin: roughly **417 Spanish comment lines** and **445 ad-hoc spec references, of
which 348 carry no spec number on their line**. You also rewrite 34 Spanish `it(...)`/`describe(...)`
strings (REQ-12) and the one passage in `services/api/CLAUDE.md` that records them as debt (REQ-13).

You do **not** build the validator (`infra` owns `tools/comments/`), you do **not** touch
`docs/constitution.md`, the root `CLAUDE.md` or `docs/spec/history.md` (the orchestrator owns
those), and you do **not** change a line of production code. Writes are confined to
`services/api/`. Anything else is a stop-and-report.

The validator already exists when you start, and it is red. Run `bin/comments api` first: its
output is your worklist, file by file and line by line.

## Files

Known concentrations, by Spanish comment line count. The sweep covers all of `src`, not only these.

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/media-sources/media-sources.service.ts` | Modified | 43 lines — the heaviest file in the repo. |
| `src/movies/movies.service.ts` | Modified | 38 lines. |
| `src/media-roots/media-roots.service.ts` | Modified | 29 lines, and the delicate one: see § Existing code to reuse. |
| `src/shows/shows.service.ts` | Modified | 21 lines. |
| `src/media-roots/media-roots.service.spec.ts` | Modified | 20 comment lines plus Spanish `it(...)` strings (REQ-12). The Article IX reference suite. |
| `src/process-jobs/process-jobs.service.ts` | Modified | 19 lines. |
| `src/process-jobs/entities/encode-job-details.entity.ts` | Modified | 15 lines, mostly field-level prose on the worker's payload. |
| `src/settings/settings.catalog.ts` | Modified | 14 lines. |
| `src/auth/auth.service.ts` | Modified | The REQ-4 archetype: three comments that restate the code, all deleted. |
| `src/app.module.ts` | Modified | The REQ-5 archetype: `(018-ui-i18n REQ-7)` plus four lines of prose collapse to `// Spec 018, REQ-7`. |
| `services/api/CLAUDE.md` | Modified | REQ-13: the § testing passage that records the Spanish `it(...)` strings as surviving debt. |

## Existing code to reuse

What you reuse here is a **procedure**, not a utility. Follow it for every reference you normalize;
it is `../plan.md` § Risks, row 1 made operational, and the one thing that keeps this slice from
producing authoritative-looking garbage.

- `git blame -L <line>,<line> --porcelain <file> | grep '^summary'` — this repository's commits are
  named `implement NNN spec, <slug>`, so blame resolves a bare `REQ-3` to its spec number
  mechanically. Verified: `importFileModal.tsx:167`'s bare `NFR-1` blames to
  `try to implement 010 episode acquisition spec`, which is the same `Spec 010, NFR-1` a hand search
  through eighty-five `spec.md` files produces.
- `docs/spec/features/NNN-*/spec.md` — **confirm the id's sentence actually describes this code**
  before you write the locator. Blame gives you the spec; the spec's own text is what proves the
  requirement is the right one. A blame that lands on `fix forms` or a `[site]` commit resolves
  nothing, and that comment is deleted under REQ-4.
- `src/media-roots/media-roots.service.ts:57` — the Article XI exception-3 guard doc comment.
  **Its prose survives**; only `(047-source-deletion REQ-10)` becomes `(Spec 047, REQ-10)`
  (REQ-1b). Three methods above it, `toHostPath()`'s Spanish comment is deleted: a getter that
  builds an error message is not a security guard. Do not extend exception 3 to a third method.
- `src/media-roots/media-roots.service.spec.ts:8` and
  `src/clients/torrent/magnet.spec.ts` — the two suites Article IX names as the standard. Their
  header paragraphs are **translated**, not deleted (Article XI exception 2), and they are the only
  comments in this slice where that is the right answer.
- `src/auth/test/auth-error-keys.spec.ts:213` and `src/languages/languages.service.spec.ts:360` —
  English headers quoting Spanish user-facing copy. **Leave them exactly as they are.** If
  `bin/comments` flags either one, the detector's quote-stripping is broken and that is an `infra`
  bug to report, not a comment to edit.
- `src/queue/process-queue.service.ts:13` — keep the BullMQ job-id constraint as a URL
  (Article XI exception 1) beside `// Spec 012, REQ-2`. Third-party behaviour with a public
  reference page keeps the reference.

## Steps

1. `bin/comments api`. Save the output; it is the worklist. Work file by file in descending
   finding count, committing nothing yourself — the orchestrator commits the slice as one commit
   (NFR-2).
2. For each finding, in this order: blame → confirm the requirement sentence → write
   `// Spec NNN, <ref>`; or, when blame or the spec text does not support a reference, **delete**.
   Deletion is the default, not the fallback.
3. Where a deleted comment described a failure that produces no error anywhere, write the test
   instead (see § Tests). Do not keep the comment as well.
4. REQ-12: rewrite the 34 Spanish `it(...)`/`describe(...)` strings in English, indicative mood,
   matching the house style `services/api/CLAUDE.md` § testing describes (`it('rejects a symlink
   pointing outside the root')`). Change only the string. The test count must not move.
5. REQ-13: fix the passage in `services/api/CLAUDE.md` that says both reference suites "still have
   Spanish `it(...)` strings predating Article VI" — after step 4 that is false. Keep the
   surrounding guidance about copying their structure.
6. Run the NFR-1 code-change guard from `../plan.md` § Verification over your own diff and account
   for every line it prints.
7. **Report the resolution table**: one row per replaced comment — `file:line`, the blame commit
   subject, the locator you wrote, and the first line of the requirement it points at. This table
   is how the orchestrator spot-checks the diff; a slice without it cannot be reviewed and will be
   sent back.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None**. You expose nothing new and consume nothing new.

The hard obligation is negative and it is absolute: **no production code changes.**
`git status --short services/api/prisma` stays empty, `git diff src/schema.gql` stays empty, and
`bin/npm api run test` reports the same test and suite counts as before — except for tests added
under step 3, which only ever increase the count and never change an existing assertion. If
removing a comment appears to require a code change, stop and report; it does not.

## Tests

Nothing in a comment sweep can fail silently *on its own* — a comment runs nothing. Tests are owed
only where step 3 fires: a deleted comment carried real knowledge about a failure that produces no
error anywhere, and the knowledge has to survive in executable form.

You cannot know which comments those are before reading them, so this list is a rule rather than a
set of paths: if the comment you are deleting explains why a line exists, and removing that line
would produce wrong behaviour with no exception, no log line and no failing assertion anywhere, the
deletion owes a test. Each such test opens with the Article IX header naming that failure.

Do **not** add a test for a comment that merely restated the code —
`src/auth/auth.service.ts`'s three are the archetype, and `expect(service).toBeDefined()` padding
is explicitly what Article IX tells you not to imitate.

## Done when

```bash
bin/comments api                      # 0
bin/cli api npx --no tsc --noEmit     # 0 errors
bin/npm api run test                  # same counts as before, plus any step-3 additions
git status --short services/api/prisma   # empty
git diff services/api/src/schema.gql     # empty
```

Plus the resolution table in your report, and the code-change guard accounted for.
