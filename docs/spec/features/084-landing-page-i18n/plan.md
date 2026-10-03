---
title: Landing Page Internationalization — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Landing Page Internationalization (`plan.md`)

> `services: []` — this feature touches no service, so there is no `<svc>/plan.md` beside this
> file and no subagent slice to brief. That makes this document the **only** brief: contrary to
> the template's usual rule, it does carry the file list, because there is no per-service plan for
> it to duplicate.

## Approach

The page stops being hand-written and becomes generated, from one template and two flat string
catalogs under a new top-level `tools/site/`. `site/` keeps its exact current role — the directory
`.github/workflows/pages.yml` uploads — and gains `site/es/index.html` beside the existing
`site/index.html`. Both are generated and committed.

**Catalogs are flat, and the generator is also the parity check.** The obvious reuse here is
`services/web/scripts/check-messages.mjs`, and it is deliberately *not* reused: it reads two
hardcoded paths inside `services/web/messages/` and flattens a nested catalog, so using it would
mean either editing a service (violating NFR-7) or copying forty lines of `flattenKeys` to walk a
nesting this catalog does not need. Site keys are flat and are the placeholder names themselves
(`hero.title`, `faq.ready.a`), so parity is a `Object.keys` set difference, and the generator
already has to fail on a `{{key}}` with no entry. One script, one command, no second way to do a
thing the repo does — Article X. The *shape* of `check-messages.mjs` is still the model: print the
missing keys by name, exit non-zero, no test framework.

**Catalog values are trusted HTML fragments, not escaped text.** The copy already contains markup
that carries meaning — `<br>` in the hero headline, `<b>Go</b>` and `<b>Add</b>` in the tour
captions, `<code class="mono">` in the install cards, `&nbsp;` in "60 GB". The catalog is committed
source written by us, never input, so values are substituted verbatim and the author writes their
own entities. An implementer who adds HTML-escaping to "be safe" will render `&lt;b&gt;` on the
live page; see Contract Freeze.

**Only prose becomes a key.** REQ-9's verbatim set — the install command, `docker compose pull &&
up -d`, `English, 日本語, 한국어`, `61 GB`/`3.4 GB`/`401`/`47`, `perceptor.local`, resolution names,
the product name, every GitHub URL — stays literal in `template.html`, as do every `id`, `href`
anchor, `class` and `aria-controls`. Keeping them out of the catalogs removes the entire class of
bug where a translator localizes an anchor and silently breaks the nav.

**The three per-locale differences the catalog cannot express** are computed by the generator, not
authored twice: `{{base}}` (empty at the root, `../` under `es/`, so NFR-5's two depths resolve
from one template), the `hreflang`/`canonical`/`og:url` block built from one `SITE_URL` constant,
and `{{detect}}` — the root gets the browser-sniffing script, `/es/` gets the override-only
variant that never sniffs. That asymmetry is the feature, not an oversight.

**Running it.** Article I forbids a host toolchain, so the generator runs in a container through a
new `bin/site` wrapper, following `bin/export`'s shape (cd to root, source `_docker.sh`,
`require_docker`) and `bin/dev`'s existing `docker compose $COMPOSE_FILES run --rm --no-deps`
pattern — the same mechanism that already runs the one-shot `certs`. It reuses the `web` service's
image (`node:24.18.0-alpine`) with the repo root bind-mounted, so nothing new is pulled and no
compose file changes. `bin/site --serve` adds a built-in `node:http` static server over `site/`,
because the acceptance criteria need the pages over `http://`, not `file://`, and GitHub Pages only
publishes from `master`.

## Order of Work

No service is involved, so the usual "`api` first" sequencing does not apply. The ordering
constraint here is that the placeholder vocabulary must exist before anything can consume it.

| Step | Owner | Why it must come here |
| :-- | :-- | :-- |
| 1 | `site` | `template.html` + `en.json`, extracted **verbatim** from today's `site/index.html`. Every later step reads the key vocabulary this step invents. |
| 2 | `site` | `build.mjs` — render, parity-check, `--serve`. Needs step 1's placeholders to exist. |
| 3 | `infra` | `bin/site`. Can run **in parallel** with step 2 once the script's path and flags are fixed by step 2's brief. |
| 4 | `site` | `es.json` — the Rioplatense translation. Can run **in parallel** with 2 and 3: step 1 froze the keys. |
| 5 | `site` | Generate and commit `site/index.html` and `site/es/index.html`. Gated on 1–4. |
| 6 | `infra` | A `site` job in `.github/workflows/ci.yml` that regenerates and fails on a diff. Gated on 5. |
| 7 | `docs` | Root `CLAUDE.md`: the `bin/` table gains `bin/site`, and the Current state line records the pass. Last. |

Step 1 carries a constraint that is worth more than any test here: **the English page regenerated
from the template must differ from today's `site/index.html` only by the intended additions** — the
localized head, the `hreflang` block, the switcher and the detect script. A diff showing anything
else means the extraction dropped or mangled copy. Verify it before step 4 translates anything.

## Contract Freeze

There is no GraphQL contract. `spec.md`'s `## GraphQL Contract Delta` says so, and is frozen as of
`status: Approved` along with the rest of the spec. What an implementer will be tempted to change
and must not:

- **Catalog values are not escaped.** They contain intentional markup. Adding HTML-escaping breaks
  the hero headline, the tour captions and the install cards, visibly.
- **`/es/` never sniffs the browser language.** It looks like a missing symmetry. It is REQ-6: a
  Spanish link shared with an English-browser visitor must not bounce them, and symmetric sniffing
  is how the two pages ping-pong.
- **The automatic redirect stores nothing.** It looks like a missed optimization. It is REQ-7:
  storing it would freeze a preference the visitor never expressed.
- **English stays at the root, with no `/en/`.** Out of Scope says why; the root is what the
  preview crawlers and the backlinks see.
- **`?lang=` never renders a page.** It redirects and disappears (REQ-8). Serving content from it
  creates the duplicate-URL pair the path layout exists to avoid.
- **The seven screenshots stay English.** Out of Scope, decided — only `alt` and `figcaption` are
  translated.

If any of these has to change: amend `spec.md`, re-approve, re-brief. Never from inside the
template (Article VIII).

## Migrations

**None.** No Prisma model, no column, no backfill, no database contact of any kind. Reversibility
is `git revert`: `site/index.html` is committed output, so reverting restores the exact page that
is live today and `pages.yml` redeploys it unchanged.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Generated output goes stale** — the committed-output trade-off of NFR-6 | Someone edits `template.html` or a catalog, commits, and never runs `bin/site`. The published page silently keeps the old copy. Nothing errors, no deploy fails, the diff looks intentional. **This is the feature's one genuinely silent failure.** | Step 6: a `site` job in `ci.yml` regenerates and runs `git diff --exit-code site/`. It fails the PR, never the deploy |
| **A translation goes stale** | A sentence is reworded in `en.json` only. Keys still match, so the parity check passes; `/es/` keeps saying the old thing, forever, correctly spelled | No tooling can catch this. Accepted and recorded: a copy change is two edits, and the reviewer of the diff is the check |
| **Relative paths break under `/es/`** | Fonts, the mark, seven screenshots and `og.jpg` 404 one directory down. The page still renders — unstyled headings and broken images — so a check that only greps the HTML passes | `{{base}}` is computed, never written by hand; AC-10 is a network-panel pass, not a grep |
| **Redirect loop** | A stored preference disagreeing with the page it is on bounces the visitor between `/` and `/es/` until the browser gives up. Loud, and total | `/es/` never sniffs (frozen above); AC-4 through AC-7 walk every combination of stored, overridden and browser-preferred |
| **Flash of the wrong language** | The detect script placed after the stylesheet paints English before replacing the document | `{{detect}}` is injected as the first thing in `<head>`, before the `<style>`; NFR-3 and AC-4 |
| **Root-owned generated files** | The container writes `site/es/index.html` as uid 0; the next `bin/site` or editor save fails with a permission error the wrapper does not explain | `bin/site` passes `--user "$(id -u):$(id -g)"` |
| **An anchor or id gets translated** | `#how` in the nav stops matching `id="how"`; the nav links do nothing on `/es/` only | Ids, anchors, classes and `aria-controls` are never keys (Approach); AC-2's manual pass clicks the nav |
| **`SITE_URL` drifts** | `canonical`, `og:url` and `hreflang` point at a URL that is not this page. Invisible to a human, consequential to a crawler | One constant in `build.mjs`; AC-12 curls the deployed pages |

## Verification

Everything through `bin/` (Article I). No service suite runs — nothing under `services/` is
touched, which is itself the first thing to prove:

```bash
git diff --stat services/
git status --short services/api/prisma
bin/site
git diff --stat site/
```

`bin/site` exits 0 and prints the key count; with a key removed from `es.json` it names that key
and exits 1 (AC-11). `git diff --stat site/` after a clean regeneration shows nothing when the
committed output is current, and exactly the two `index.html` files when it is not.

Then the structural pass:

```bash
grep -o '<html lang="[a-z]*"' site/index.html site/es/index.html
grep -c 'hreflang' site/index.html site/es/index.html
ls site/fonts
```

Then the browser pass, against `bin/site --serve` (not `file://` — the detection, storage and
relative-path criteria all need a real origin):

- Visit `/` with the browser set to `es-AR`, then to `en-US` (AC-4), and confirm nothing English
  paints on the way to `/es/` (NFR-3).
- After the Spanish redirect, confirm storage is still empty (AC-5).
- Switch to `EN` from `/es/`, reload `/` with the browser still Spanish (AC-6).
- `/?lang=fr` (AC-7), site data blocked (AC-8), JavaScript disabled on both pages (AC-9).
- `/es/` with the network panel open: zero 404s (AC-10).
- Read `/es/` end to end for register and for any English sentence left behind (AC-2).
- Reword one Spanish line, regenerate, read the diff (AC-13).

AC-12 is the only criterion that cannot be reached before merge: it curls the deployed pages, and
`pages.yml` publishes from `master` only. Run it after the merge, and treat a Spanish `og:` block
on `/es/` as the proof the whole layout decision was worth making.
