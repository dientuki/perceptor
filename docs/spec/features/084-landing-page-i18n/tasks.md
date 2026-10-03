---
title: Landing Page Internationalization — Tasks
last_updated: 2026-10-03
status: Done
---

# TASKS: Landing Page Internationalization (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[infra]` | Repo-root territory. **For this feature it also covers `tools/` and `site/`**, which no agent owns today: `services: []`, so there is no `site` agent to dispatch to and nothing under `services/` may be touched. An `[infra]` task here writes only inside `tools/`, `site/`, `bin/` and `.github/workflows/`. |
| `[docs]` | Prose. Owned by the orchestrator, not a service agent — here that is the Spanish copy as well as the `CLAUDE.md` updates. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Scope boundary for every task below:** `git diff --stat services/` must stay empty. An agent that
believes it needs to touch a service stops and reports instead.

## Tasks

### Group 1 — The page becomes generated, with no visible change

The whole feature rests on this group being provably inert. Nothing is translated here.

- [x] **T001** `[infra]` Add `bin/site`, following `bin/export`'s shape (`cd` to root, source
      `_docker.sh`, `require_docker`) and `bin/dev`'s `docker compose $COMPOSE_FILES run --rm
      --no-deps` pattern. It runs `node tools/site/build.mjs` in the `web` service's image with the
      repo root bind-mounted and `--user "$(id -u):$(id -g)"`, forwarding its arguments.
      *Done when:* `bin/site` reaches the container and fails with a module-not-found naming
      `tools/site/build.mjs` — the mount, the image and the user mapping are proven before the
      script it runs exists — and `docker ps -a` shows no container left behind.

- [x] **T002** `[infra]` Create `tools/site/template.html`, `tools/site/en.json` and
      `tools/site/build.mjs`. Extract every prose string from `site/index.html` into flat keys
      (`hero.title`, `faq.ready.a`) substituted **verbatim and unescaped** — values are trusted HTML
      fragments and keep their `<br>`, `<b>`, `<code>` and `&nbsp;`. REQ-9's verbatim set (the
      install command, `docker compose pull && up -d`, `English, 日本語, 한국어`, `61 GB`, `3.4 GB`,
      `401`, `47`, `perceptor.local`, resolution names, the product name, every GitHub URL) stays
      literal in the template, as does every `id`, `class`, `#` anchor and `aria-controls`. English
      only; no new markup, no second output. `build.mjs` fails on a `{{key}}` with no entry and on
      an entry no template uses. → T001
      *Done when:* `bin/site` exits 0 and `git diff --exit-code site/index.html` exits 0 — the
      generated page is byte-identical to the one in git today — and `grep -n '{{' tools/site/template.html`
      shows no placeholder inside an `id`, `href="#…"`, `class` or `aria-controls` attribute.

### Group 2 — The second locale

Depends on Group 1: there is nothing to render twice until the template exists. T003 → T004 → T005
is a chain rather than parallel work because all three edit `tools/site/build.mjs`.

- [x] **T003** `[infra]` Add the per-locale machinery and emit `site/es/index.html` beside the
      root page: `{{base}}` (empty at the root, `../` under `es/`); a head built from one
      `SITE_URL` constant — `<html lang>`, `<title>`, `meta description`, `og:title`,
      `og:description`, `og:locale` (`en_US` / `es_AR`), `og:url`, `twitter:*` and a self-pointing
      `canonical`; reciprocal `hreflang` for `en`, `es` and `x-default` at the root; a switcher in
      both headers that is a plain `<a>`; `{{detect}}` injected as the first thing in `<head>`,
      before the `<style>` — the root variant reads an explicit `?lang=`, then stored choice, then
      the browser's first preferred language and `location.replace`s to `es/`; the `/es/` variant
      handles an explicit `en` only and **never sniffs**; neither records anything on an automatic
      redirect, an unknown `?lang=` value is ignored outright, and every storage access is guarded
      so a throw leaves the page working. Move the copy button's confirmation to a `data-copied`
      attribute. Seed `tools/site/es.json` as a copy of `en.json` — still English, translated in
      T006. → T002
      *Done when:* `grep -o '<html lang="[a-z]*"' site/index.html site/es/index.html` prints `en`
      then `es`; `grep -c hreflang` prints 3 for each; and both pages render completely with
      JavaScript disabled.

- [x] **T004** `[infra]` Add `--serve` to `tools/site/build.mjs`: a static server over `site/` on
      `node:http`, no dependency, with `bin/site --serve` publishing the port. → T003
      *Done when:* `bin/site --serve` serves `/` and `/es/` over `http://` on the host, and `/es/`
      loads with zero 404s in the browser's network panel — the fonts, the mark, the seven
      screenshots and `og.jpg` all resolve one directory down.

- [x] **T005** `[infra]` Fold the catalog parity check into `build.mjs`: compare the key sets of
      `en.json` and `es.json`, print every key missing from either by name, exit non-zero. Model it
      on `services/web/scripts/check-messages.mjs` — same output shape and exit code, no test
      framework — but keep it flat and local; that file is not imported or edited. → T004
      *Done when:* `bin/site` prints the key count and exits 0; with one key deleted from
      `es.json` it names that key and exits 1; restoring it passes again.

### Group 3 — The Spanish copy

- [x] **T006** `[docs]` Translate every value in `tools/site/es.json` into Rioplatense Spanish —
      voseo, the register of `services/web/messages/es.json`, not neutral Latin American Spanish.
      Translate the `alt`, `aria-label` and `figcaption` strings too, describing the English
      screenshots they caption. Leave REQ-9's verbatim set untouched. Regenerate and commit both
      pages. → T005
      *Done when:* reading `site/es/index.html` end to end finds no English sentence in the body,
      and rewording one line in `es.json` and regenerating produces a diff touching only
      `site/es/index.html`.

### Group 4 — Guard, docs and the acceptance walk

- [x] **T007** `[infra]` Add a `site` job to `.github/workflows/ci.yml`, matching the existing jobs'
      shape (`actions/checkout@v5`, `actions/setup-node@v5` at `NODE_VERSION`), that runs the
      generator and then `git diff --exit-code site/`. This is the only defense against the
      committed-output trade-off of NFR-6. `.github/workflows/pages.yml` is **not** touched. → T006
      *Done when:* a commit that edits `tools/site/en.json` without regenerating fails the job and
      names the stale file; regenerating makes it pass.

- [x] **T008** `[docs]` Update the root `CLAUDE.md`: add `bin/site` to the Docker-first wrapper
      table, and record this pass in Current state. No pipeline stage changed status — say so. → T007

- [x] **T009** `[docs]` Walk the acceptance criteria in `spec.md` against `bin/site --serve`, tick
      each box, and set `status: Implemented` on `spec.md`, `plan.md` and this file. AC-12 curls the
      deployed pages and can only be run after the merge to `master` — record it as pending rather
      than ticking it. → T008

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
