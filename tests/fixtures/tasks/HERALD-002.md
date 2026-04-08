---
schema_version: 1
id: HERALD-002
title: Implement double-clap detection algorithm
type: feature
status: in_progress
priority: critical
project: HERALD
tags: [audio, detection]
complexity: 7
complexity_manual: false
why: >
  Core product feature. Users activate Herald via a double-clap gesture.
  The detection algorithm must be fast, accurate, and tunable.
created: 2026-04-02T09:00:00Z
updated: 2026-04-08T14:00:00Z
last_activity: 2026-04-08T14:00:00Z
claimed_by: DESKTOP-TEST-12345-1744120800000
claimed_at: 2026-04-08T14:00:00Z
claim_ttl_hours: 4
parent: null
children: []
dependencies: [HERALD-001]
subtasks:
  - id: HERALD-002.1
    title: Implement energy threshold detection
    status: done
  - id: HERALD-002.2
    title: Add inter-clap timing window
    status: in_progress
  - id: HERALD-002.3
    title: Write unit tests
    status: todo
git:
  branch: feat/herald-002-clap-detection
  commits:
    - sha: abc1234def5678
      message: "feat(audio): base energy threshold detector"
      authored_at: 2026-04-08T12:00:00Z
transitions:
  - from: todo
    to: in_progress
    at: 2026-04-08T13:00:00Z
files:
  - src-python/audio/detector.py
  - src-python/tests/test_detector.py
---

## Context

The double-clap detector uses energy threshold analysis with a timing window.

## Steps

- [x] Implement energy threshold detection
- [ ] Add inter-clap timing window (100-800ms)
- [ ] Write unit tests with recorded clap samples
