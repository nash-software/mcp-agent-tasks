---
schema_version: 1
id: HERALD-003
title: Add system tray icon with context menu
type: feature
status: done
priority: medium
project: HERALD
tags: [ui, tray]
complexity: 3
complexity_manual: false
why: >
  Users need a way to access Herald settings and quit the app without
  a visible window.
created: 2026-04-03T08:00:00Z
updated: 2026-04-07T16:00:00Z
last_activity: 2026-04-07T16:00:00Z
claimed_by: null
claimed_at: null
claim_ttl_hours: 4
parent: null
children: []
dependencies: []
subtasks: []
git:
  branch: feat/herald-003-tray
  commits:
    - sha: def5678abc1234
      message: "feat(tray): add system tray with settings/quit menu"
      authored_at: 2026-04-07T15:00:00Z
  pr:
    number: 12
    url: https://github.com/user/herald/pull/12
    title: "feat: system tray icon with context menu"
    state: merged
    merged_at: 2026-04-07T16:00:00Z
    base_branch: main
transitions:
  - from: todo
    to: in_progress
    at: 2026-04-07T10:00:00Z
  - from: in_progress
    to: done
    at: 2026-04-07T16:00:00Z
    reason: PR merged
files:
  - src-tauri/src/tray.rs
---

## Context

Implemented via Tauri system tray API.

## Steps

- [x] Create tray icon with Settings and Quit menu items
- [x] Wire Settings to open settings window
- [x] Wire Quit to app exit
