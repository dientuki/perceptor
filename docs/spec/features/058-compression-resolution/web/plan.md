---
title: Compression resolution — web slice
service: web
last_updated: 2026-09-16
status: Implemented
---

# PLAN: Compression resolution — `web` (`web/plan.md`)

## Scope

`web` offers `480p` as a fifth option in Settings → Compression, between `720p` and `360p`, labelled
in both message catalogs. Nothing else: the persistence path (hidden `compression_resolution` input,
`EDITABLE_KEYS` in `src/actions/settings.ts`), the disabled-while-off behaviour and the error display
already work and are not touched. `web` never reads `EncodeJobDetails.compressionResolution`.
Validation of the value is `api`'s.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/settings/CompressionPanel.tsx` | Modified | `"480p"` inserted into `RESOLUTIONS` between `"720p"` and `"360p"` |
| `services/web/messages/en.json` | Modified | `settings.compression.resolutions["480p"] = "480p"` |
| `services/web/messages/es.json` | Modified | same key, same value |

## Existing code to reuse

- `RESOLUTIONS` in `CompressionPanel.tsx` — the radios, their `Resolution` type, the fallback to
  `DEFAULT_RESOLUTION` and the label lookup `t(\`resolutions.${value}\`)` are all derived from this one
  array. Adding the entry is the whole change; do not add a second list or a special case.
- `scripts/check-messages.mjs` — the `en`/`es` parity check.

## Steps

1. Add `"480p"` to `RESOLUTIONS` in order.
2. Add the `480p` label to `messages/en.json` and `messages/es.json` under
   `settings.compression.resolutions`, between `720p` and `360p`.
3. Leave `DEFAULT_RESOLUTION` at `"1080p"` and every comment in the file as it is.

## Contract obligations

Consumes nothing new. `updateSettings` with `compression_resolution` already exists; once `api` ships
`480p` it is accepted. Against an `api` without it, saving `480p` returns
`error.setting.expected_enum`, which the Settings form already translates and displays — no new
handling.

## Tests

None owed. `web` has no test runner (`services/web/CLAUDE.md`), and a missing label fails loudly —
`check-messages.mjs` exits non-zero on catalog drift and `next-intl` renders the missing key.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 errors, build exits 0, no `en`/`es` drift (key count up by one from the last recorded 422).
