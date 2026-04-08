---
schema_version: 1
id: HERALD-001
title: Set up WebSocket connection to Python sidecar
type: feature
status: todo
priority: high
project: HERALD
tags: [ipc, websocket]
complexity: 4
complexity_manual: false
why: >
  The HUD frontend needs a real-time connection to the Python audio engine
  to receive trigger events and status updates.
created: 2026-04-01T10:00:00Z
updated: 2026-04-01T10:00:00Z
last_activity: 2026-04-01T10:00:00Z
claimed_by: null
claimed_at: null
claim_ttl_hours: 4
parent: null
children: []
dependencies: []
subtasks: []
git:
  commits: []
transitions: []
files:
  - src/store/websocket.ts
---

## Context

This task sets up the foundational WebSocket connection.

## Steps

- [ ] Implement WebSocket client with reconnect logic
- [ ] Handle connection state in Zustand store
- [ ] Emit events to HUD components
