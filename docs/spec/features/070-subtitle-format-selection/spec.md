---
title: Subtitle Format Selection
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-25
last_updated: 2026-09-25
status: Approved
services: [api, web, worker]
---

# SPEC: Subtitle Format Selection (`spec.md`)

## Context & Goal

Which subtitle *formats* survive an encode is hard-coded today. `getSubtitleParams`
(`services/worker/src/ffmpeg/params.ts`) keeps a subtitle stream only when its ffprobe `codec_name`
is one of `subrip`, `mov_text` or `tx3g` (`TEXT_SUBTITLE_CODECS`), and re-encodes every survivor to
SRT. Everything else is silently dropped: ASS/SSA tracks (common on anime releases), WebVTT, and
every image-based format — PGS on Blu-ray remuxes, VobSub on DVD rips, DVB. A release whose only
Spanish subtitle is a PGS track comes out of the pipeline with no subtitles at all, and nothing in
the UI says why or lets anyone change it. The language rules around that filter (the per-title
allow-list from `039`/`042`, the cue-payload floor, the SDH preference, the regional-variant
narrowing) are not the problem and stay as they are.

This feature moves the format decision into Settings → Compression
(`services/web/src/components/settings/CompressionPanel.tsx`), beside the resolution ceiling from
`058`. It is installation-wide, like every other compression setting: one choice applies to every
title of every user, not a per-user preference. The administrator chooses one of: no subtitles at
all; and/or allow text subtitles, choosing which text formats; and/or allow image subtitles,
choosing which image formats. The two groups combine — both may be allowed at once — and "no
subtitles" locks both. The choice is stored as Settings rows owned by `api`, resolved into one
effective format list on `EncodeJobDetails` at query time (the same timing `compressionEnabled`
and `compressionResolution` use), and read by the worker's subtitle rule.

Text subtitles keep being normalised to SRT on output — ASS styling is deliberately flattened, the
same trade-off the pipeline already makes for `mov_text`. Image subtitles cannot become text, so
they are stream-copied into the MKV untouched. When both groups are allowed, image is a fallback:
a language keeps its image track only if no text track in that language survived the rules. The
Transcode stage in the root `CLAUDE.md` changes (its subtitle rule becomes setting-driven); no
stage is added or removed.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Format catalog)**: The selectable formats are a fixed catalog of two groups, each
      entry a stable id mapped to one or more ffprobe `codec_name` values:

      | Group | Id | Label | ffprobe `codec_name` |
      | :-- | :-- | :-- | :-- |
      | text | `srt` | SRT | `subrip` |
      | text | `ass` | ASS / SSA | `ass`, `ssa` |
      | text | `webvtt` | WebVTT | `webvtt` |
      | text | `mov_text` | MP4 text | `mov_text`, `tx3g` |
      | image | `pgs` | PGS (Blu-ray) | `hdmv_pgs_subtitle` |
      | image | `vobsub` | VobSub (DVD) | `dvd_subtitle` |
      | image | `dvb` | DVB | `dvb_subtitle` |

      A subtitle stream whose codec is in no entry (closed captions such as `eia_608`,
      `arib_caption`, anything unrecognised) is never selected, whatever the settings say — as today.
- [ ] **REQ-2 (Settings screen)**: Settings → Compression must show, below the resolution radios, a
      subtitles section with: a "no subtitles" control; a "allow text subtitles" control followed by
      one checkbox per text format; an "allow image subtitles" control followed by one checkbox per
      image format. The labels are the ones in REQ-1's table (format names are not translated; the
      section and group labels are, in `en` and `es`).
- [ ] **REQ-3 (Locking)**: While "no subtitles" is on, both group controls and every format
      checkbox are disabled. While a group's "allow" control is off, that group's format checkboxes
      are disabled. While the Compression switch (`compression_enabled`) is off, the whole subtitles
      section is disabled, the same way the resolution radios already are.
- [ ] **REQ-4 (Disabled values are kept)**: Disabling a control never clears what is under it.
      Turning "no subtitles" on and saving, then off again, shows exactly the groups and formats that
      were selected before; the same holds for a group's formats across that group's toggle.
- [ ] **REQ-5 (Persistence)**: The whole section persists through the Settings form's existing Save
      button, as five installation-wide settings:

      | Key | Kind | Meaning |
      | :-- | :-- | :-- |
      | `subtitles_enabled` | boolean | `false` = "no subtitles" |
      | `subtitles_text_enabled` | boolean | text group allowed |
      | `subtitles_text_formats` | list of text ids | text formats checked |
      | `subtitles_image_enabled` | boolean | image group allowed |
      | `subtitles_image_formats` | list of image ids | image formats checked |

      A list is stored as the ids joined by commas, in catalog order, no duplicates. **An empty
      selection must persist** — unchecking every format of a group and saving stores an empty list,
      it is not skipped as a blank value.
- [ ] **REQ-6 (Validation)**: `updateSettings` must refuse a format list containing any id outside
      its own group's catalog — an image id in `subtitles_text_formats`, an unknown id, or anything
      else — and must refuse a non-boolean value for the three boolean keys (existing rule). A
      refused save writes none of its entries (existing all-or-nothing behaviour of
      `updateSettings`).
- [ ] **REQ-7 (Effective list, resolved at query time)**: `api` must expose to the worker one
      effective list of allowed format ids, computed when the worker asks for the job's details (not
      when the job was enqueued): empty when `subtitles_enabled` is `false`; otherwise the text
      formats if `subtitles_text_enabled`, plus the image formats if `subtitles_image_enabled`. A
      group allowed with no formats checked, or both groups off, yields an empty list — equivalent
      to "no subtitles", not an error.
- [ ] **REQ-8 (Selection)**: The worker must select a subtitle stream only when its codec maps to a
      format id in the effective list. Every existing rule still applies, unchanged, to both groups:
      the per-title subtitle language allow-list, the cue-payload floor, the SDH preference and the
      regional-variant narrowing.
- [ ] **REQ-9 (Text before image)**: For each allowed language, if at least one text stream in that
      language survives REQ-8, no image stream in that language is kept. Image streams of a language
      are kept only when no text stream of that language survived. Each group, on its own, keeps
      every stream that survives the rules, as today.
- [ ] **REQ-10 (Output format)**: A selected text stream is always written as SRT (ASS styling and
      positioning are flattened). A selected image stream is always stream-copied, never converted.
      Every selected stream carries the same track title and language metadata the text rule writes
      today (the `051` track-title resolver).
- [ ] **REQ-11 (No subtitles)**: An empty effective list produces an output with no subtitle track;
      the encode succeeds and the worker logs that subtitles were disabled by settings (distinct from
      today's "no subtitle survived the rules" line).
- [ ] **REQ-12 (Compression off)**: With `compression_enabled` false the file is moved untouched
      (`032`), every subtitle track included; these settings have no effect on that path.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Defaults and upgrade)**: A fresh install, and an existing install on upgrade, get
      `subtitles_enabled=true`, `subtitles_text_enabled=true`,
      `subtitles_text_formats=srt,ass,webvtt,mov_text`, `subtitles_image_enabled=false`,
      `subtitles_image_formats=pgs,vobsub,dvb` (image formats pre-checked, group off). The seed stays
      create-only — it never overwrites a value an administrator already saved, **including an
      empty format list**: the seed's "backfill a row that is still empty" rule must not apply to
      `subtitles_text_formats`/`subtitles_image_formats`, or an administrator's deliberate empty
      selection is silently re-filled on the next `api` boot. This is a deliberate
      behaviour change on upgrade: ASS and WebVTT tracks, dropped until now, start being kept
      (as SRT).
- [ ] **NFR-2 (Missing or corrupt rows)**: `api` must resolve a missing row to its NFR-1 default and
      silently drop any id in a stored list that is not in that list's group (only reachable by
      editing the database by hand) — never fail the `processJob` query over a setting.
- [ ] **NFR-3 (Wire skew)**: The worker trusts nothing it reads off the wire, same posture as
      `contentKind`/`compressionResolution`: an absent or `null` list defaults to the NFR-1 text
      formats and logs a warning; an unknown id in the list is ignored and logged. Neither ever fails
      an encode.
- [ ] **NFR-4 (No migration)**: Settings are key/value rows; no Prisma model changes and no
      migration.
- [ ] **NFR-5 (Recovery and retries)**: A job requeued by `054`'s crash recovery or a BullMQ retry
      encodes with the settings current at the moment it re-reads its details.
- [ ] **NFR-6 (i18n)**: Every new user-facing string exists in both `services/web/messages/en.json`
      and `es.json`; `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [ ] **NFR-7 (Tests)**: The format mapping and the text-before-image rule in the worker, and the
      effective-list resolution in `api`, are covered — a wrong answer in either silently files a
      library with the wrong (or no) subtitles and no error anywhere (Article IX).

## GraphQL Contract Delta

```graphql
type EncodeJobDetails {
  allowedSubtitleFormats: [String!]!
}
```

The subtitle format ids the worker may keep, from REQ-1's catalog (`srt`, `ass`, `webvtt`,
`mov_text`, `pgs`, `vobsub`, `dvb`); empty means no subtitles. No GraphQL description on the field —
its siblings `compressionEnabled`/`compressionResolution` carry none (Article XI).

One field on an existing type. `Setting`, `settings` and `updateSettings(entries: [SettingInput!]!)`
are unchanged in shape — the five new keys ride them as plain key/value strings, and
`updateSettings` gains the validation in REQ-6.

**Deliberately `[String!]!`, not a list of a GraphQL enum**, for the reason `058` gives for
`compressionResolution`: an enum would turn a hand-edited bad row into a serialization error on the
whole `processJob` query. `api` normalises (NFR-2) and the worker normalises again (NFR-3). The list
is already the *effective* one — the worker never sees the five raw settings and never re-derives
"no subtitles" or group toggles itself. Order carries no meaning.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `updateSettings` with a `subtitles_text_formats`/`subtitles_image_formats` value containing an id outside that group's catalog | `BadRequestException`, new key `error.setting.expected_enum_list`, params `{ key, options }` | es: `El valor de {key} sólo puede contener: {options}` / en: `{key} may only contain: {options}` |
| `updateSettings` with a non-boolean `subtitles_enabled`/`subtitles_text_enabled`/`subtitles_image_enabled` (existing rule) | `BadRequestException`, `error.setting.expected_boolean` | existing copy |
| Any of the five rows missing, or a stored list holding an unknown id | none — NFR-2 defaults / drops | — |
| `allowedSubtitleFormats` absent, `null`, or holding an unknown id on the worker side | none — NFR-3 default / ignore, logged | — |

Consumer obligations:

- `worker` retypes `allowedSubtitleFormats` into its local `EncodeJobDetails` type, adds it to the
  `processJob` selection set, and carries the normalised value into the subtitle rule. It never
  calls `updateSettings` or reads `settings`.
- `web` reads and writes the five keys through the existing `settings`/`updateSettings`, never
  selects `EncodeJobDetails.allowedSubtitleFormats`, and surfaces `error.setting.expected_enum_list`
  through `translateGraphQLError` with its params (only reachable if the form and the catalog
  drift — the UI offers no way to send an invalid id). An empty list must be sent, not filtered out
  (REQ-5).
- `docs/spec/graphql-contract.md` gains a section for this field, like `058`'s.

## Data Model Changes

None — no Prisma model or enum changes (NFR-4). Five new `Setting` rows, seeded create-only:

| Setting key | Default | Backfill needed? |
| :-- | :-- | :-- |
| `subtitles_enabled` | `true` | Seed creates it on upgrade (NFR-1) |
| `subtitles_text_enabled` | `true` | Seed creates it on upgrade |
| `subtitles_text_formats` | `srt,ass,webvtt,mov_text` | Seed creates it on upgrade |
| `subtitles_image_enabled` | `false` | Seed creates it on upgrade |
| `subtitles_image_formats` | `pgs,vobsub,dvb` | Seed creates it on upgrade |

## Acceptance Criteria

- [ ] **AC-1**: On a fresh `bin/dbreset`, `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'subtitles_%'"`
      returns exactly the five NFR-1 rows and values.
- [ ] **AC-2**: In Settings → Compression, turning "no subtitles" on disables both groups and all
      seven checkboxes; turning it off and unchecking "allow image subtitles" leaves the three image
      checkboxes disabled but still showing their previous state. After Save and a reload the screen
      shows exactly what was saved.
- [ ] **AC-3**: Unchecking every text format with the text group still allowed, then saving, stores
      `subtitles_text_formats` as an empty string (checked with `bin/mysql`); after
      `docker compose restart api` (which re-runs the seed) the row is still empty, and a subsequent
      encode has no text subtitle track.
- [ ] **AC-4 (failure)**: Calling `updateSettings(entries: [{ key: "subtitles_text_formats", value: "srt,pgs" }])`
      directly against the api returns a `BadRequestException` with `extensions.i18n.key` =
      `error.setting.expected_enum_list` and params naming the key and `srt, ass, webvtt, mov_text`;
      the stored row is unchanged. The same call with `value: "srt,foo"` fails the same way.
- [ ] **AC-5 (failure)**: With `subtitles_image_formats` hand-edited to `pgs,garbage` via
      `bin/mysql`, the worker's `processJob` query succeeds and `allowedSubtitleFormats` contains
      `pgs` (if the image group is allowed) and never `garbage`.
- [ ] **AC-6**: With defaults, encoding a source that carries an allowed-language ASS track and an
      allowed-language PGS track produces an MKV whose `ffprobe` shows one `subrip` stream (from the
      ASS) and no `hdmv_pgs_subtitle` stream.
- [ ] **AC-7**: With both groups allowed (all formats), a source with Spanish SRT + Spanish PGS +
      English PGS (both languages allowed for the title) produces the Spanish `subrip` stream and the
      English `hdmv_pgs_subtitle` stream copied — the Spanish PGS is dropped (REQ-9).
- [ ] **AC-8**: With only the image group allowed and `pgs` checked, a source whose only
      allowed-language subtitle is PGS produces an MKV with that PGS stream copied, carrying the same
      track title a text track of that language would get.
- [ ] **AC-9**: With "no subtitles" on, any encode produces an MKV with no subtitle stream, the job
      reaches `COMPLETED`, and the worker log contains the "disabled by settings" line.
- [ ] **AC-10**: A job enqueued with defaults, then picked up after an administrator switched to
      "no subtitles", comes out with no subtitle stream (REQ-7 query-time resolution).
- [ ] **AC-11**: `bin/npm api run test` and `bin/npm worker test` pass apart from the pre-existing
      `src/ffmpeg/` failures recorded in the root `CLAUDE.md`; `bin/cli web node scripts/check-messages.mjs`
      reports no `en`/`es` drift.

## Out of Scope

- **Keeping ASS in its native format.** Chosen explicitly: text is always SRT. Typeset ASS (anime
  signs, karaoke) flattens into plain lines that can overlap dialogue; restoring styling would mean
  a per-format output choice, a separate feature.
- **Converting image subtitles to text (OCR).** Image tracks are copied or dropped, never converted.
- **Per-user or per-title subtitle format preferences.** Installation-wide only, like the rest of
  the Compression tab. The per-title/per-user *language* preferences (`021`, `039`, `042`) are
  untouched.
- **Forced / signs-only track handling.** The cue-payload floor keeps discarding small tracks,
  image ones included; a forced-subtitle rule is its own feature.
- **Closed captions embedded in the video stream** (`eia_608`/`cea_708`) and any codec outside
  REQ-1's catalog.
- **Re-processing titles already in the library.** A setting change applies to encodes from then
  on; nothing already filed is touched (Article XII).
- **Exposing the catalog over GraphQL.** `web` carries the seven ids as a local list, the way it
  already carries the five resolutions (`058`); adding a format is a three-service change by design.
