---
title: Optional compression — Tasks
last_updated: 2026-08-28
status: Draft
---

# TASKS: Optional compression (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]` task in this feature: nothing about the stack, the wrappers or `.env` changes — the
switch is a database row (`plan.md` § Migrations, NFR-4).

## Tasks

### Group 1 — the settings key and the contract

- [ ] **T001** `[api] [P]` Add `compression_enabled: { kind: 'boolean' }` to `SETTINGS_CATALOG`
      (`services/api/src/settings/settings.catalog.ts`, beside `movies_enabled`/`shows_enabled`) and
      `{ key: 'compression_enabled', value: 'true' }` to the array in
      `services/api/prisma/seeds/settings.ts`. Write no new validation — `updateMany`'s existing
      `kind === 'boolean'` branch already covers it — and do not touch the seed's create-only loop.
      *Done when:* after `bin/dbreset`,
      ``bin/mysql -e 'select `key`, value from Setting where `key`="compression_enabled"'`` prints
      `true`; and `updateSettings` called as an administrator with
      `{ key: "compression_enabled", value: "maybe" }` fails with `error.setting.expected_boolean`
      while that row keeps its previous value (AC-4).

- [ ] **T002** `[api] [P]` Add `compressionEnabled: boolean` as a non-null `@Field()` to
      `services/api/src/process-jobs/entities/encode-job-details.entity.ts`, and resolve it into the
      shared `base` object of `ProcessJobsService.getEncodeJobDetails`
      (`services/api/src/process-jobs/process-jobs.service.ts`) from the already-injected
      `SettingsService.getMap()`. REQ-7: anything other than the exact string `"false"` means
      compress, so a missing row resolves `true` — do not write it as `=== 'true'`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean, and after an `api` reboot
      `git diff services/api/src/schema.gql` shows `compressionEnabled: Boolean!` on
      `EncodeJobDetails` and nothing else — matching `spec.md` § GraphQL Contract Delta character for
      character (Article VIII's check).

- [ ] **T003** `[api]` Extend `services/api/src/process-jobs/process-jobs.service.spec.ts` with a
      `describe` for REQ-7, opening with the sentence naming the silent failure (a missing row read
      as "off" leaves an entire library un-transcoded with no error anywhere). Cases: no
      `compression_enabled` key → `true`; `"true"` → `true`; exactly `"false"` → `false`; a junk
      value → `true`; and the field present on **both** the movie and the episode branch. → T002
      *Done when:* `bin/npm api run test` is green and the new cases fail if the `=== 'false'`
      comparison is inverted.

- [ ] **T004** `[docs] [P]` Record the delta in `docs/spec/graphql-contract.md` (NFR-3): a new
      section for `032-optional-compression` carrying the `EncodeJobDetails.compressionEnabled`
      field, the new `compression_enabled` catalog key beside where `029` documents `ui_locale` and
      `default_languages`, and the worker-owned `error.encode.move_failed` key in the error-key
      table. State that no mutation signature changed and that `ffmpegCommand: ""` is the contract
      for a skipped job.
      *Done when:* the file describes exactly what `spec.md` froze, with no field, argument or error
      key that is not in the spec.

### Group 2 — consumers

Both chains depend on Group 1: `web` cannot save a key the server-side catalog rejects, and `worker`
cannot select a field the schema does not have (`fetchGraphQL` throws on `json.errors`). The `web`
chain and the `worker` chain are independent of each other and may run at the same time.

- [ ] **T005** `[web] [P]` Delete the inline comments from
      `services/web/src/components/form/switch/Switch.tsx` (Article XI — the file is untracked and
      is being committed for the first time as part of this feature). Change nothing else: not the
      props, not the markup, not the colour logic, and do not convert it to a controlled component.
      *Done when:* `bin/npm web run lint` is clean and `git diff` on that file shows only removed
      comment lines.

- [ ] **T006** `[web]` Wire the Compression tab: in
      `services/web/src/components/settings/CompressionPanel.tsx` take a `compressionEnabled: boolean`
      prop and seed the existing `enabled` state from it, replace `Checkbox` with `Switch`
      (`defaultChecked` + `onChange={setEnabled}`), add
      `<input type="hidden" name="compression_enabled" value={enabled ? "true" : "false"} />` beside
      it (the `CheckboxField.tsx` idiom), pass `disabled={!enabled}` to every `<Radio>`, grey the
      preset heading to match, and correct the file's header comment, which currently asserts this
      tab persists nothing. In `services/web/src/components/settings/SettingsForm.tsx` pass
      `compressionEnabled={getSettingValue("compression_enabled") === "true"}` — the panel stays
      mounted inside the main `<form>`, never conditionally rendered. → T005
      *Done when:* `bin/npm web run build` and `bin/npm web run lint` are clean, and at
      `/settings` → Compresión the control is a sliding switch whose off state makes the three preset
      radios unresponsive to a click and visibly disabled, re-enabled the moment it is switched on,
      with no save and no reload (AC-1).

- [ ] **T007** `[web]` Add `"compression_enabled"` to `BOOLEAN_KEYS` in
      `services/web/src/actions/settings.ts` so it is sent explicitly on every save of the main form,
      whichever tab the user was on. Leave `updateDefaultLanguagesAction` untouched — it exists
      precisely so it never writes the boolean keys. → T001, T006
      *Done when:* turning the switch off, saving and reloading leaves it off, with the `Setting` row
      reading `false` (AC-2); and a save performed from the General tab, without ever opening the
      Compression tab, leaves that row still `false` (AC-3).

- [ ] **T008** `[worker] [P]` Add `ERROR_ENCODE_MOVE_FAILED = 'error.encode.move_failed'` to
      `services/worker/src/i18n/error-keys.ts` and its rendering
      (`'Could not move the file to its destination: {detail}'`) to
      `services/worker/src/i18n/messages.en.ts`. The key string is hand-synced against the frozen
      contract and must match `spec.md` exactly.
      *Done when:* `bin/npm worker test` is green — the existing `messages.en.spec.ts` parity suite
      covers the new key in both directions.

- [ ] **T009** `[worker] [P]` Add the pure `services/worker/src/paths/with-source-extension.ts`
      (`withSourceExtension(outputPath, inputPath)`) plus its spec file, opening with the sentence
      naming the silent failure: a `.mp4` filed under a `.mkv` name is a mislabelled container that
      only the media server ever complains about. Replace the **last** extension only, leave folder
      and base name untouched, and leave the output's own extension alone when the input has none.
      `paths/build-output-path.ts` is not modified.
      *Done when:* `bin/npm worker test` is green, including
      `The Super Mario Bros. Movie (2023).mkv` + `.mp4` source → `The Super Mario Bros. Movie (2023).mp4`.

- [ ] **T010** `[worker]` Add `services/worker/src/encode/passthrough.ts` implementing `EncodeFn`
      unchanged (`onProbe` ignored — there is no probe): `mkdir` the destination folder, `rename` the
      input into place, fall back on `EXDEV` to copy → `.part` sibling → `chmod 0o664` → `rename` →
      unlink the source, `chmod 0o664` on the direct-rename path too, `await onProgress(100)` only
      once the file is at its final name, return `{ ffmpegCommand: '' }`, and turn every failure into
      a `KeyedError(ERROR_ENCODE_MOVE_FAILED, …, { detail })` after removing any `.part` left behind.
      **Do not register it in `src/encode/index.ts`'s `DRIVERS`** — it is not an `ENCODE_DRIVER`.
      Add `passthrough.spec.ts` against a real `mkdtemp` with real files. → T008, T009
      *Done when:* `bin/npm worker test` is green, including: the file lands with the right bytes and
      the source is gone; mode is `0664` even from a `0644` source; an unwritable destination throws
      `error.encode.move_failed`, leaves the source in place and leaves no final-named file and no
      `.part` behind; and a forced `EXDEV` rejection takes the copy path and unlinks the source only
      after the destination rename succeeded.

- [ ] **T011** `[worker]` Wire the branch in `services/worker/src/jobs/encode.job.ts`: add
      `compressionEnabled: boolean` to the local `EncodeJobDetails` type **and**
      `compressionEnabled` to the `processJob` query's selection set; inside the existing `try`,
      after `buildOutputPath`, branch on `details.compressionEnabled === false` (never on falsiness —
      NFR-2); in that branch check `isInsideRoot(details.downloadsRoot, details.inputFilePath)` first
      and throw `ERROR_ENCODE_MOVE_FAILED` naming the refusal if it fails, compute the destination
      with `withSourceExtension`, call `passthrough` with the same arguments `encode` receives, and
      report `encodeCompleted` with that path and `ffmpegCommand: ""`. Leave `encodeStarted`, the
      `catch`, and the cleanup block untouched, and make the existing `[encode] <id>:` log say which
      path the job took. → T002, T010
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is clean; live with the switch off, a job
      completes with no `[ffmpeg] ejecutando:` line, an `.mp4` source lands as
      `<library>/<Title> (<year>) [tmdbid=N]/<Title> (<year>).mp4` with the source gone and the
      torrent removed, and the `ProcessJob` row is `COMPLETED` / `progress=100` / empty
      `ffmpegCommand` (AC-5); a series source lands under `Season NN/<Title> SNNENN <Episode Title>.<ext>`
      (AC-6); `chmod 500` on the destination folder ends the job `FAILED` with
      `error.encode.move_failed`, source intact, no final-named file (AC-7); and with the switch back
      on the same job records an `ffmpegCommand` and produces `.mkv` (AC-8).

- [ ] **T012** `[worker]` Extend `services/worker/src/jobs/encode.job.spec.ts` (its `vi.mock`s are
      already in place) with a `describe` for the branch: `compressionEnabled: false` → `encode()`
      never called, the passthrough called, `encodeCompleted` carrying the swapped extension and
      `ffmpegCommand: ""`, `cleanupSource` still called with the same three instructions;
      `compressionEnabled: true` → today's path untouched; and the sharpest case — **the field absent
      → the job compresses** (NFR-2), the same skew guard `allowedLanguageTags` already has. → T011
      *Done when:* `bin/npm worker test` is green and the NFR-2 case fails if the branch is rewritten
      as `if (!details.compressionEnabled)`.

### Group 3 — verification and docs

- [ ] **T013** `[docs]` Update the `CLAUDE.md` files this feature falsifies. Root: the **Transcode**
      row of the pipeline table stops being unconditional, and the Environment bullet "**The
      transcode path is unconditional.**" needs a qualifier: its point — no host detection, the same
      `docker compose` invocation everywhere — still holds (NFR-4), but "nothing ... opted out of"
      is now only true *at install time*; an administrator can turn compression off at runtime from
      Settings. `services/api/CLAUDE.md`: the settings catalog's newest keys. `services/web/CLAUDE.md`:
      the Compression tab now persists one key. `services/worker/CLAUDE.md`: § "The encode driver
      seam" gains the passthrough — an `EncodeFn` selected by the job's `compressionEnabled`, not by
      `ENCODE_DRIVER`, and therefore winning over `mock` in dev. → T007, T012
      *Done when:* no sentence in any `CLAUDE.md` still asserts that compression always happens.

- [ ] **T014** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack, tick
      each box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`
      and `worker/plan.md`. Re-measure the test counts rather than citing the root `CLAUDE.md`'s.
      → T013
      *Done when:* AC-1 … AC-9 are all ticked from an observed run, and
      `bin/cli api npx --no tsc --noEmit`, `bin/npm api run test`,
      `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test`, `bin/npm web run lint`,
      `bin/npm web run build` and `bin/cli web node scripts/check-messages.mjs` all pass.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
