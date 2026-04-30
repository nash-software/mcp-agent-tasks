#!/usr/bin/env node
// Usage: node codex-pr-review.mjs <diff-file> [spec-file]
// Env:   OPENAI_API_KEY (required), CODEX_REVIEW_MODEL (default: gpt-4o)
// Output: JSON to stdout — { verdict, gaps: [{file, line, description, severity}], summary }

import { readFileSync, existsSync } from 'fs';

const [, , diffFile, specFile] = process.argv;

if (!diffFile) {
  console.error('Usage: codex-pr-review.mjs <diff-file> [spec-file]');
  process.exit(1);
}

if (!existsSync(diffFile)) {
  console.error(`Diff file not found: ${diffFile}`);
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set');
  process.exit(1);
}

const DIFF_CHAR_LIMIT = 12000;
const MAX_REVIEW_TOKENS = 2048;

let diffContent;
try {
  diffContent = readFileSync(diffFile, 'utf8');
} catch {
  console.error(`Cannot read diff file: ${diffFile}`);
  process.exit(1);
}

if (!diffContent.trim()) {
  process.stdout.write(JSON.stringify({ verdict: 'ALIGNED', gaps: [], summary: 'Empty diff — no changes to review.' }) + '\n');
  process.exit(0);
}

const specContent = (specFile && existsSync(specFile))
  ? (() => { try { return readFileSync(specFile, 'utf8'); } catch { return ''; } })()
  : '';

const model = process.env.CODEX_REVIEW_MODEL ?? 'gpt-4o';

const systemPrompt = `You are reviewing a pull request diff against the original design spec.
Find intent drift: places where the implementation contradicts, omits, or misinterprets the spec.
Do NOT flag style issues or implementation choices not covered by the spec.
Return ONLY the JSON object — no markdown fences, no explanation.`;

const userContent = [
  specContent ? `SPEC (source of truth):\n${specContent}` : 'No spec provided — review diff for completeness only.',
  `PR DIFF:\n${diffContent.slice(0, DIFF_CHAR_LIMIT)}`,
].join('\n\n---\n\n');

const schema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ALIGNED', 'GAPS'] },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['file', 'line', 'description', 'severity'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'gaps', 'summary'],
  additionalProperties: false,
};

let response;
try {
  response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'pr_review', strict: true, schema },
      },
      max_tokens: MAX_REVIEW_TOKENS,
    }),
  });
} catch (err) {
  console.error('Network error calling OpenAI:', err.message);
  process.exit(1);
}

if (!response.ok) {
  let text = '(could not read response body)';
  try { text = await response.text(); } catch { /* ignore */ }
  console.error(`OpenAI API error ${response.status}:`, text);
  process.exit(1);
}

const data = await response.json();
const content = data.choices?.[0]?.message?.content;

if (!content) {
  console.error('Empty response from OpenAI');
  process.exit(1);
}

process.stdout.write(content + '\n');
