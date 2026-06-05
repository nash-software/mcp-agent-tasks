# MCPAT-072 — Always-on Tasks Dashboard (PWA + systray2 supervisor)

**Type:** Feature
**Size:** L
**Status:** approved
**Task:** MCPAT-072

> Makes the existing `serve-ui` dashboard a genuinely always-available desktop tool on Windows 11,
> **without bundling Chromium**. Builds on the current Node HTTP server in `src/server-ui.ts`
> (`startUiServer({ port, openBrowser })`, bound to `127.0.0.1`, serving the Vite React app from
> `dist/ui`) and the `serve-ui` CLI command in `src/cli.ts` (`--port`, default `4242`). Reuses the
> repo's existing hidden-node launcher pattern (`C:/Users/micha/.claude/hooks/node-hidden.exe`,
> already used for the Claude-hook installers in `src/cli.ts`).

---

## Description

Today the dashboard is only usable while a terminal babysits `agent-tasks serve-ui`, and seeing code
changes means manually stop → `npm run build` → restart. There is no autostart, no supervision, no
update affordance, and the only way in is a raw browser tab.

This spec makes the dashboard **always there and low-friction**, three user-facing wins:

1. **Always running** — a hidden **tray supervisor** auto-starts at Windows login, keeps the
   `serve-ui` server alive (restart-on-crash), and exposes a notification-area menu
   (Open · Update · Restart · Logs · Quit).
2. **One-click Update** — after editing repo code, **Update** (from the tray menu *or* an in-app
   header button) runs `npm run build`, restarts the server on the fresh bundle, and the open app
   auto-surfaces a **Reload** affordance — no terminal round-trip.
3. **Desktop-app feel, low RAM** — the UI ships a **PWA manifest + service worker** so Edge/Chrome
   offers **Install app**: a chromeless standalone window with a taskbar/Start icon that shares the
   already-installed browser engine (far lighter than a full Chrome session or a bundled-Chromium
   wrapper). Opening it with the main browser closed costs minimal incremental RAM.

**Architecture (selected during brainstorming — PWA + tray helper, over WebView2/Electron):**

```
Windows login
  └─(hidden, node-hidden.exe)→ agent-tasks tray            ← supervisor (NEW, src/tray/)
        ├─ spawns & monitors → serve-ui server (existing + dev endpoints)
        │                          └─ http://localhost:4242  (fixed port = stable PWA URL)
        └─ systray2 menu: Open · Update · Restart · Logs · Quit
                                   ▲
  Edge/Chrome PWA window ──────────┘  (installed from localhost:4242)
```

The **supervisor** is the stable always-resident parent; the **server** is a restartable child; the
**PWA** is the installed web page. The browser engine is shared.

**Tray library decision (confirmed):** `systray2` — a Node package that spawns a small (~2 MB) Go
helper binary and speaks JSON menu items/click-events over stdin/stdout. Keeps all logic in the
repo's Node/TS stack; no Rust/.NET toolchain, no Chromium bundle.

**Out of scope (YAGNI):** no git self-update; no remote/LAN access (server stays bound to
`127.0.0.1`); no save-triggered auto-rebuild watcher (Update is button-driven by choice); dev
endpoints are **off by default** in the published package (opt-in via env, see §Security).

See for context (do not duplicate — cite):
- `src/server-ui.ts` — `startUiServer(opts)` (~L1237), `createServer` router (~L1249–1269),
  `serveStatic` (~L633), `server.listen(opts.port, '127.0.0.1', …)` (~L3355), existing SSE usage for
  `/api/advisor/chat` (the version-reload channel reuses the simpler polling approach, not SSE).
- `src/cli.ts` — `serve-ui` command (~L908–918), the `install-claude-hooks` / hidden-launcher
  pattern using `node-hidden.exe` and Task Scheduler / settings registration (~L390–434, L1124–1175).
- `package.json` — `build` script (`tsup && npm --prefix src/ui run build`), `build:ui`, bin
  `agent-tasks → dist/cli.js`.
- `src/ui/` — Vite + React app (Vite config, `index.html`, `src/main.tsx`), TanStack Query `['tasks']`
  cache conventions, `lib/api.ts` client.

---

## Components & Build Order

This is **five phases in one spec**, each independently shippable and each with its own AC group.

### Phase A — Shared build runner + server dev endpoints
The single source of truth for "rebuild" logic, plus the server-side hooks the UI and supervisor poll.

- **`src/dev/build-runner.ts`** (NEW) — pure-ish helper:
  - `computeBuildId(distDir): string` — stable id from `dist/ui/index.html` mtime+size and the server
    bundle (`dist/cli.js`) mtime+size (hash of the concatenation). Used as the "version" the UI compares.
  - `runBuild(repoRoot): Promise<{ ok: boolean; log: string; buildId: string }>` — spawns
    `npm run build` with `cwd = repoRoot`, captures stdout+stderr into `log`, resolves `ok=false`
    (never throws) on non-zero exit, recomputes `buildId` on success. `repoRoot` is resolved from the
    package root, **not** `process.cwd()` (Windows npm-workspace gotcha).
- **serve-ui dev endpoints** (in `src/server-ui.ts`, gated behind `MCPAT_DEV_TRAY=1`):
  - `GET /api/version` → `{ buildId }` (always available — cheap, read-only; needed by the poller).
  - `POST /api/dev/update` → runs `runBuild(repoRoot)`; on `ok`, responds `{ ok:true, buildId }`
    then schedules `process.exit(0)` ~250 ms later (so the supervisor respawns on fresh code); on
    failure responds `{ ok:false, log }` with HTTP 200 body and **stays up** (no restart).
  - When `MCPAT_DEV_TRAY` is unset, `POST /api/dev/update` returns **404** (feature absent in the
    shipped tool). `GET /api/version` stays available either way.

### Phase B — Tray supervisor (`agent-tasks tray`)
- **`src/tray/supervisor.ts`** (NEW) + **`src/tray/index.ts`** entry; new CLI command `tray` in
  `src/cli.ts` (`agent-tasks tray [--port <n>]`, default 4242).
- Responsibilities:
  - **Single-instance lock** at `scratchpads/.tray/tray.lock` (PID + start time); a second launch
    detects a live lock and exits 0 (no-op).
  - **Spawn** the server child: `node <dist/cli.js> serve-ui --port 4242` with env `MCPAT_DEV_TRAY=1`,
    stdio piped to `scratchpads/.tray/server.log` (rotated at a size cap), no console window.
  - **Supervise**: on unexpected child exit, restart with exponential backoff (cap 5 rapid retries,
    then mark unhealthy). On an Update-initiated `exit(0)`, restart immediately.
  - **systray2 menu**:
    - *Open Dashboard* → opens `http://localhost:4242` (prefers the installed PWA via the OS default
      handler; falls back to default browser).
    - *Update* → calls the shared update path: `runBuild(repoRoot)`; on success kill+respawn child;
      surfaces success/failure via a tray balloon/tooltip.
    - *Restart server* → kill+respawn child (no rebuild).
    - *Open Logs* → opens `scratchpads/.tray/server.log`.
    - *Quit* → stop child, release lock, exit.
  - **Health in the icon/tooltip**: healthy / restarting / unhealthy (port busy or retry cap hit).
- Both the tray *Update* and the in-app Update button funnel through `runBuild` so there is **one**
  build code path (server endpoint awaits `runBuild` then exits; tray calls `runBuild` then respawns).

### Phase C — UI: version poller, reload affordance, Update button
- **`src/ui/src/lib/version.ts`** (NEW) — on first load, reads `/api/version` once and stores that
  `buildId` as the "loaded" baseline (no build-time injection), plus a poller that re-reads it.
- **Poller**: every ~5 s **only when `document.visibilityState === 'visible'`**, GET `/api/version`;
  if `buildId` differs from the loaded one → set "update available" state.
- **Reload affordance**: a small non-blocking toast/banner **"New build ready · Reload"**; clicking
  reloads the page. No silent auto-refresh (avoids interrupting an in-progress edit/scroll).
- **Header Update button** (NEW, visible only when `/api/version` is reachable *and* a dev flag is
  exposed by the server — e.g. `/api/version` also returns `{ devTray: true }` when `MCPAT_DEV_TRAY`
  is set): `POST /api/dev/update`, shows an inline spinner; on `{ok:false}` shows the build error log
  in a dismissible panel; on success the poller naturally detects the new `buildId` and surfaces Reload.

### Phase D — PWA install support (`src/ui`)
- Add **`vite-plugin-pwa`** to `src/ui` with `registerType: 'prompt'`, a web manifest
  (`name: "Agent Tasks"`, `short_name: "Tasks"`, `display: "standalone"`, `start_url: "/"`,
  `theme_color`/`background_color` from the design tokens), and app icons (192/512 + maskable).
- Service worker scope `/`; **network-first for `/api/*`** (always fresh data; never serve stale task
  state), precache for static assets only. The SW must **not** cache `/api/version` or `/api/dev/*`.
- Result: Edge/Chrome shows **Install app** → standalone chromeless window, taskbar/Start icon.

### Phase E — Autostart installer (`agent-tasks install-tray`)
- New CLI command `install-tray` (+ `--uninstall`) in `src/cli.ts`.
- Registers a **launch-at-login, hidden** entry that runs `agent-tasks tray` via the existing
  `node-hidden.exe` wrapper (no console window). Mechanism: **Scheduled Task at logon** (preferred,
  survives reboots, runs hidden) with HKCU `Run` key as the documented fallback. Idempotent
  (re-running does not duplicate the entry — mirror the existing hook-install idempotency).
- `--uninstall` removes the task/Run-key entry. Does **not** touch the PWA install (browser-owned).
- Prints post-install guidance: how to **Install app** from `localhost:4242` and optionally set it as
  the Chrome/Edge startup page (documentation step, not code).

---

## Acceptance Criteria

**Phase A — build runner + dev endpoints**
1. `computeBuildId` returns a stable string for unchanged `dist/`, and a **different** string after
   `dist/ui/index.html` or `dist/cli.js` changes (size or mtime). _(unit, fs mocked)_
2. `runBuild` resolves `{ ok:true, buildId }` on a zero-exit `npm run build` (spawn mocked) and
   `{ ok:false, log }` (never throws) on non-zero exit, with stderr captured in `log`. _(unit)_
3. `runBuild` resolves the repo root from the package root, not `process.cwd()`. _(unit — asserts the
   `cwd` passed to the mocked spawn)_
4. With `MCPAT_DEV_TRAY=1`, `GET /api/version` → 200 `{ buildId, devTray:true }`; `POST /api/dev/update`
   is routed (not 404). _(integration)_
5. With `MCPAT_DEV_TRAY` **unset**, `POST /api/dev/update` → **404**, and `GET /api/version` → 200
   `{ buildId, devTray:false }`. _(integration — proves the shipped tool has no build endpoint)_
6. A successful `POST /api/dev/update` returns `{ ok:true }` **before** the process exits, and the
   exit is deferred (response is fully flushed). _(integration — asserts response received, then a
   delayed exit signal)_

**Phase B — tray supervisor**
7. Starting `agent-tasks tray` twice: the second instance detects the live lock and exits 0 without
   spawning a second server. _(integration — lock file present + single child)_
8. When the server child exits unexpectedly, the supervisor respawns it; after 5 rapid failures it
   stops retrying and reports unhealthy. _(unit — backoff state machine, timers injected)_
9. The systray2 menu is constructed with exactly the items Open / Update / Restart / Logs / Quit, and
   each maps to its handler. _(unit — menu definition asserted; systray2 transport mocked)_
10. *Update* from the tray runs `runBuild` then respawns the child only on `ok:true`; on `ok:false`
    the existing child is left running and the failure is surfaced. _(unit)_

**Phase C — UI**
11. The poller fires only while `document.visibilityState==='visible'` and stops when hidden. _(unit —
    visibility + timers mocked)_
12. When `/api/version` returns a `buildId` different from the loaded one, the Reload affordance
    appears; identical `buildId` shows nothing. _(unit/component)_
13. The header Update button renders only when `/api/version` reports `devTray:true`; hidden otherwise.
    _(component)_
14. Clicking Update with a failing build shows the returned error `log` and does **not** reload.
    _(component — `POST /api/dev/update` mocked `{ok:false}`)_

**Phase D — PWA**
15. The production build emits a `manifest.webmanifest` (with `display:standalone`, `start_url:"/"`,
    192+512 icons) and a service worker; `index.html` links the manifest. _(build-output assertion)_
16. The service worker config marks `/api/*` network-first and excludes `/api/version` and `/api/dev/*`
    from caching. _(config assertion / unit on the generated runtime-caching rules)_

**Phase E — installer**
17. `install-tray` registers exactly one hidden-launch entry; re-running it does not create a second.
    _(unit/integration — idempotent, mirrors hook-install tests)_
18. `install-tray --uninstall` removes the entry it created. _(unit/integration)_
19. The registered command invokes `agent-tasks tray` through `node-hidden.exe` (no console window).
    _(unit — asserts the registered command string)_

**Cross-cutting**
20. `npm run type-check` (root `tsc --noEmit` + `src/ui` `tsc -b`) passes with no new `any`. _(gate)_
21. The server stays bound to `127.0.0.1` (no `0.0.0.0`); no new network exposure. _(integration —
    existing bind assertion still holds)_

---

## Security & Safety

- **Dev endpoints are opt-in.** `/api/dev/update` is only reachable when `MCPAT_DEV_TRAY=1`; the
  supervisor sets it, the published `serve-ui` does not. AC-5 makes the 404 falsifiable so the shipped
  tool can never trigger a build.
- **Localhost only.** No change to the `127.0.0.1` bind (AC-21). The build endpoint is therefore only
  reachable from the same machine.
- **Build command is fixed**, not user-supplied — no shell-injection surface (`npm run build`, no
  interpolated args).
- **Single-instance lock** prevents duplicate supervisors fighting over the port / build dir.

## Testing Strategy

- **Unit:** `build-runner` (id stability, `runBuild` success/fail/cwd), supervisor backoff state
  machine + menu definition (systray2 + spawn mocked), UI poller visibility/timing, Reload + Update
  button components.
- **Integration:** dev-endpoint gating (404 vs routed), deferred-exit on update, supervisor
  single-instance + respawn-on-exit, installer idempotency/uninstall.
- **Manual checklist (one-time, documented in the PR):** `install-tray` → reboot → tray icon present →
  *Install app* from `localhost:4242` → edit a UI file → *Update* → Reload toast → fresh UI; close
  main browser, open PWA from taskbar → loads.

## Risks & Mitigations

- **systray2 Go helper binary** must be present at runtime (it ships in the package). Mitigation:
  treat tray as an optional local feature; `serve-ui` itself never depends on it, and the supervisor
  degrades to "headless" (server only, log a warning) if the tray helper fails to start.
- **`npm run build` latency** (~10–30 s) blocks during Update. Mitigation: tray tooltip + UI spinner
  show "Building…"; child is only killed *after* a successful build (no downtime window on failure).
- **Windows npm-workspace `cwd`** pitfall: `runBuild` must use the resolved package root (AC-3).
- **Port 4242 busy** (another instance / stale process): supervisor surfaces it in the tray rather
  than crash-looping (AC covered by health state in §Phase B / AC-8 family).
