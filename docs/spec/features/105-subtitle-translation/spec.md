---
title: Subtitle Translation and Adaptation
spec_version: 0.4.0
author: Juan "Dientuki" Farias
created_at: 2026-10-25
last_updated: 2026-10-29
status: Approved
services: [api, worker, web]
---

# SPEC: Subtitle Translation and Adaptation (`spec.md`)

## Context & Goal

`101-jellyfin-subtitle-embed` lets an administrator embed sidecar subtitles, and
`103-subtitle-search`/`107-opensubtitles-direct` fetch a missing language from OpenSubtitles. Both
stop when no subtitle in the wanted language exists anywhere. A release often carries an English
track and nothing in Spanish, or a Castilian (`es-ES`) track where the household wants Latin
American Spanish (`es-419`). Today the only way out is translating the file by hand outside
Perceptor.

This spec lets an owner of a film or episode produce that subtitle with an LLM. From the film's
detail page, or an episode's row in the season accordion, a button opens a modal. The owner picks
one **source** subtitle embedded in the library file (a text track; sidecars are never a source)
and one **target** language. When the target is a different language the
operation is a **translation** (English → Castilian Spanish); when it is the same base language in
another variant it is an **adaptation** (`es-ES` → `es-419`). Each operation uses its own prompt.
The output is always an SRT with the source's cues and timings, written next to the library file
with the sidecar naming Jellyfin and Plex read, after which the configured media server, if any, is
told the file changed (`107` REQ-10's posture). Embedding the result into the `.mkv` stays manual,
through `101`'s existing "Incrustar en archivo" button, because a machine translation can be wrong
and the user should watch it first.

Nothing here depends on a particular media server. The source list comes from `108`'s library read
(`library-probe`), which this spec extends to report each embedded subtitle track individually, not
only its language. The library file's path is resolved exactly as `107` REQ-4 / `108` REQ-2
resolve it: the title's `filePath`, else the path the configured media server reports.

The LLM is reached through a small set of provider clients in `api`
(`services/api/src/clients/llm/`), next to the TMDB, indexer, torrent and media-server clients. An
administrator configures **providers** (a fixed kind: Gemini, OpenRouter, OpenAI, an
OpenAI-compatible server, or Ollama; its API key and base URL) and, under each, any number of
**models** as free strings, since model names change constantly. Users only see and use the models
an administrator enabled; they never see a key. Translation is slow (minutes for a feature film), so
it runs in the background: the user can leave the page and find the button in its true state when
they come back.

Pipeline stages touched:

- **Notify media server:** reuses `107` REQ-10's notification (Jellyfin `modifiedMedia`, Plex
  path-scoped scan, nothing with no media server) and `107` REQ-4's path resolution; no new
  media-server call.
- **Transcode** (`worker`): `108`'s `library-probe` reports per-track subtitle detail; two new small
  jobs, one that stages the source subtitle as UTF-8 SRT in the downloads root and one that writes
  the result beside the library file. None is part of an encode.
- **Browse library:** the button and modal on both detail pages, and a new Settings tab for
  providers and models.

No title `status` ever changes because of a translation, and nothing is ever removed from the
library (Article XII).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Provider kinds)**: A provider has one of five kinds. Each kind fixes which fields the
      administrator fills in:

      | Kind | Label in `web` | Base URL | API key |
      | :-- | :-- | :-- | :-- |
      | `GEMINI` | Google Gemini | fixed, not shown | required |
      | `OPENROUTER` | OpenRouter | fixed, not shown | required |
      | `OPENAI` | OpenAI | fixed, not shown | required |
      | `OPENAI_COMPATIBLE` | OpenAI-compatible (LM Studio, vLLM, llama.cpp, …) | required | optional |
      | `OLLAMA` | Ollama | required | not shown |

      `OPENAI` is the official service; `OPENAI_COMPATIBLE` is any local or hosted server speaking the
      same chat-completions protocol at the base URL the administrator gives. A base URL must be an
      `http` or `https` URL. A provider also has an administrator-chosen display name (unique) and an
      enabled flag.
- [ ] **REQ-2 (Models)**: Under each provider an administrator adds any number of models. A model is
      the exact identifier the provider expects (`gemini-2.5-flash`, `anthropic/claude-…`,
      `llama3.1:8b`), a free non-empty string unique within its provider, plus an optional display
      label and an enabled flag. Perceptor never validates a model name against the provider's
      catalogue except through REQ-4's test.
- [ ] **REQ-3 (Administration)**: Only an administrator can list, create, edit, enable, disable or
      delete providers and models, in a new Settings tab. Deleting a provider deletes its models.
      Deleting or disabling a model or provider never affects a translation already finished, and
      one in flight fails at its next provider call with `error.subtitleTranslation.model_unavailable`.
- [ ] **REQ-4 (Test a model)**: Each model row in Settings has a "Probar" action. It translates a
      fixed two-cue English SRT into Spanish through REQ-8's whole path (prompt, call, parse,
      validation), synchronously, bounded by REQ-9's per-call timeout. It answers with success and
      the elapsed time, or with one of the provider error keys. It writes nothing and stores nothing.
- [ ] **REQ-5 (Secrets)**: An API key is write-only across the GraphQL boundary. It is never
      returned, to any role; an administrator sees only whether one is set. Editing a provider with
      no key value keeps the stored key; an explicit empty value clears it. Keys never appear in a
      log line, an error message or a stored error key.
- [ ] **REQ-6 (Availability)**: Translation is available while at least one enabled model under an
      enabled provider exists, whatever the media server (none, Jellyfin or Plex). `api` exposes this
      to every user as `MediaCapabilities.subtitleTranslationAvailable`, and the enabled models
      (display name, provider display name and kind, never a key or URL) as `translationModels`.
      While it is false, `web` hides the button. While it is true, the button shows on a film, and on
      an episode row, that holds a library file (`filePath` or `mediaServerPresentAt`, `108` REQ-2).
- [ ] **REQ-7 (Request)**: Any owner of a film, or of an episode's series, can request a translation
      of that film or episode. The modal lists:
      - **sources**: the title's translatable subtitles as recorded by its latest library read
        (REQ-17): every embedded track that is not forced and whose codec is SRT, ASS/SSA, WebVTT or
        mov_text. Image tracks and sidecars are never offered. Each shows its language and its
        title. A title never read yet shows no sources and the line
        `Todavía no se leyó el archivo; probá en un momento.`;
      - **target**: one language from the `Language` table, by tag (`es`, `es-419`, `es-ES`, `en`, …);
      - **model**: one of `translationModels`.

      The mode is derived, never chosen: when the source's and the target's ISO 639-2 codes differ
      it is `TRANSLATE`; when they are equal it is `ADAPT`. The modal shows which one will run
      ("Traducir" / "Adaptar") before the user confirms. A source whose language does not resolve
      (an untagged or `und` track) is
      listed but cannot be picked (`error.subtitleTranslation.source_language_unknown`). The library
      path is resolved at request time as `107` REQ-4 resolves it and stored on the translation; no
      path refuses the request with `error.subtitleTranslation.no_library_path`, an unreachable
      media server with `error.subtitleTranslation.media_server_unavailable`.
- [ ] **REQ-8 (Translation contract)**: The source is parsed as SRT into cues. Cues are sent to the
      model in consecutive batches, each with the mode's prompt (REQ-12), the source language and the
      target language tag. A batch's answer must parse as SRT with exactly the same number of cues
      and the same cue numbers as the batch sent. The output keeps every source cue's number and
      timing verbatim; only text comes from the model. A cue whose answered text is empty keeps an
      empty line, it is never dropped. A batch whose answer fails this check is retried; when the
      retries are exhausted the whole translation fails with
      `error.subtitleTranslation.invalid_response`. The batch size and the retry count are each a
      single constant in `api`, **provisional** until measured on a feature-length subtitle with at
      least two providers, and recorded with that measurement in `docs/spec/history.md`'s entry for
      this spec.
- [ ] **REQ-9 (Provider failures)**: Each provider call has a timeout. A provider answer is mapped to
      exactly one key:

      | Cause | Key | Retried? |
      | :-- | :-- | :-- |
      | 401/403, or a missing required key | `error.subtitleTranslation.provider_unauthorized` | no |
      | the model is unknown to the provider (404 or the provider's equivalent) | `error.subtitleTranslation.model_not_found` | no |
      | 429, or the provider's quota/rate-limit equivalent | `error.subtitleTranslation.provider_rate_limited` | yes, with backoff |
      | network error, timeout, 5xx | `error.subtitleTranslation.provider_unavailable` | yes, with backoff |
      | the answer was refused or truncated by the provider (safety block, length limit) | `error.subtitleTranslation.provider_refused` | no |

      A retried cause that is still failing after the retries ends the translation with its key. The
      timeout and retry budget are single constants in `api`, provisional like REQ-8's.
- [ ] **REQ-10 (Lifecycle)**: A translation moves through `QUEUED` → `EXTRACTING` (the worker
      stages the source) → `TRANSLATING` → `WRITING` (the worker writes the result) → `COMPLETED`, or
      to `FAILED` with an error key from any of them. While `TRANSLATING` it reports how many cues are
      done out of the total. The record outlives the page: a user who leaves and comes back sees the
      button in its current state. At most one translation of a given film or episode is in flight;
      a second request is refused with `error.subtitleTranslation.busy`. Translations run one at a
      time installation-wide, in request order. There is no cancel (see Out of Scope).
- [ ] **REQ-11 (Source staging)**: The worker writes the selected source into a staging file under
      the downloads root as UTF-8 SRT: the embedded text track is extracted from the library file
      (ASS/SSA styling flattened, as `070` does). Before extracting, the worker checks the track is
      still what the request named: a text subtitle track at that ordinal with that language. Any
      difference fails with `error.subtitleTranslation.source_mismatch`,
      never a translation of the wrong track. `api`
      deletes the staging files of a translation once it is terminal, either way.
- [ ] **REQ-12 (Prompts)**: There is exactly one prompt per mode, `TRANSLATE` and `ADAPT`, each a
      single constant in `api` that receives the source language, the target language tag and the
      batch. **The text of both prompts is out of scope** (see Out of Scope): this spec ships a
      minimal working placeholder for each, and replacing it later changes one constant and no
      contract.
- [ ] **REQ-13 (Output file)**: The worker writes the result beside the library file, in the same
      folder, as `<base>[.<title>].<language>.srt`, where `<base>` is the library file's name without
      extension. It writes a scratch `.part` file first and renames it into place. It never
      overwrites a file: when the name is taken it appends the `.N` counter (`.2`, `.3`, …) before
      `.srt`. When the library file is no longer at the stored path, nothing is written and the
      translation fails with `error.subtitleTranslation.file_gone`.

      The name follows Jellyfin's external-subtitle convention, which Plex also reads for the
      language. `<language>` is the target's ISO 639-2 code (`spa`, `eng`). `<title>` is present only
      for a regional variant, and is that variant's track title from `051` (`Latino` for `es-419`,
      `Español (España)` for `es-ES`), since both variants share `spa`. A base language has no title
      segment (`<base>.spa.srt`). The plan verifies this form against an installed Jellyfin and Plex
      (language and title as each lists them) before the worker task is written.
- [ ] **REQ-14 (Notify)**: After a successful write `api` tells the configured media server the file
      changed exactly as `107` REQ-10 does after an embed: Jellyfin's `modifiedMedia`, Plex's
      path-scoped scan, nothing with no media server. A failed notification does not fail the
      translation: it completes, and the record carries `error.subtitleTranslation.notify_failed` as
      a warning, shown next to the result. With no media server there is nothing to notify and no
      warning. In every case `api` also queues a `108` library read of the title, so the new sidecar's
      language appears in the subtitle box.
- [ ] **REQ-15 (Readable on the title)**: Every owner of the film (the series, for an episode) can
      read its latest translation on it: status, mode, source description, target tag, model display
      name, cues done and total, error key, warning key, output file name (base name only) and
      timestamps. `web` shows it on the button and in the modal. A translation never appears in
      `/downloads` or `activeDownloadCount`.
- [ ] **REQ-16 (Live state on the page)**: While the latest translation of the film or episode on
      screen is not terminal, `web` re-reads only that translation every few seconds and updates the
      button and the open modal; it stops at the first terminal status, when the user leaves the page,
      and never runs while nothing is in flight. No WebSocket, subscription or Server-Sent Events
      transport is added. The interval is a single constant in `web`. Leaving and returning shows the
      current state from the page load alone.
- [ ] **REQ-17 (Per-track library read, extends `108`)**: `108`'s library read also reports, for the
      file it read, every embedded subtitle track individually: its subtitle-relative ordinal
      (`0:s:N`), codec, ISO 639-2 language (normalized as `108` REQ-1, null when untagged or `und`),
      title and forced flag.

      `api` stores the translatable ones (REQ-7's codec rule, forced left out) on the
      film or episode, replacing them on every completed read and clearing them with the language
      lists (`108` REQ-4); a stale report is discarded with the rest (`108` REQ-5). A worker that
      does not send the new field leaves the stored sources untouched.

      The sidecar name rule of `107` REQ-3 / `108` REQ-1 is widened to read back REQ-13's form, so a
      translated file counts as its language in `108`'s subtitle box and in `107`'s missing-language
      check: after
      the `<base>.` prefix and before the extension, trailing flag segments (`forced`, `foreign`,
      `sdh`, `cc`, `default`) and a purely numeric `.N` counter (REQ-13's collision suffix) are
      stripped, the **last** remaining segment is the language tag, and
      any segments before it are the title. `<base>.es.srt` and `<base>.es-419.forced.srt` read as
      today; `<base>.Latino.spa.srt` now reads as `spa` with title `Latino` instead of the
      unresolvable tag `Latino`, and `<base>.spa.2.srt` reads as `spa` instead of the unresolvable
      tag `2`. Dropping a file for `forced`/`foreign` is unchanged and applies to the stripped flags.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Constitution check line)**: Writing a new file under the destinations root is already
      allowed by Article XII. The `.part` scratch this spec's write job creates and removes is a new
      site the Check line does not name, so the Check line is extended to name it (PATCH, wording
      only). Nothing in this spec removes anything else under the destinations root, and `api` keeps
      its read-only mount.
- [ ] **NFR-2 (Crash recovery)**: No translation stays non-terminal forever. A translation in an
      `api`-side stage when `api` boots, or in a worker-side stage when the worker announces its boot
      (`054`'s `encodeWorkerStarted`), is failed with `error.subtitleTranslation.interrupted` and its
      staging files are deleted. It is never resumed automatically; the user requests it again.
- [ ] **NFR-3 (Cost)**: A translation sends each source cue to the provider at most once per
      attempt allowed by REQ-8/REQ-9. Nothing triggers a translation except an owner's request
      (REQ-7) and an administrator's test (REQ-4); nothing retries a failed translation
      automatically.
- [ ] **NFR-4 (No new image dependency)**: The worker uses the FFmpeg, `ffprobe` and SRT
      normalization it already has; `api` calls providers over plain HTTPS with no provider SDK unless the plan shows
      one is unavoidable for a kind.
- [ ] **NFR-5 (Reaching a local server)**: An `OLLAMA` or `OPENAI_COMPATIBLE` provider is reached
      at the base URL the administrator types, typically a LAN address such as
      `http://192.168.1.10:11434` for a server on another machine or outside Docker. No compose
      change is made; reaching a server on the Docker host itself through `host.docker.internal` is
      not supported in this spec.

## GraphQL Contract Delta

```graphql
enum LlmProviderKind {
  GEMINI
  OPENROUTER
  OPENAI
  OPENAI_COMPATIBLE
  OLLAMA
}

enum SubtitleTranslationMode {
  TRANSLATE
  ADAPT
}

enum SubtitleTranslationStatus {
  QUEUED
  EXTRACTING
  TRANSLATING
  WRITING
  COMPLETED
  FAILED
}

"""Admin-only. Never carries the key."""
type LlmProvider {
  id: Int!
  kind: LlmProviderKind!
  name: String!
  """Null for GEMINI/OPENROUTER/OPENAI (fixed)."""
  baseUrl: String
  hasApiKey: Boolean!
  enabled: Boolean!
  models: [LlmModel!]!
}

"""Admin-only."""
type LlmModel {
  id: Int!
  providerId: Int!
  model: String!
  label: String
  enabled: Boolean!
}

"""Visible to every user (REQ-6). No key, no URL, no raw provider id."""
type TranslationModel {
  id: Int!
  """label when set, else model."""
  displayName: String!
  providerName: String!
  providerKind: LlmProviderKind!
}

type LlmModelTestResult {
  ok: Boolean!
  elapsedMs: Int!
  """One of REQ-9's keys or invalid_response when ok is false, else null."""
  errorKey: String
}

extend type MediaCapabilities {
  """REQ-6. True while at least one enabled model under an enabled provider exists. Never exposes any provider detail."""
  subtitleTranslationAvailable: Boolean!
}

type SubtitleTranslationSource {
  """Opaque; sent back unchanged in RequestSubtitleTranslationInput.sourceId."""
  id: String!
  """Null when the language does not resolve; such a source cannot be requested (REQ-7)."""
  languageIso3: String
  title: String
  """The stream codec (subrip, ass, webvtt, mov_text)."""
  codec: String!
}

type SubtitleTranslation {
  id: Int!
  status: SubtitleTranslationStatus!
  mode: SubtitleTranslationMode!
  sourceLanguageIso3: String!
  sourceTitle: String
  targetTag: String!
  """Snapshot at request time; survives the model's deletion."""
  modelDisplayName: String!
  cuesDone: Int!
  """Null until the source is staged."""
  cuesTotal: Int
  """i18n key when status is FAILED, else null."""
  errorKey: String
  """i18n key for a non-fatal problem (REQ-14), else null."""
  warningKey: String
  """Base name only (REQ-13), set when COMPLETED."""
  outputFileName: String
  createdAt: DateTime!
  finishedAt: DateTime
}

extend type Movie {
  latestSubtitleTranslation: SubtitleTranslation
}

extend type Episode {
  latestSubtitleTranslation: SubtitleTranslation
}

input LlmProviderInput {
  kind: LlmProviderKind!
  name: String!
  baseUrl: String
  """Omitted keeps the stored key; "" clears it (REQ-5)."""
  apiKey: String
  enabled: Boolean!
}

input LlmModelInput {
  model: String!
  label: String
  enabled: Boolean!
}

input RequestSubtitleTranslationInput {
  """Exactly one of movieId / episodeId."""
  movieId: Int
  episodeId: Int
  sourceId: String!
  targetTag: String!
  modelId: Int!
}

type Query {
  """Admin-only."""
  llmProviders: [LlmProvider!]!
  """Every user; enabled models under enabled providers only."""
  translationModels: [TranslationModel!]!
  """Owner of the film / the episode's series (REQ-16's poll target). Null when the id is unknown or not the caller's."""
  subtitleTranslation(id: Int!): SubtitleTranslation
  """Owner of the film / the episode's series. From the latest library read (REQ-17); null while the file was never read."""
  movieTranslationSources(movieId: Int!): [SubtitleTranslationSource!]
  episodeTranslationSources(episodeId: Int!): [SubtitleTranslationSource!]

  """Service-only (worker). Container paths, same standing as SubtitleEmbedDetails."""
  subtitleTranslationDetails(id: Int!): SubtitleTranslationDetails!
}

type SubtitleTranslationDetails {
  id: Int!
  """Absolute container path of the library file (the path stored at request time, REQ-7)."""
  filePath: String!
  """The subtitle-relative stream ordinal in filePath (0:s:N)."""
  sourceOrdinal: Int!
  sourceLanguageIso3: String!
  """Absolute container path under the downloads root the worker writes the staged source to."""
  stagedSourcePath: String!
  """Absolute container path under the downloads root holding the translated SRT, set for WRITING."""
  stagedOutputPath: String
  """The target's Language.tag (es, es-419, en); the worker derives REQ-13's title segment from it with its own 051 regional titles."""
  targetTag: String!
  """The target's ISO 639-2 code, REQ-13's language segment."""
  targetIso3: String!
}

input LibrarySubtitleSourceInput {
  """Subtitle-relative stream ordinal (0:s:N)."""
  ordinal: Int!
  """Stream codec as ffprobe names it."""
  codec: String!
  """Normalized ISO 639-2, null when untagged or und."""
  languageIso3: String
  """The track's title tag."""
  title: String
  forced: Boolean!
}

type Mutation {
  """Admin-only."""
  createLlmProvider(input: LlmProviderInput!): LlmProvider!
  updateLlmProvider(id: Int!, input: LlmProviderInput!): LlmProvider!
  deleteLlmProvider(id: Int!): Boolean!
  createLlmModel(providerId: Int!, input: LlmModelInput!): LlmModel!
  updateLlmModel(id: Int!, input: LlmModelInput!): LlmModel!
  deleteLlmModel(id: Int!): Boolean!
  """Admin-only, synchronous (REQ-4). Stores nothing."""
  testLlmModel(id: Int!): LlmModelTestResult!

  """Owner (REQ-7)."""
  requestSubtitleTranslation(input: RequestSubtitleTranslationInput!): SubtitleTranslation!

  """Service-only (worker). Safe to receive more than once (038's posture)."""
  subtitleTranslationSourceStaged(id: Int!): Boolean!
  subtitleTranslationWritten(id: Int!, outputFileName: String!): Boolean!
  subtitleTranslationWorkerFailed(id: Int!, errorKey: String!): Boolean!

  """108's mutation, unchanged except for one new optional argument (REQ-17). Absent leaves the stored sources untouched."""
  libraryProbeCompleted(
    target: LibraryProbeTarget!
    filePath: String!
    audioLanguagesIso3: [String!]!
    embeddedSubtitleLanguagesIso3: [String!]!
    sidecarLanguageTags: [String!]!
    subtitleSources: [LibrarySubtitleSourceInput!]
  ): Boolean!
}
```

**Change to `108`'s worker contract**: `libraryProbeCompleted` gains the optional `subtitleSources`
argument above, and `sidecarLanguageTags` follows REQ-17's widened name rule (the last non-flag
segment). `108` is approved; this field and that rule are the only edits to it. `107`'s
`subtitle-probe` applies the same name rule to its own `sidecarLanguageTags`, since both share the
worker's sidecar parser.

The worker gains one queue, `subtitle-translation`, with two jobs: `stage-source` and
`write-output`, payload `{ subtitleTranslationId: number }`, concurrency 1, never inside an encode.
It reads everything else through `subtitleTranslationDetails`. The provider calls themselves run on
an `api`-internal queue (103's `subtitle-search` posture), never in the worker.

`Episode.latestSubtitleTranslation` and `episodeTranslationSources` resolve for any owner of the
series, like the episode itself. `subtitleTranslation(id)` exists for REQ-16's poll: there is no
`episode(id)` query, and re-reading a whole `show(id)` every few seconds to watch one episode would
be the expensive way.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| An admin-only query/mutation called by a non-admin | the existing admin-guard key | the existing message |
| `LlmProviderInput` missing a field its kind requires, or carrying one it forbids (REQ-1) | `BadRequestException` `error.llm.invalid_provider_fields` | `Faltan datos o sobran campos para este tipo de proveedor.` |
| `baseUrl` not an http(s) URL | `BadRequestException` `error.llm.invalid_base_url` | `La URL base no es válida.` |
| Provider name already used | `ConflictException` `error.llm.provider_name_taken` | `Ya existe un proveedor con ese nombre.` |
| Empty model, or model already under that provider | `ConflictException` `error.llm.model_taken` / `BadRequestException` `error.llm.model_empty` | `Ese modelo ya está cargado en este proveedor.` / `El modelo no puede estar vacío.` |
| Unknown provider/model id | `NotFoundException` `error.llm.provider_not_found` / `error.llm.model_not_found` | `El proveedor no existe.` / `El modelo no existe.` |
| `requestSubtitleTranslation` while `subtitleTranslationAvailable` is false | `BadRequestException` `error.subtitleTranslation.unavailable` | `La traducción de subtítulos no está disponible en esta instalación.` |
| Film/episode missing or not owned by the caller | `NotFoundException`, the existing `movie`/`episode` not-found keys | the existing messages |
| No `filePath` and no media server holding the title (REQ-7) | `BadRequestException` `error.subtitleTranslation.no_library_path` | `Perceptor no sabe dónde está el archivo de este título.` |
| No `filePath` and the media server unreachable (REQ-7) | `ServiceUnavailableException` `error.subtitleTranslation.media_server_unavailable` | `No se pudo contactar al servidor de medios para ubicar el archivo.` |
| `sourceId` not among the title's stored sources (REQ-7) | `BadRequestException` `error.subtitleTranslation.source_not_found` | `El subtítulo de origen ya no está disponible.` |
| Source language unknown (REQ-7) | `BadRequestException` `error.subtitleTranslation.source_language_unknown` | `No se sabe en qué idioma está el subtítulo de origen.` |
| Unknown target tag | `BadRequestException` `error.subtitleTranslation.target_not_found` | `El idioma de destino no existe.` |
| Model not enabled, or its provider not enabled | `BadRequestException` `error.subtitleTranslation.model_unavailable` | `Ese modelo ya no está habilitado.` |
| A translation of that film/episode is in flight (REQ-10) | `ConflictException` `error.subtitleTranslation.busy` | `Ya hay una traducción en curso para este título.` |
| Service-only query/mutation called with a user token | the existing service-guard key | the existing message |
| `subtitleTranslationDetails` for an unknown id | `NotFoundException` `error.subtitleTranslation.not_found` | not user-facing (worker logs and abandons) |

Outcome keys, stored on the record and shown in the modal/button, never thrown (REQ-8, REQ-9,
REQ-11, REQ-13, REQ-14, NFR-2). `testLlmModel` returns the first six:

| Key | Message the user sees |
| :-- | :-- |
| `error.subtitleTranslation.provider_unauthorized` | `El proveedor rechazó la API key.` |
| `error.subtitleTranslation.model_not_found` | `El proveedor no conoce ese modelo.` |
| `error.subtitleTranslation.provider_rate_limited` | `El proveedor limitó las consultas; probá más tarde.` |
| `error.subtitleTranslation.provider_unavailable` | `No se pudo contactar al proveedor.` |
| `error.subtitleTranslation.provider_refused` | `El proveedor se negó a responder o cortó la respuesta.` |
| `error.subtitleTranslation.invalid_response` | `El modelo devolvió un subtítulo que no coincide con el original.` |
| `error.subtitleTranslation.model_unavailable` | as above |
| `error.subtitleTranslation.source_mismatch` | `La pista elegida no coincide con la del archivo.` |
| `error.subtitleTranslation.source_unreadable` | `No se pudo leer el subtítulo de origen.` |
| `error.subtitleTranslation.file_gone` | `El archivo de la biblioteca cambió; no se escribió nada.` |
| `error.subtitleTranslation.write_failed` | `No se pudo guardar el subtítulo en la biblioteca.` |
| `error.subtitleTranslation.interrupted` | `La traducción se interrumpió.` |
| `error.subtitleTranslation.notify_failed` (warning) | `Subtítulo guardado, pero el servidor de medios no se actualizó todavía.` |

`web` must handle, in the modal: `busy` and `model_unavailable` by showing the message and
re-reading the title (the button then shows the in-flight translation, or the model list without
the disabled model); `source_not_found` by showing the message and reloading the source list;
`no_library_path` and `media_server_unavailable` by showing the message and disabling confirm; every other thrown key in the modal's error line. In Settings, every
`error.llm.*` key in the form's error line, keeping the user's input.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `LlmProvider` (new) | `kind` (enum), `name` (unique), `baseUrl?`, `apiKey?` (text), `enabled`, timestamps | `enabled` default `true` | No |
| `LlmModel` (new) | `providerId` (cascade), `model`, `label?`, `enabled`, timestamps; unique (`providerId`, `model`) | `enabled` default `true` | No |
| `SubtitleTranslation` (new) | `movieId?`/`episodeId?` (exactly one, cascade), `requestedById?` (User, set null), `modelId?` (set null), `modelDisplayName` (snapshot), `libraryPath` (container path resolved at request, REQ-7), `mode`, `status`, `sourceOrdinal`, `sourceLanguageIso3`, `sourceTitle?`, `targetTag`, `cuesDone`, `cuesTotal?`, `errorKey?`, `warningKey?`, `outputFileName?`, `createdAt`, `finishedAt?` | `cuesDone` default `0` | No |
| `Movie`, `Episode` | `fileSubtitleSources Json?` — REQ-17's translatable sources from the latest read; replaced and cleared with `108`'s `fileSubtitleLanguages` | `null` (never read) | No schema backfill. Data: `108`'s boot pass (REQ-3.4) widens its predicate from "never read" to "`fileSubtitleSources` is null", so one pass at the first boot after the migration re-reads every title that has a file and fills it; a read that fails leaves it null and shows REQ-7's "not read yet" line |
| enums | `LlmProviderKind`, `SubtitleTranslationMode`, `SubtitleTranslationStatus` | — | No |

No `Setting` key is added: providers and models are rows, not settings, because there are many and
each carries its own secret.

## Acceptance Criteria

- [ ] **AC-1**: As an administrator, in the new Settings tab, create an `OPENAI_COMPATIBLE` provider
      with no base URL: the form shows `Faltan datos o sobran campos para este tipo de proveedor.` and
      nothing is created. Create an `OLLAMA` provider with a base URL: it is listed with no key
      field.
- [ ] **AC-2**: Create a `GEMINI` provider with a key, then reload Settings: the key field is empty
      with an indication that a key is set, and `llmProviders` in the GraphQL response carries
      `hasApiKey: true` and no key value anywhere. Save the provider without touching the key: a test
      still succeeds. Grep `docker compose logs api` for the key: no hit.
- [ ] **AC-3**: Press "Probar" on a model with a valid key: success with an elapsed time. Change the
      key to a wrong one and press "Probar" again: `El proveedor rechazó la API key.` Change the model
      string to one that does not exist: `El proveedor no conoce ese modelo.` Repeat the valid test
      once for each of the five kinds.
- [ ] **AC-4**: As a non-administrator, `llmProviders` and `createLlmProvider` are refused with the
      admin-guard message; `translationModels` returns the enabled models with no key or URL.
      Disable every model: the translate button disappears from every detail page.
- [ ] **AC-5**: With the media server set to none, a film delivered by Perceptor (`filePath` set)
      shows the translate button; translating it writes the sidecar, the translation reads
      `COMPLETED` with no warning, and no media-server call appears in `api`'s log. With the media
      server set to none, a film with no `filePath` shows no button, and calling
      `requestSubtitleTranslation` for it is refused with
      `Perceptor no sabe dónde está el archivo de este título.`
- [ ] **AC-6**: On a film whose `.mkv` carries an embedded English SRT track and a PGS track, the
      modal lists the SRT track and not the PGS one. Pick target `es`: the modal says "Traducir".
      Confirm, leave the page, return: the button shows the translation in flight with its progress.
      When it completes, `<base>.spa.srt` exists beside the `.mkv` with the same number of cues and
      byte-identical timing lines as the English track; with Jellyfin configured, Jellyfin lists it as
      Spanish and `101`'s "Incrustar en archivo" offers it; after a page reload the film's subtitle
      box (`108`) shows `SPA` and the modal still lists only the embedded tracks.
- [ ] **AC-7**: On an episode whose `.mkv` carries an embedded Castilian track (`spa`, titled
      `Español (España)`), pick it as source and `es-419` as target: the modal says "Adaptar". When it
      completes, `<base>.Latino.spa.srt` exists beside the `.mkv` in UTF-8, Jellyfin lists it as
      Spanish titled `Latino`, and after the follow-up read the episode's subtitle line (`108`)
      counts it as `SPA`. Repeat with Plex as the media server: Plex lists the new file as Spanish.
- [ ] **AC-8**: Request a second translation of the same film while one is in flight: refused with
      `Ya hay una traducción en curso para este título.` and no new record exists.
- [ ] **AC-9**: Point a model at a provider that answers with fewer cues than sent (a stub, or a
      model forced to by its prompt in a test): the translation ends `FAILED` with
      `El modelo devolvió un subtítulo que no coincide con el original.`, no file was written under the
      destinations root, and no staging file of that translation remains under the downloads root.
- [ ] **AC-10**: Pre-create `<base>.spa.srt` beside a film and translate into `es`: the original
      file is byte-identical afterwards and the result is written as `<base>.spa.2.srt`.
- [ ] **AC-11**: Restart the `api` container while a translation reads `TRANSLATING`: after boot it
      reads `FAILED` with `La traducción se interrumpió.` and its staging files are gone. Do the same
      with the `worker` container during `EXTRACTING`: same outcome.
- [ ] **AC-12**: Stop the configured media server after a translation's write but before the
      notification (or make it fail): the translation reads `COMPLETED`, the file exists, and the
      modal shows `Subtítulo guardado, pero el servidor de medios no se actualizó todavía.`
- [ ] **AC-14**: Between a request and its extraction, replace the library file with one whose
      subtitle track at that ordinal has another language (or none): the translation ends `FAILED` with `La pista elegida no coincide con la del archivo.` and nothing is
      written.
- [ ] **AC-13**: `api` unit tests cover REQ-8's batch validation (count mismatch, renumbered cues,
      altered timings, empty text kept) and REQ-9's mapping for every provider kind against recorded
      responses; `worker` unit tests cover REQ-13's naming (free name, `.N` counter, `file_gone`) and
      REQ-17's sidecar name rule (`.es.srt`, `.es-419.forced.srt`, `.Latino.spa.srt`,
      `.Español (España).spa.srt`, `.spa.2.srt`, a flag-only name).
      `bin/npm api run test` and `bin/npm worker run test` pass.

## Out of Scope

- **The prompt texts.** REQ-12 fixes where the two prompts live and what they receive; writing and
  tuning them (tone, register, Rioplatense vs neutral Latin American, line length, honorifics) is
  its own piece of work, done against real output once this ships.
- **Embedding the result.** Always manual, through `101`'s existing button, because the output can be
  wrong and should be watched first. No automatic embed, unlike `103`.
- **Cancelling or resuming a translation.** A translation runs to its end or fails. A failed or
  interrupted one is requested again from the start. Resuming from the last good batch would need
  partial results stored per batch; worth it only if long translations prove fragile.
- **Per-user model choice or quotas.** Every owner sees every enabled model. Restricting models per
  user, or capping spend, needs a cost model this installation (~5 users) does not have.
- **Listing a provider's models from its API.** Models are typed by the administrator on purpose:
  provider catalogues change constantly and differ in shape. REQ-4's test is the validation.
- **Sidecars as a source.** The source is always a text track embedded in the library file. A loose
  `.srt` beside it (one the user dropped there, or one this spec wrote) cannot be translated or
  adapted; embedding it first through `101` makes it a source.
- **Image subtitles (PGS/VobSub) as a source.** They would need OCR first.
- **Embedding the result without Jellyfin.** Translation works with any media server or none, but
  `101`'s manual embed still lists sidecars through Jellyfin (`107` REQ-11). With Plex or no media
  server the translated sidecar stays a sidecar, which both Plex and Jellyfin play as is.
- **Editing or deleting a generated sidecar from Perceptor.** Article XII: a file written to the
  library stays; the user removes it through Jellyfin or by hand.
- **Season-wide translation.** One film or one episode per request.
