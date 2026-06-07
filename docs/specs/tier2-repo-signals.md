# Tier-2 Repo Signals — Spec (MCPAT-080)

**Status:** APPROVED — for implementation on relay
**Parent:** MCPAT-075 (triage system) · builds on MCPAT-076 (engine)
**Author:** 2026-06-07

## 1. Problem

Tier-2 LLM triage (`src/triage/llm-triage.ts` -> `buildTriagePrompt`) sends the model only **task metadata** — title, why, type, status, age, idle days, and git-link presence. It has **no view into the codebase**. So for the link-less stale tasks (no merged PR / no linked commits), the model cannot verify whether the work is actually done and correctly answers **`unsure`** — which escalates instead of resolving. The conservatism is correct; the model just lacks evidence.

## 2. Goal

Gather cheap, per-task **repo signals** from the task's own project repository and include a compact summary in the Tier-2 prompt, so the model can reason about done-ness with evidence and confidently resolve far more of the backlog. Also harden batch reliability (timeout/size).

## 3. Signals (per task, from its project repo `repoPath`)

All gathered via the existing injected `CmdRunner` (`src/triage/git-signals.ts`) so they are unit-testable without a real repo. If `repoPath` is null or a command fails, the signal is absent (resilient — never throws).

1. **filesExist** — for each path in `task.files[]`: does it exist in the repo now? Report `N/M exist`.
2. **taskIdInHistory** — `git log --oneline --all --grep=<TASK-ID> -i` -> count + most-recent date.
3. **filesRecentlyTouched** — for `task.files[]`: `git log -1 --format=%cs -- <file>` -> most recent commit date touching them.
4. **keywordInCode** — derive 1-3 salient identifiers from the title (camelCase/PascalCase/kebab tokens, quoted names, >3 chars, skip stopwords) and `git grep -l --max-count=1` (bounded) -> whether the feature's symbols appear in code.

### Summary format (appended to each task's prompt line)
`| files 2/2 exist; id in 3 commits (last 2026-05-30); touched 2026-05-29; "JobDispatcher" in code`
Empty string when no signals could be gathered (e.g. repo absent) — the line falls back to metadata-only.

## 4. Architecture

- **`src/triage/repo-signals.ts`** (new):
  - `export interface RepoSignals { filesTotal: number; filesPresent: number; idCommitCount: number; idLastDate?: string; filesLastTouched?: string; keywordsFound: string[]; keywordsTried: string[] }`
  - `export function gatherRepoSignals(task: Task, repoPath: string | null, run: CmdRunner): RepoSignals` — impure (git), resilient per-command.
  - `export function summarizeSignals(s: RepoSignals): string` — pure, compact string (empty when nothing).
  - `export function extractKeywords(title: string): string[]` — pure (testable).
- **`src/triage/llm-triage.ts`**:
  - Extend `TriageTaskView` with `repo?: string` (the summary).
  - `taskView(task, nowMs, repoSummary?)` accepts the summary.
  - `buildTriagePrompt` renders the repo summary on each task line and the header instructs the model to weigh repo evidence.
- **`src/triage/engine.ts`** (Tier-2 phase): for each candidate batch, gather signals per task via the git runner + its project `repoPath`, build the view with the summary. Reliability: bump `LLM_BATCH_TIMEOUT_MS` 180000 -> 300000; change default `batchSize` 15 -> 8.

## 5. Performance

- Signals gathered **only for Tier-2 candidates**, only when `repoPath` exists.
- Bound the work: `git grep --max-count=1 -l`, cap keywords at 3, cap `task.files` scanned at ~10. One `git log --grep` per task.
- Repos that do not exist -> empty signals, no error.

## 6. Acceptance criteria

- **AC1** — `extractKeywords` pulls salient identifiers from a title, skipping stopwords/short tokens (unit-tested).
- **AC2** — `gatherRepoSignals` populates each signal via an injected `CmdRunner`; returns empty/zeroed signals (no throw) when `repoPath` is null or commands fail.
- **AC3** — `summarizeSignals` yields a compact string for populated signals and `''` for empty.
- **AC4** — `buildTriagePrompt` includes the repo summary on a task's line when present, and the header references repo evidence.
- **AC5** — engine Tier-2 passes repo summaries through to the prompt; tasks in absent repos are still judged (metadata-only) without error.
- **AC6** — `LLM_BATCH_TIMEOUT_MS === 300000` and default Tier-2 `batchSize === 8`.
- **AC7** — Unit tests cover extractKeywords, gatherRepoSignals (each signal + resilient path), summarizeSignals, and prompt-includes-signals. All green; `npm run type-check` + `npm run build` clean.

## 7. Out of scope

- Running the mass sweep (runtime, user-driven, on the machine with the repos).
- Persisting/caching signals across runs.
