---
title: Subtitle search outcome follows the current file — Tasks
last_updated: 2026-10-30
status: Done             # Draft | In Progress | Done
---

# TASKS: Subtitle search outcome follows the current file (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. A task that needs two services is two tasks. |
| `[docs]` | Documentation and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. When they do not, run each *Done when* command through
the throwaway container described in memory (`measuring-without-dev-stack`):

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Report which form was used.

## Tasks

### Group 1 — contract producer and consumer

The delta is three enum strings, frozen in `spec.md`, so the `api` and `web` slices touch no shared
file and can run together. T004 depends only on the frozen spec, not on T001 to T003.

- [x] **T001** `[api] [P]` In `src/subtitle-search/entities/subtitle-search.entity.ts`, rename
      `SubtitleSearchLanguageOutcome.EMBEDDED` to `RESOLVED` and add `MISSING`, in the spec's SDL
      order. In `src/subtitle-search/derive-languages.ts`, `deriveOne`'s accepted-and-`COMPLETED`
      branch returns `RESOLVED`. Update the existing `EMBEDDED` expectations in
      `derive-languages.spec.ts`. (REQ-2)
      *Done when:* `grep -rn "EMBEDDED" services/api/src` matches only `SubtitleSearchStatus.EMBEDDING`
      uses, `bin/cli api npx --no tsc --noEmit` exits 0, and `bin/npm api test -- derive-languages`
      passes.
- [x] **T002** `[api]` In `derive-languages.ts`, add the parameter `fileLanguages: string[] | null`
      (default `null`) to `deriveLanguages` and apply `api/plan.md` step 2's REQ-1 override for
      `COMPLETED`/`FAILED` searches, with a `// Spec 114, REQ-1` locator. Extend
      `derive-languages.spec.ts` with every case `api/plan.md` § Tests lists. (REQ-1, REQ-3, REQ-4,
      AC-3, AC-5, AC-6, AC-8, AC-10) → T001
      *Done when:* `bin/npm api test -- derive-languages` passes, with at least one new case each for
      `RESOLVED` from `REJECTED`, `MISSING` from `RESOLVED`, `MISSING` from `ALREADY_PRESENT`,
      unchanged `NOT_FOUND` with the file lacking the language, `null` file languages, a
      `SEARCHING` search, and a `FAILED` search.
- [x] **T003** `[api]` Thread the file languages through:
      - `subtitle-search.service.ts`: `latestForMovie`/`latestForEpisode`/`latest` take an optional
        `fileLanguages` and forward it;
      - `subtitle-search.resolver.ts`: both `latestSubtitleSearch` field resolvers pass the
        `@Parent()` row's `fileSubtitleLanguages`, coerced to `string[] | null`
        (`Array.isArray(value) ? value.map(String) : null`).
      The mutation paths stay unchanged. Boot `api` once so `schema.gql` regenerates. (REQ-5,
      NFR-2, NFR-3) → T002
      *Done when:*
      - `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`, `bin/npm api run lint` and
        `bin/comments api` all exit 0;
      - `git diff services/api/src/schema.gql` shows only the enum's `EMBEDDED` → `RESOLVED` and
        the added `MISSING`.
- [x] **T004** `[web] [P]` Make three changes:
      - `src/types/media.ts`: the union `"EMBEDDED"` → `"RESOLVED"`, add `"MISSING"`;
      - `src/components/media/SubtitleSearchStatus.tsx`: in `OUTCOME_TEXT_CLASS`, `RESOLVED` is
        `text-green-500` and `MISSING` is `text-error-500`;
      - `messages/es.json` and `messages/en.json`, under `media.subtitleSearch.outcome`: drop
        `EMBEDDED`, add `RESOLVED` ("Resuelto"/"Resolved") and `MISSING` ("Falta en el
        archivo"/"Missing from file").
      (REQ-6)
      *Done when:*
      - `bin/cli web npx --no tsc --noEmit`, `bin/npm web run lint`,
        `bin/cli web node scripts/check-messages.mjs` and `bin/comments web` all exit 0;
      - `grep -rn '"EMBEDDED"' services/web/src services/web/messages` matches nothing.

### Group 2 — verification and docs

- [x] **T005** `[docs]` In `docs/spec/graphql-contract.md`:
      - add a `114-subtitle-search-current-file` section with the new enum, the `reasonKey`-null
        rule for `RESOLVED`/`MISSING`, and the rule that the outcome follows `fileSubtitleLanguages`
        once the search is terminal;
      - add a "Superseded by `114`" note on `103`'s `SubtitleSearchLanguageOutcome` line.
      → T003
      *Done when:* `grep -n "114" docs/spec/graphql-contract.md` shows the new section and the note.
- [x] **T006** `[docs]` Update the root `CLAUDE.md` "Notify media server" row with a "Since `114`"
      sentence: the per-language outcome follows the current file's `fileSubtitleLanguages` once a
      search ends, with `RESOLVED` replacing `EMBEDDED` and a new `MISSING`. Add `114` to that row's
      spec list. Update `services/api/CLAUDE.md`'s `subtitle-search/` entry if it describes
      `deriveLanguages`' inputs. Append a `docs/spec/history.md` entry with the re-measured counts.
      → T003, T004
      *Done when:* `grep -n "114" CLAUDE.md docs/spec/history.md` matches both files.
- [~] **T007** `[docs]` Manual pass on an install running this build (`plan.md` § Verification):
      - film 73 reads "Español: Resuelto" in green (AC-1);
      - a search-embedded language reads "Resuelto" (AC-2);
      - an episode with a manual embed reads "Resuelto" (AC-7);
      - a `NOT_FOUND` language with no file track is unchanged (AC-4);
      - `subtitle_searches`/`subtitle_search_attempts` rows for movie 73 are identical before and
        after the page loads (AC-9).
      Tick AC-3, AC-5, AC-6, AC-8 and AC-10 from T002's tests and say so in `pending-acs`.
      → T003, T004
      *Done when:* each AC in `spec.md` is `[x]`, or `[~]` with the blocker named in
      `docs/spec/pending-acs.md`.
- [x] **T008** `[docs]` Set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`, set `status: Done` here, and run `/pending-acs`. → T005, T006, T007
      *Done when:* `grep -n "^status" docs/spec/features/114-*/**/*.md docs/spec/features/114-*/*.md`
      shows `Implemented`/`Done` everywhere, and `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T007 | docs | Needs an install running this build and film 73 | The maintainer runs the manual pass |
