/**
 * Unit tests for TaskPanel.tsx (P1-04 task peek & detail panels).
 * Uses source-file analysis — consistent with project test patterns (node env, no jsdom).
 *
 * Covers all spec ACs:
 *   AC1 — two widths (380/440) driven by panel.mode
 *   AC2 — transform-only slide (no opacity fade to hidden)
 *   AC3 — Enter promotes peek → detail (onPromote prop)
 *   AC4 — Esc closes either mode (onClose prop)
 *   AC5 — status history detail-only
 *   AC6 — header + footer match spec
 *   AC7 — mojibake fixed + no hardcoded palette
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const uiSrc = path.join(root, 'src', 'ui', 'src');

function readUiFile(relPath: string): string {
  return fs.readFileSync(path.join(uiSrc, relPath), 'utf-8');
}

const src = readUiFile('components/TaskPanel.tsx');

describe('TaskPanel.tsx — structure', () => {

  // ── AC1: Two widths ───────────────────────────────────────────────────────
  describe('AC1 — width driven by panel.mode', () => {
    it('defines 380 width for peek mode', () => {
      expect(src).toContain('380');
    });

    it('defines 440 width for detail mode', () => {
      expect(src).toContain('440');
    });

    it('derives width from mode (isPeek conditional)', () => {
      // The component uses isPeek to branch panel width
      expect(src).toContain('isPeek');
      expect(src).toContain('panelW');
    });
  });

  // ── AC2: Transform-only animation ────────────────────────────────────────
  describe('AC2 — transform-only slide, no opacity fade', () => {
    it('uses translateX for hidden state', () => {
      expect(src).toContain('translateX(100%)');
    });

    it('uses translateX(0) for visible state', () => {
      expect(src).toContain('translateX(0)');
    });

    it('uses spring ease cubic-bezier', () => {
      expect(src).toContain('cubic-bezier(0.16,1,0.3,1)');
    });

    it('does NOT use opacity-0 as the hidden mechanism', () => {
      // opacity-0 combined with hidden/display-none for the panel is the anti-pattern (§9)
      // The panel must never animate opacity to a hidden state
      expect(src).not.toContain('opacity-0 pointer-events-none');
    });

    it('cites the transform-only constraint in a comment', () => {
      // The file-level comment must explain the constraint
      expect(src).toMatch(/transform.only|transform-only|never animate opacity/i);
    });

    it('animation duration is in the 200-220ms range', () => {
      // 210ms is within the spec range (200-220ms)
      expect(src).toMatch(/20[0-9]ms|21[0-9]ms|22[0-9]ms/);
    });
  });

  // ── AC3: Enter promotes peek → detail ────────────────────────────────────
  describe('AC3 — onPromote prop for peek → detail', () => {
    it('accepts onPromote prop', () => {
      expect(src).toContain('onPromote');
    });

    it('does not bind internal keydown (key handling is App-global per spec)', () => {
      // The panel must NOT register its own keydown listener —
      // Enter/Esc are handled by App's useGlobalKeyboard (P1-02).
      expect(src).not.toContain('addEventListener(\'keydown\'');
      expect(src).not.toContain('addEventListener("keydown"');
    });
  });

  // ── AC4: Esc closes — onClose prop ───────────────────────────────────────
  describe('AC4 — onClose prop', () => {
    it('accepts onClose prop', () => {
      expect(src).toContain('onClose');
    });

    it('close × button calls onClose', () => {
      expect(src).toContain('onClick={onClose}');
    });
  });

  // ── AC5: Status history detail-only ──────────────────────────────────────
  describe('AC5 — status history is detail-only', () => {
    it('renders history section gated on !isPeek', () => {
      // The history section must be gated on !isPeek (i.e., detail mode only)
      expect(src).toMatch(/!isPeek.*transitions|transitions.*!isPeek/s);
    });

    it('renders "Status history" section title', () => {
      expect(src).toContain('Status history');
    });
  });

  // ── AC6: Header + footer match spec ──────────────────────────────────────
  describe('AC6 — header and footer', () => {
    it('header shows status dot element', () => {
      // Status dot is a span with the STATUS_DOT class
      expect(src).toContain('statusDotClass');
      expect(src).toContain('STATUS_DOT');
    });

    it('header shows mono task ID', () => {
      expect(src).toContain('font-mono');
      expect(src).toContain('task?.id');
    });

    it('header shows mode label "Peek" or "Detail"', () => {
      expect(src).toContain('Peek');
      expect(src).toContain('Detail');
    });

    it('header has close × button', () => {
      expect(src).toContain('×');
    });

    it('footer has an engine-driven primary status button (MCPAT-061)', () => {
      // The discrete Start/Done/Reopen buttons were replaced by a single primary button whose label is
      // computed from the status-action engine — assert the wiring, not a hard-coded label.
      expect(src).toContain('primaryTarget');
      expect(src).toContain('transitionLabel(task.status, primary)');
      expect(src).toContain('handleTransition(primary)');
    });

    it('footer has schedule toggle button (icon-based, retains commitLabel/today logic)', () => {
      // Logic is still computed (for aria-label via todayAriaLabel), even though text moved to aria/title
      expect(src).toContain('commitLabel');
      expect(src).toContain('Commit today');
      expect(src).toContain('Remove today');
      // Icon-based today toggle uses lucide CalendarCheck/CalendarPlus
      expect(src).toContain('CalendarPlus');
      expect(src).toContain('CalendarCheck');
    });

    it('footer has Hermes sign-off button (P4-06a: wired, conditionally disabled)', () => {
      expect(src).toContain('Hermes');
      // Button is gated on agent_status === 'scheduled' — wired in P4-06a
      expect(src).toContain('handleSignOff');
      expect(src).toContain('agent_status');
    });

    it('footer has ACR dispatch button (P4-06a: wired)', () => {
      expect(src).toContain('ACR');
      expect(src).toContain('handleDispatchAcr');
    });

    it('peek footer hint shows full detail · Esc close', () => {
      expect(src).toContain('full detail');
      expect(src).toContain('Esc');
    });

    it('peek footer hint is gated on isPeek', () => {
      expect(src).toMatch(/isPeek.*full detail|full detail.*isPeek/s);
    });
  });

  // ── AC7: Mojibake fixed + no hardcoded palette ────────────────────────────
  describe('AC7 — mojibake fixed, design-token colours', () => {
    it('does NOT contain the mojibake sequence (corrupted arrow bytes)', () => {
      // The old TaskDetailPanel had a corrupted UTF-8 arrow character
      // This test checks the source file does not contain it
      const mojibakeBytes = Buffer.from([0xc3, 0xa2, 0xe2, 0x80, 0xa0, 0x27]).toString('utf-8');
      expect(src).not.toContain(mojibakeBytes);
    });

    it('uses U+2192 RIGHT ARROW for transitions', () => {
      expect(src).toContain('→');
    });

    it('uses surface-* tokens instead of hardcoded slate', () => {
      expect(src).toContain('surface-1');
      expect(src).toContain('surface-3');
    });

    it('uses ink-* tokens instead of hardcoded slate text', () => {
      // The component must use ink-muted, ink-2, ink-faint, not text-slate-*
      expect(src).toContain('ink-muted');
      expect(src).not.toMatch(/text-slate-[0-9]+/);
    });

    it('uses status-* tokens for status colours', () => {
      expect(src).toContain('status-red');
    });

    it('uses PRIORITY_COLOR from tokens.ts', () => {
      expect(src).toContain('PRIORITY_COLOR');
    });
  });

  // ── Absolute positioning (not fixed, not modal) ───────────────────────────
  describe('Positioning — absolute inside .main, not fixed', () => {
    it('uses absolute positioning class', () => {
      expect(src).toContain('absolute');
    });

    it('does NOT use fixed positioning for the panel', () => {
      // Must not have the pattern className="fixed ...
      // (the panel is absolute within main, not fixed to the viewport)
      expect(src).not.toMatch(/className="[^"]*\bfixed\b/);
      expect(src).not.toMatch(/className=\{`[^`]*\bfixed\b/);
    });
  });

  // ── Failure path ──────────────────────────────────────────────────────────
  describe('Failure path — task becomes undefined while panel open', () => {
    it('calls onClose when task is undefined and panel is open', () => {
      // The component has a useEffect that fires onClose when task === undefined
      expect(src).toContain('task === undefined');
      expect(src).toContain('onClose()');
    });
  });

  // ── Optional sections omitted when fields absent ──────────────────────────
  describe('Optional sections — guarded rendering', () => {
    it('Why section is conditional on task.why', () => {
      expect(src).toContain('task.why');
    });

    it('Git section is conditional on task.git', () => {
      expect(src).toContain('task.git');
    });

    it('Linked docs section is conditional on spec_file or plan_file', () => {
      expect(src).toContain('spec_file');
      expect(src).toContain('plan_file');
    });

    it('Tags section is conditional on tags/labels presence', () => {
      // The chip editor derives its set from the task's tags/labels (optional-chained, since the
      // panel may render before the task resolves) into an optimistic `currentTags` draft.
      expect(src).toContain('task?.tags');
      expect(src).toContain('currentTags');
    });
  });

  // ── Scroll reset ──────────────────────────────────────────────────────────
  describe('Scroll position reset on taskId change', () => {
    it('uses a scrollRef to reset scroll', () => {
      expect(src).toContain('scrollRef');
      expect(src).toContain('scrollTop = 0');
    });
  });
});

// ── MCPAT-061/064: Bundle B + split button + Claim + lucide icons ────────────
describe('TaskPanel.tsx — MCPAT-061 status-action footer', () => {
  it('imports the pure status-action engine', () => {
    expect(src).toMatch(/from '\.\.\/lib\/task-actions'/);
    for (const fn of ['primaryTarget', 'secondaryTargets', 'transitionLabel', 'requiresReason', 'targetTone']) {
      expect(src).toContain(fn);
    }
  });

  it('renders a caret-driven menu of the secondary targets (split button)', () => {
    // The secondary menu is now anchored under the split button's caret segment
    expect(src).toContain('secondary.length > 0');
    expect(src).toContain('role="menu"');
    expect(src).toContain('secondary.map');
    // Caret uses ChevronDown lucide icon; no more "Move to…" text label
    expect(src).toContain('ChevronDown');
    expect(src).not.toContain('Move to…');
  });

  it('split button: primary uses rounded-l and caret uses rounded-r rounded-l-none', () => {
    expect(src).toContain('rounded-l');
    expect(src).toContain('rounded-r rounded-l-none');
  });

  it('caret button has aria-haspopup="menu" and aria-expanded on moveMenuOpen', () => {
    expect(src).toContain('aria-haspopup="menu"');
    expect(src).toContain('aria-expanded={moveMenuOpen}');
  });

  it('todo status uses Claim as the primary (handleClaim, not handleTransition)', () => {
    expect(src).toContain("task.status === 'todo'");
    expect(src).toContain('handleClaim');
    // JSX text nodes have surrounding whitespace; match the label text directly
    expect(src).toContain('Claim');
    // Ensure "Claim" appears as JSX button content (aria-label check)
    expect(src).toContain('aria-label="Claim task"');
  });

  it('handleClaim performs optimistic update and calls claimTask from api', () => {
    expect(src).toContain('async function handleClaim');
    expect(src).toContain('claimTask');
    // Optimistic pattern: snapshot + rollback
    expect(src).toContain("status: 'in_progress' as TaskStatus, claimed_by:");
  });

  it('imports claimTask from ../api', () => {
    expect(src).toMatch(/claimTask.*from '\.\.\/api'|from '\.\.\/api'.*claimTask/s);
  });

  it('Block opens an inline reason input rather than firing blind', () => {
    expect(src).toContain('requiresReason(to)');
    expect(src).toContain('blockDraft');
    expect(src).toContain('Why is this blocked?');
    expect(src).toContain('handleBlock');
  });

  it('generic optimistic transition handler with rollback (mirrors handleReopen template)', () => {
    expect(src).toContain('handleTransition');
    expect(src).toContain('getQueriesData');
    expect(src).toContain('setQueryData'); // rollback
  });

  it('command actions (Hermes/ACR) survive as icon buttons with accessible labels', () => {
    expect(src).toContain('aria-label="Sign off task to Hermes"');
    expect(src).toContain('aria-label="Dispatch task to ACR"');
  });

  it('lucide icons used: Send (Hermes), Bot (ACR), Trash2 (Delete), CalendarPlus (no emoji)', () => {
    expect(src).toContain('Send');
    expect(src).toContain('Bot');
    expect(src).toContain('Trash2');
    expect(src).toContain('CalendarPlus');
    // No emoji remnants
    expect(src).not.toContain('⚡');
    expect(src).not.toContain('▲');
  });

  it('Delete is an icon button (Trash2) in un-armed state, not text "Delete"', () => {
    // The un-armed delete renders Trash2 icon, not text "Delete" in a button
    expect(src).toContain('<Trash2 size={14}');
    // Text "Delete" should NOT appear as standalone button label anymore
    expect(src).not.toMatch(/<button[^>]*>\s*Delete\s*<\/button>/);
  });

  it('assignee badge renders claimed_by with User icon in detail mode', () => {
    expect(src).toContain('task.claimed_by');
    expect(src).toContain('User');
    expect(src).toContain('{task.claimed_by}');
  });

  it('menu closes on outside click via mousedown (not keydown — Enter/Esc stay App-global)', () => {
    expect(src).toContain("addEventListener('mousedown'");
    expect(src).not.toContain("addEventListener('keydown'");
  });
});

// ── App.tsx wiring ──────────────────────────────────────────────────────────
describe('App.tsx — TaskPanel integration', () => {
  const appSrc = readUiFile('App.tsx');

  it('imports TaskPanel (not TaskDetailPanel)', () => {
    expect(appSrc).toContain('TaskPanel');
    expect(appSrc).not.toContain('TaskDetailPanel');
  });

  it('passes panel prop to TaskPanel', () => {
    expect(appSrc).toContain('panel={panel}');
  });

  it('passes onClose prop to TaskPanel', () => {
    expect(appSrc).toContain('onClose=');
  });

  it('passes onPromote prop to TaskPanel', () => {
    expect(appSrc).toContain('onPromote=');
  });

  it('TaskDetailPanel.tsx is deleted (not importable)', () => {
    const tdpPath = path.join(uiSrc, 'components', 'TaskDetailPanel.tsx');
    expect(fs.existsSync(tdpPath)).toBe(false);
  });
});

// ── types.ts additions ───────────────────────────────────────────────────────
describe('types.ts — epic §4 field additions', () => {
  const typesSrc = readUiFile('types.ts');

  it('GitInfo has commits string array', () => {
    expect(typesSrc).toContain('commits');
  });

  it('Task has spec_file field', () => {
    expect(typesSrc).toContain('spec_file');
  });

  it('Task has plan_file field', () => {
    expect(typesSrc).toContain('plan_file');
  });

  it('Task has block_reason field', () => {
    expect(typesSrc).toContain('block_reason');
  });

  it('PanelState has mode peek|detail', () => {
    expect(typesSrc).toContain("mode: 'peek' | 'detail'");
  });
});
