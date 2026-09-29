---
title: AC-10 baseline at 1280px — captured before T002
captured_at: 2026-09-28
---

# T001 — pre-change baseline (AC-10)

Captured live on the dev stack at 1280×900, before any `079` code change landed (Group 1
had not started). Purpose: after T002 closes the `--text-*` namespace and the scale is applied,
T018 re-measures the same three routes at the same viewport and must find the same columns and
rows-per-screen — the mobile legibility pass changes sizes, not layout or density.

## `/downloads` — light

- Columns: Target, Status, Progress, Speed, Actions (5).
- Rows visible: 1 of 1 (`Inception`, `DOWNLOADING`). Filter tabs: Completed 0, Working 1, Error 0.
- Pagination footer: "Showing 1-1 of 1", per-page selector at 10.

## `/downloads` — dark

- Same columns and row as light. No layout difference, only palette.

## `/users` — light

- Columns: Name, Username, Role, Status (4). No Actions column rendered for the caller's own row.
- Rows visible: 1 of 1 (`Admin`, `admin`, `Administrator`, `Enabled`).

## `/users` — dark

- Same columns and row as light.

## `/shows/<Reacher>` (series detail) — light

- Header: three columns (`077` layout) — poster; heading (title, year, language, `MISSING` badge),
  synopsis; Refresh/Remove, Content kind selector, Languages panel (Audio/Subtitles, both
  "from your preferences" / "None set"), Change button.
- Downloads panel below header, full width: "No downloads for this title yet."
- Season accordion (Season 4, expanded) below the downloads panel, full width. Episode table
  columns: #, Title, Release date, Status, Actions (5). Rows visible without further scroll: 3
  (episodes 8, 7, 6 of 8 total in the season).

## `/shows/<Reacher>` (series detail) — dark

- Same columns, same three rows visible, same layout as light.

## Summary for T018's comparison

| Route | Columns | Rows visible (no scroll beyond capture) |
| :-- | :-- | :-- |
| `/downloads` | 5 (Target/Status/Progress/Speed/Actions) | 1 of 1 |
| `/users` | 4 (Name/Username/Role/Status) | 1 of 1 |
| `/shows/<id>` season table | 5 (#/Title/Release date/Status/Actions) | 3 of 8 (season 4) |

Theme (light/dark) changed no column or row count on any of the three routes at 1280px.
