/**
 * Triage model agreement harness (MCPAT-082 AC2).
 *
 * Runs a task sample through two LLM runners (modelA, modelB) using the same
 * triage prompt and reports the verdict-agreement rate. The runners are injected
 * so the module is unit-testable without a live claude spawn.
 *
 * IMPORTANT: The live Haiku-vs-Sonnet comparison run is done locally post-merge.
 * This file provides only the harness + types; do NOT run live sweeps on the VPS.
 */
import type { LlmRunBatch } from './engine.js';
import type { TriageTaskView } from './llm-triage.js';
import { buildTriagePrompt, parseTriageVerdicts } from './llm-triage.js';
import type { Verdict } from './llm-triage.js';

export interface EvalVerdict {
  id: string;
  modelA?: Verdict;
  modelB?: Verdict;
  agree: boolean;
}

export interface EvalReport {
  total: number;
  agreed: number;
  disagreed: number;
  /** Fraction of tasks where both models returned the same verdict: 0..1. */
  agreementRate: number;
  /** Per-task breakdown. */
  verdicts: EvalVerdict[];
}

/**
 * Run `views` through both runners concurrently and compare verdicts.
 *
 * Tasks where either model returns no verdict for that ID count as "disagreed"
 * (conservative: unknown ≠ agreement).
 */
export async function runTriageEval(
  views: TriageTaskView[],
  runnerA: LlmRunBatch,
  runnerB: LlmRunBatch,
): Promise<EvalReport> {
  if (views.length === 0) {
    return { total: 0, agreed: 0, disagreed: 0, agreementRate: 1, verdicts: [] };
  }

  const prompt = buildTriagePrompt(views);
  const [outA, outB] = await Promise.all([runnerA(prompt), runnerB(prompt)]);

  const mapA = new Map(parseTriageVerdicts(outA).map(v => [v.id, v.verdict]));
  const mapB = new Map(parseTriageVerdicts(outB).map(v => [v.id, v.verdict]));

  const evalVerdicts: EvalVerdict[] = views.map(view => {
    const a = mapA.get(view.id);
    const b = mapB.get(view.id);
    const agree = a !== undefined && b !== undefined && a === b;
    return { id: view.id, modelA: a, modelB: b, agree };
  });

  const agreed = evalVerdicts.filter(e => e.agree).length;

  return {
    total: views.length,
    agreed,
    disagreed: views.length - agreed,
    agreementRate: agreed / views.length,
    verdicts: evalVerdicts,
  };
}
