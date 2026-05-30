# P4-06 — Enablement & infra batch

**Type:** Chore (enablement)
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-047
**Size:** L
**Depends on:** none hard (uses existing endpoints). (a) reuses existing ACR/Hermes backends; (b)(c)(d)(e) independent.
**Owners:** ui-specialist (a, b, e UI) · api-specialist (c brain-status route, d capture routing)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §5 (client conventions, graceful
> degradation). Every item here has a diagnosed fix point in the audit
> (`docs/life-os/audit/2026-05-30-functional-audit.md` §C + §A6) — **do NOT re-investigate.** Five
> loosely-related enablement fixes that share no code; they batch into one PR because each is small.

---

## Why

A set of "looks broken but is actually un-wired / mis-probed" issues (audit §C, §A6): dead Hermes/ACR
stub buttons over working backends, an unlabelled nav group, a Brain health probe that overloads
`brain_search` (and likely fails on TLS), capture mis-routing to COND from a context-free LLM call, and an
empty Artifacts list because its producer hook isn't installed. None need new architecture — they wire
existing pieces correctly.

---

## Scope (five items: a–e)

### (a) Un-stub Hermes / ACR per-task buttons — `ui`
The Hermes *view* is enabled; what's dead are the **per-task** "Sign off to Hermes" / "Dispatch to ACR"
buttons — hardcoded `disabled` stubs with empty handlers (audit §C1: `App.tsx:311-322`,
`TaskCard.tsx:175-177`, `TaskPanel.tsx:342-354`). The backends exist (`POST /api/acr/dispatch`; the gated
sign-off button already works at `HermesView.tsx:531-532`).
- **Fix:** remove the four `disabled` stubs; wire onClick → existing `POST /api/acr/dispatch` (ACR) and the
  existing Hermes sign-off path. Respect the sign-off gate (overview §9 — Hermes never touches un-signed
  tasks).

### (b) "Workspace" nav group label — `ui`
The 7 nav views (`Nav.tsx:79-98`) render in an **unlabelled** block; the Favourites group already has a
header (audit §C2).
- **Fix:** wrap the nav items in a labelled "Workspace" group header, mirroring the Favourites header
  styling.

### (c) Brain health — dedicated probe — `api`
"Offline" is inferred only when the `brain_search` probe throws/non-2xx (audit §C3: `server-ui.ts:68-106`,
`Nav.tsx:53-64`); most likely TLS (untrusted Tailscale cert on `:8093`) or endpoint-shape mismatch.
- **Fix:** add `GET /api/brain/status` — a dedicated liveness probe (Brain `/health` or MCP
  `initialize`/`ping`), and stop overloading `brain_search` as the liveness signal. **FLAG the TLS
  decision** for the `https://nash-vps.tail5c5009.ts.net:8093` endpoint — do **NOT** set a global
  `NODE_TLS_REJECT_UNAUTHORIZED=0` (insecure process-wide); scope any TLS trust to this single fetch.

### (d) Capture routing context — `api`
Quick capture sends only `{ text }` (no CWD/hint) → server writes to **GEN**, then `spawnBackgroundRouting`
(`server-ui.ts:527-579`) asks the `claude` CLI to pick a prefix from the full list with **no project
context and no confidence threshold** (`:545-546`) → ambiguous text silently rerouted to COND (audit §C4).
- **Fix:** pass the dashboard's own project as context/bias into `spawnBackgroundRouting`, **and/or** return
  confidence and **hold low-confidence captures in GEN** instead of silently rerouting. `#PREFIX` explicit
  override already works — preserve it.

### (e) Artifacts producer + empty-state — `ui` + ops
`GET /api/artifacts` reads `~/.mcp-tasks/artifacts.jsonl` which **does not exist** → `[]` (audit §A6); the
only writer is the `passive-capture.js` **PostToolUse** hook, almost certainly never installed.
- **Fix:** install/verify the `passive-capture.js` hook (`agent-tasks install-claude-hooks`) and add an
  empty-state explainer in `ArtifactsView.tsx` ("artifacts appear here as agents write files").

**Out of scope (all items)**
- New Hermes/ACR backend logic — (a) only wires existing endpoints.
- Replacing the routing LLM call wholesale — (d) adds context/confidence, not a new router.
- Brain server-side changes — (c) is dashboard-side probing only.
- Re-diagnosing any of these — audit §C/§A6 fix points are authoritative.

---

## Data shapes / API contract

### (c) `GET /api/brain/status`

| | |
|---|---|
| Behaviour | Probe Brain liveness via `/health` or MCP `initialize`/`ping` (not `brain_search`) |
| Success | `200` → `{ online: true, latencyMs?: number }` |
| Offline | `200` → `{ online: false, reason?: 'tls' \| 'timeout' \| 'shape' \| 'error' }` (never throws to client; graceful degradation, overview §5) |
| TLS | **Flagged decision** — scope trust to this fetch only; **no** global `NODE_TLS_REJECT_UNAUTHORIZED=0` |

### (d) capture routing — `spawnBackgroundRouting` (`server-ui.ts:527-579`)
- Input gains a project **context/bias** (the dashboard's own project) passed into the prompt.
- Routing returns/uses a **confidence**; below a threshold → keep the task in **GEN** (no silent reroute).
- `#PREFIX` explicit override path unchanged.

### (a) ACR dispatch — existing `POST /api/acr/dispatch` (no change). (e) artifacts — existing
`GET /api/artifacts` / `POST /api/artifacts/opened` (no change).

---

## Acceptance Criteria

1. **(a) Hermes/ACR buttons are live.** The four `disabled` stubs (`App.tsx:311-322`, `TaskCard.tsx:175-177`,
   `TaskPanel.tsx:342-354`) are removed; the per-task "Dispatch to ACR" button POSTs to
   `/api/acr/dispatch` and reflects the job; the per-task Hermes sign-off uses the existing sign-off path.
   Un-signed tasks cannot be dispatched to Hermes (gate respected, overview §9). (Falsifiable: clicking
   Dispatch fires the ACR POST; the button is no longer `disabled`.)
2. **(b) Workspace group label.** The 7 nav views render under a "Workspace" header mirroring the Favourites
   header (`Nav.tsx:79-98`). (Falsifiable: the nav block has a visible "Workspace" label.)
3. **(c) Dedicated Brain status probe.** `GET /api/brain/status` exists and probes liveness via
   `/health` or MCP `initialize`/`ping` — **not** `brain_search`. It returns `{ online: false, reason }`
   (not a thrown error) when Brain is unreachable, and `{ online: true }` when up. `Nav.tsx` uses this
   probe for the online/offline indicator. (Falsifiable: with Brain down the route returns `online:false`
   without throwing; `brain_search` is no longer the liveness signal.)
4. **(c) TLS handled safely.** Any TLS trust for the Tailscale `:8093` endpoint is scoped to the Brain
   fetch only; there is **no** global `NODE_TLS_REJECT_UNAUTHORIZED=0` anywhere in the process. The TLS
   approach is documented in the spec's Open Q / a code comment. (Falsifiable: grep finds no global TLS
   disable; the decision is recorded.)
5. **(d) Capture routing uses context + holds low-confidence in GEN.** `spawnBackgroundRouting` receives the
   dashboard's project as context/bias; a low-confidence routing result leaves the task in **GEN** rather
   than silently rerouting to an unrelated project (the COND misfire). `#PREFIX` explicit override still
   routes correctly. (Falsifiable: an ambiguous capture stays in GEN, not COND; `#MCPAT note` lands in
   MCPAT.)
6. **(e) Artifacts hook + empty state.** The `passive-capture.js` PostToolUse hook is installed/verified
   (`install-claude-hooks`); `ArtifactsView.tsx` shows an empty-state explainer when the list is empty
   instead of a blank panel. (Falsifiable: with no artifacts, the view shows the explainer copy; the hook
   appears in the installed Claude hook settings.)
7. **Graceful degradation preserved.** ACR and Brain offline paths still render the offline state, never an
   error (overview §5). Gates pass: `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **(a) Wire Hermes/ACR buttons.** Remove the `disabled` + empty handlers at `App.tsx:311-322`,
   `TaskCard.tsx:175-177`, `TaskPanel.tsx:342-354`; wire ACR dispatch → `dispatchToACR` client fn
   (`/api/acr/dispatch`, optimistic + invalidate `['acr','status']`, overview §5) and Hermes sign-off →
   the existing sign-off mutation; enforce the sign-off gate before dispatch. **Test:** RTL — Dispatch
   fires the ACR POST; un-signed task's Hermes action is gated/disabled.
2. **(b) Workspace nav header.** Wrap nav items (`Nav.tsx:79-98`) in a labelled group, reusing the
   Favourites header component/markup. **Test:** RTL — "Workspace" label renders above the nav items.
3. **(c) `GET /api/brain/status` route.** Add the route in `server-ui.ts` near the brain handlers
   (`:68-106`): probe `/health` or MCP `initialize`/`ping` with a timeout; catch TLS/timeout/shape and
   return `{ online, reason }` (never throw). Scope TLS trust to this fetch (custom `https.Agent`), **no**
   global env flag. Point `Nav.tsx:53-64` at the new probe. **Test:** integration — route returns
   `online:false` (no throw) when the endpoint is unreachable; unit — no global `NODE_TLS_REJECT...`.
4. **(d) Capture routing context + confidence.** In `spawnBackgroundRouting` (`server-ui.ts:527-579`),
   inject the dashboard's project as context/bias into the prompt and add a confidence threshold; below it,
   keep the task in GEN (no reroute). Preserve `#PREFIX` override (`:573-577` path). **Test:** unit —
   ambiguous/low-confidence input keeps GEN; `#MCPAT` override routes to MCPAT.
5. **(e) Artifacts hook + empty state.** Verify/install the `passive-capture.js` PostToolUse hook via
   `agent-tasks install-claude-hooks` (confirm the correct hook-registration schema — array-wrapped
   `hooks:` entry, per the known schema-silent-failure gotcha). Add an empty-state explainer block to
   `ArtifactsView.tsx`. **Test:** RTL — empty artifacts list renders the explainer; verify the hook entry
   is registered with the correct schema shape.

---

## Test notes

- **Unit (UI, RTL):** (a) button wiring + gate, (b) Workspace header, (e) empty-state copy.
- **Integration (api-specialist):** (c) `/api/brain/status` offline-without-throw + (d) routing
  context/confidence behaviour.
- **Ops verification:** (e) hook install — assert the `settings.json` entry uses the correct
  `{ matcher, hooks: [{ type:'command', command, timeout }] }` shape (avoid the silent-failure gotcha).
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **(c) Global TLS disable.** Setting `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide disables cert
  validation for **every** outbound fetch — a security hole. Scope trust to the Brain `https.Agent` only.
- **(d) Silent reroute regression.** If confidence handling is skipped, ambiguous captures keep landing in
  the wrong project (the COND misfire). Low-confidence MUST stay in GEN, not pick a random prefix.
- **(e) Hook schema silent failure.** A malformed hook entry registers but never fires (known gotcha —
  wrong `hooks` schema). Use the array-wrapped entry shape and verify it fires.
- **(a) Hermes gate bypass.** Dispatching an un-signed task to Hermes violates overview §9 — enforce the
  sign-off gate client-side and rely on the server gate as source of truth.

---

## Open questions

1. **TLS trust for Tailscale `:8093` (FLAGGED).** Options: (i) ship the Tailscale CA into the Node trust
   store, (ii) scoped `https.Agent` with `rejectUnauthorized:false` for the Brain host only, (iii) require
   a valid cert. Default: **(ii) scoped agent** as the pragmatic single-user-localhost choice; **never** a
   global disable. Settle with the user.
2. **Routing confidence source.** Does the `claude` routing call return a usable confidence, or must we
   derive one (e.g. explicit-prefix-present vs free-choice)? Default: treat free-choice with no strong
   signal as low-confidence → GEN. Confirm during build.
3. **(a) Where ACR/Hermes per-task buttons live.** Confirm whether all three locations
   (`App.tsx`/`TaskCard`/`TaskPanel`) should expose both buttons, or only the panel — default: wire all
   three as the audit lists them; trim if redundant.
