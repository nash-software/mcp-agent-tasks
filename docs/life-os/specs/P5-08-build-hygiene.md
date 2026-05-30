# P5-08 — Build hygiene: decouple `npm --prefix src/ui ci` from `build`

**Type:** Chore
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-058
**Size:** S
**Depends on:** none (independent of all UI work — can run any time)
**Owners:** api-specialist / build owner (package.json scripts) · ops (CI verify)

> Read `docs/life-os/specs/00-epic-overview.md` first — §13 (Phase 5 framing). Evidence: audit §Q1
> (`package.json:33`, `ci.yml:29`) — **do NOT re-investigate.** This is a self-contained build-script
> change; it touches no application code.

---

## Why

`npm run build` runs `tsup && npm --prefix src/ui ci --prefer-offline && npm --prefix src/ui run build`
(`package.json:33`). The embedded `npm --prefix src/ui ci` **wipes and reinstalls `src/ui/node_modules`
on every build** — it broke local dev (a normal `npm run build` nukes the UI deps) and runs ~3× in CI
(audit §Q1; CI already has a dedicated install step at `ci.yml:29`). The fix is to **decouple install
from build**: `build` should only **compile**, and rely on CI's (and the developer's) dedicated install
step for dependencies. This keeps CI reproducible (CI still installs explicitly) without the destructive
re-install on every local build.

---

## Scope

**In scope**
- Change the root `build` script (`package.json:33`) so it **does not** run `npm --prefix src/ui ci` —
  `build` should be `tsup && npm --prefix src/ui run build` (compile only).
- Provide an explicit install path for the cases that need it: keep/confirm `build:ui`
  (`package.json:35`) for a from-scratch UI build, **or** document that CI / `npm install` at the root
  must have installed UI deps first.
- Verify **CI still installs UI deps** via its dedicated step (`ci.yml:29`) so CI builds remain
  reproducible after the decouple.

**Out of scope**
- Any application/source code change — scripts + CI config only.
- The `type-check` gate change — that is **P5-01** (`tsc -b`). (This spec must not regress it.)
- Reworking the whole CI pipeline — only ensure the UI install step still covers the build.
- Switching package managers / lockfile strategy.

---

## Data shapes / API contract

No runtime contract. Build-script change:

```jsonc
// package.json — before (package.json:33)
"build": "tsup && npm --prefix src/ui ci --prefer-offline && npm --prefix src/ui run build",
// after — compile only; install is a separate, explicit step
"build": "tsup && npm --prefix src/ui run build",
```

CI (`ci.yml:29`) keeps an explicit `npm --prefix src/ui ci` (or equivalent) **before** the build step,
so CI installs once, deterministically, and the build no longer re-installs.

---

## Acceptance Criteria

1. **`build` does not re-install UI deps.** The root `build` script (`package.json:33`) no longer contains
   `npm --prefix src/ui ci`; it compiles only (`tsup && npm --prefix src/ui run build`). (Falsifiable:
   grep `package.json` `build` script → no `src/ui ci`.)
2. **Local build is non-destructive.** Running `npm run build` locally (with UI deps already installed)
   does **not** wipe `src/ui/node_modules`. (Falsifiable: after `npm run build`, `src/ui/node_modules`
   is intact / unchanged mtime on the install marker.)
3. **A from-scratch build path exists.** There is a documented/scripted way to install UI deps + build
   from clean (e.g. `build:ui` still does `ci + build`, or root install covers it). (Falsifiable:
   `build:ui` or an equivalent installs then builds from a clean checkout.)
4. **CI remains reproducible.** CI installs UI deps via its dedicated step (`ci.yml:29`) before building;
   the CI build still succeeds end-to-end. (Falsifiable: CI run green; the UI install step runs exactly
   once before build, not embedded in `build`.)
5. **P5-01 gate intact.** The `type-check` gate (`tsc -b`, P5-01) still runs in CI and the build does not
   reintroduce a no-op install/compile ordering that hides UI errors. (Falsifiable: CI `type-check` still
   exercises `tsc -b`.)
6. **Gates pass.** `npm run type-check` + `npm run build` + `npm test` succeed (build now assuming deps
   installed). (Falsifiable: all exit `0` in a CI run where deps were installed first.)

---

## Build steps

1. **Edit `build` script (`package.json:33`).** Remove `npm --prefix src/ui ci --prefer-offline &&` so
   `build` = `tsup && npm --prefix src/ui run build`. **Test:** grep — `build` has no `src/ui ci`;
   `npm run build` with deps present succeeds and does not touch `node_modules`.
2. **Confirm from-scratch path.** Verify `build:ui` (`package.json:35`) still installs+builds for a clean
   checkout, **or** document that root setup installs UI deps. **Test:** from a clean clone,
   `npm install && npm --prefix src/ui ci && npm run build` (or `npm run build:ui`) succeeds.
3. **Verify CI (`ci.yml:29`).** Ensure CI has a dedicated UI install step before the build step; if the
   build previously relied on the embedded `ci`, add/confirm the explicit step so CI still installs once.
   **Test:** CI run is green; the UI install runs once, before build, not inside `build`.
4. **Run gates.** `npm run type-check` + `npm run build` + `npm test` (in an environment with UI deps
   installed). **Test:** all exit `0`.

---

## Test notes

- **Local verification:** run `npm run build` twice in a row with deps present; `src/ui/node_modules`
  is not re-created/wiped between runs (AC2).
- **CI verification (ops):** confirm the workflow installs UI deps in a dedicated step before build and
  the run is green (ACs 4, 5). Watch the CI run (`gh run watch`) — local pass is not sufficient (project
  memory: CI must pass before PR is done).
- **Grep assertion:** `package.json` `build` script has no `src/ui ci` (AC1).
- **Gate:** `npm run type-check` + `npm test` + a green CI run before PR.

---

## Failure modes

- **CI loses the install step.** If `build` was CI's only UI install and the decouple doesn't add an
  explicit CI install step, CI build fails on missing UI `node_modules`. Add/confirm the dedicated step.
- **`--prefer-offline` masking.** Don't just drop `--prefer-offline` and keep `ci` — the destructive
  re-install is the problem, not the offline flag. Remove the `ci` from `build` entirely.
- **Breaking the from-scratch path.** A new clone with no UI deps must still have a one-command way to
  install + build (`build:ui` or documented root install). Don't leave clean checkouts unbuildable.
- **Regressing P5-01.** Don't reorder so the UI build runs before `tsc -b` in a way that skips the gate.

---

## Open questions

1. **Where the explicit CI install lives.** Confirm `ci.yml:29` already installs UI deps independently
   (audit says it does, ~3× currently). Default: keep one dedicated UI `ci` step in CI; remove the
   redundant ones. Confirm against the actual workflow.
2. **`build:ui` semantics.** Keep `build:ui` as the from-scratch (`ci + build`) convenience, or fold
   install into a `setup` script. Default: keep `build:ui` as-is (it already does `ci + build`) so a
   clean build has a single command; confirm during build.
