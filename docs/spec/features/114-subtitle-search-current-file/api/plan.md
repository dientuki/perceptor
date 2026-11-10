---
title: Subtitle search outcome follows the current file — api slice
service: api
last_updated: 2026-10-30
status: Approved         # Draft | Approved | Implemented
---

# PLAN: Subtitle search outcome follows the current file — `api` (`api/plan.md`)

## Scope

`api` derives each wanted language's outcome on `latestSubtitleSearch` against the title's current
`fileSubtitleLanguages` (REQ-1 to REQ-5). It also renames the enum value `EMBEDDED` → `RESOLVED` and
adds `MISSING`. It writes nothing: no migration, no row update, no new query. It does not touch how
`fileSubtitleLanguages` is filled (`108`'s `library-probe/`), the search driver, or any mutation's
behaviour. Rendering is `web`'s.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/subtitle-search/entities/subtitle-search.entity.ts` | Modified | `SubtitleSearchLanguageOutcome`: `EMBEDDED` → `RESOLVED`, add `MISSING` |
| `services/api/src/subtitle-search/derive-languages.ts` | Modified | third parameter `fileLanguages: string[] \| null`; REQ-1 override for terminal searches |
| `services/api/src/subtitle-search/subtitle-search.service.ts` | Modified | `latestForMovie`/`latestForEpisode`/`latest` accept and forward the file languages |
| `services/api/src/subtitle-search/subtitle-search.resolver.ts` | Modified | both field resolvers pass `@Parent()`'s `fileSubtitleLanguages` |
| `services/api/src/subtitle-search/derive-languages.spec.ts` | Modified | rename `EMBEDDED` expectations; new cases for REQ-1 to REQ-4 |
| `services/api/src/schema.gql` | Regenerated | enum change only. Never hand-edited (Article IV). |

## Existing code to reuse

- `services/api/src/subtitle-search/derive-languages.ts`: `deriveLanguages` stays the one
  derivation. The override wraps its existing per-language result. Don't fork it.
- `services/api/src/library-probe/library-probe.resolver.ts`: reads
  `parent.fileSubtitleLanguages` as `Array.isArray(value) ? value.map(String) : null`. Apply the same
  coercion to the parent value: a non-array, including `undefined` or Prisma's JSON null, becomes
  `null`. Don't import a private helper across modules. The coercion is one expression, or
  `derive-languages.ts`'s existing `asStrings` plus an `Array.isArray` guard.
- `derive-languages.ts`'s `asStrings`: already normalises `presentLanguages`. Reuse it for the
  file list once it is known to be an array.

## Steps

1. Entity: rename `EMBEDDED = 'EMBEDDED'` to `RESOLVED = 'RESOLVED'` and add `MISSING = 'MISSING'`,
   in the order the spec's SDL lists them.
2. `derive-languages.ts`: `deriveOne`'s accepted-and-`COMPLETED` branch returns `Outcome.RESOLVED`.
   Add the parameter `fileLanguages: string[] | null` to `deriveLanguages`, defaulting to `null` so
   existing callers keep today's behaviour (REQ-4). After computing each language's outcome, if the
   search is `COMPLETED`/`FAILED` and `fileLanguages` is non-null, apply REQ-1:
   - in file → `ALREADY_PRESENT` when the language is in `presentLanguages`, else `RESOLVED`;
     `reasonKey` `null`;
   - not in file and the outcome is `RESOLVED`/`ALREADY_PRESENT` → `MISSING`, `reasonKey` `null`;
   - otherwise unchanged.
   Put a `// Spec 114, REQ-1` locator on the override.
3. `subtitle-search.service.ts`: `latestForMovie(movieId, fileLanguages = null)` and the same for
   `latestForEpisode` and the private `latest`, which passes it to `deriveLanguages`.
4. `subtitle-search.resolver.ts`: both `latestSubtitleSearch` field resolvers pass
   `parent.fileSubtitleLanguages`, coerced as above. Type the parent loosely for that read, the way
   `library-probe.resolver.ts` does (`Record<string, unknown>`), or read it off the entity if it is
   declared there. The mutation paths (`searchMovieSubtitles`/`searchEpisodeSubtitles` via
   `latestOrFail`) are unchanged and pass nothing.
5. Tests, then boot `api` once so `schema.gql` regenerates, and commit the regenerated file.

## Contract obligations

Expose `SubtitleSearchLanguageOutcome` exactly as `../spec.md`'s SDL lists it: `EMBEDDED` gone,
`RESOLVED` and `MISSING` present. `reasonKey` stays `null` for both. No new errors. The read path
never throws for a missing or malformed `fileSubtitleLanguages`; it falls back to the search's own
outcome.

## Tests

`services/api/src/subtitle-search/derive-languages.spec.ts` is owed a test under Article IX. A wrong
branch here shows a wrong colour with no error anywhere, which is the bug this spec fixes. Extend
the existing suite and build each case from real rows, matching its current style:

- terminal search, language `REJECTED`, file holds it → `RESOLVED`, `reasonKey` null (AC-1);
- terminal search, language accepted, file holds it → `RESOLVED` (AC-2);
- terminal search, language accepted, file lacks it → `MISSING` (AC-3);
- language in `presentLanguages`, file lacks it → `MISSING`; file holds it → `ALREADY_PRESENT`;
- terminal search, `NOT_FOUND`/`REJECTED`/`FAILED`, file lacks it → unchanged with its reason
  (AC-4, AC-5);
- `fileLanguages` `null` → every outcome identical to today (AC-6);
- `SEARCHING` search, file holds a wanted language → `PENDING` (AC-8);
- `FAILED` search, file holds the language → `RESOLVED` (REQ-1 covers `FAILED` too).

The resolver and service changes are pass-through wiring with no branch of their own. They are not
owed a separate test. The live pass on film 73 covers the parent read.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
```

All four exit 0, and `git diff services/api/src/schema.gql` shows only the enum change.
