/* Life OS — Advisor (chat + suggestions), Notes, Completed views */

const TODAY_K = window.LifeOS.TODAY;
const ID_RE = /\b[A-Z]{2,5}-\d+\b/g;

// ── derive proactive suggestions from live task + note state ────────────
function buildSuggestions(tasks, notes, target) {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const byId = (id) => tasks.find((t) => t.id === id);
  const out = [];

  // 1 — critical work that isn't moving (prioritisation inversion)
  const critIdle = open.filter((t) => t.priority === "critical" && t.status !== "in_progress");
  if (critIdle.length) {
    const t0 = critIdle[0];
    out.push({
      id: "s-crit", severity: "critical",
      title: critIdle.length === 1
        ? `Start ${t0.id} first — your only critical task isn't moving`
        : `${critIdle.length} critical tasks aren't in progress`,
      rationale: `${t0.id} (“${t0.title}”) is priority:critical but still ${t0.status.replace("_", " ")}. Critical work sitting idle while lower-priority tasks are in flight is a prioritisation inversion — pull it to the front of the queue.`,
      taskIds: critIdle.map((t) => t.id).slice(0, 3),
      actions: ["commit"], basis: "priority + status",
    });
  }

  // 2 — capacity read for today
  const committed = open.filter((t) => t.scheduled_for === TODAY_K);
  const hrs = committed.reduce((s, t) => s + (t.estimate_hours || 0), 0);
  if (committed.length) {
    if (hrs > target) {
      out.push({
        id: "s-cap", severity: "warning",
        title: `You're over capacity — ${window.fmtHM(hrs)} committed against a ${target}h ceiling`,
        rationale: `${committed.length} tasks are on today and they add up to ${window.fmtHM(hrs)}. Past ${target}h the estimates lie and tomorrow borrows from today. Defer the lowest-leverage one before you start.`,
        taskIds: committed.slice().sort((a, b) => window.PRI_RANK[b.priority] - window.PRI_RANK[a.priority]).map((t) => t.id).slice(0, 2),
        actions: [], basis: "capacity model",
      });
    } else {
      out.push({
        id: "s-cap", severity: "info",
        title: `${window.fmtHM(hrs)} committed of ${target}h — room for one or two more`,
        rationale: `Today is comfortably under the ceiling. Good moment to pull a high-priority unscheduled task in rather than letting the slack fill itself.`,
        taskIds: [], actions: [], basis: "capacity model",
      });
    }
  }

  // 3 — blocked work that's aging
  const blocked = open.filter((t) => t.status === "blocked");
  if (blocked.length) {
    const b = blocked[0];
    out.push({
      id: "s-block", severity: "warning",
      title: `${b.id} is blocked — chase the unblock or reschedule it`,
      rationale: `“${b.title}” is parked: ${b.block_reason || "waiting on an external dependency"}. It's high-priority, so the longer it waits the more it compresses the rest of the plan. Confirm the window or move it off the radar.`,
      taskIds: [b.id], actions: ["open"], basis: "status age",
    });
  }

  // 4 — shared root cause across two tasks (from a brain note)
  const acr = byId("ACR-57"), hrld = open.find((t) => t.id === "HRLD-34");
  if (acr && hrld && acr.status !== "done") {
    out.push({
      id: "s-root", severity: "info",
      title: `Fix ${acr.id} and ${hrld.id} together — they share one root cause`,
      rationale: `Your brain note “Retry/backoff pattern” ties the ACR dispatch failures and the Herald webhook drops to the same missing backoff. Writing the shared dispatch util once closes both instead of patching them twice.`,
      taskIds: [acr.id, hrld.id], actions: ["commit"], basis: "brain · patterns/dispatch.md",
    });
  }

  // 5 — a recurring manual ritual worth automating
  const ritual = open.find((t) => (t.tags || []).includes("weekly") && !t.agent_status && t.scheduled_for == null);
  if (ritual) {
    out.push({
      id: "s-auto", severity: "info",
      title: `Hand ${ritual.id} to Hermes — it's a weekly ritual you keep doing by hand`,
      rationale: `“${ritual.title}” recurs on a cadence and the inputs barely change. Sign it off once and it runs itself — that's ~${window.fmtHM(ritual.estimate_hours || 0.5)} back every week.`,
      taskIds: [ritual.id], actions: ["hermes"], basis: "recurrence pattern",
    });
  }

  return out.slice(0, 5).map((s, i) => ({ rank: i + 1, ...s }));
}

// ── compact context the chat reasons over ──────────────────────────────
function snapshotContext(tasks, notes, suggestions) {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const line = (t) => `- ${t.id} [${t.priority}/${t.status}${t.scheduled_for === TODAY_K ? "/today" : ""}] ${t.title}`;
  const taskLines = open.slice(0, 16).map(line).join("\n");
  const noteLines = notes.slice(0, 5).map((n) => `- ${n.title}: ${n.body}`).join("\n");
  const suggLines = suggestions.map((s) => `- ${s.title}`).join("\n");
  return `OPEN TASKS (${open.length}):\n${taskLines}\n\nNOTES:\n${noteLines}\n\nADVISOR FLAGS:\n${suggLines}`;
}

// ── local fallback responder (when the Claude bridge isn't available) ───
function localAdvice(prompt, tasks, suggestions) {
  const q = prompt.toLowerCase();
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  if (/block|stuck|waiting/.test(q)) {
    const b = open.filter((t) => t.status === "blocked");
    return b.length
      ? `${b.map((t) => t.id).join(", ")} ${b.length === 1 ? "is" : "are"} blocked. ${b[0].id} is waiting on: ${b[0].block_reason}. Everything else is actionable — nothing else is gated.`
      : `Nothing is blocked right now. Your constraint is capacity, not dependencies.`;
  }
  if (/standup|update|summar|week|recap/.test(q)) {
    const done = tasks.filter((t) => t.status === "done").slice(0, 3).map((t) => t.id);
    const wip = open.filter((t) => t.status === "in_progress").map((t) => t.id);
    const next = open.filter((t) => t.scheduled_for === TODAY_K && t.status === "queued").slice(0, 3).map((t) => t.id);
    return `Yesterday → shipped ${done.join(", ") || "—"}. In progress → ${wip.join(", ") || "nothing claimed"}. Today → ${next.join(", ")}. Watch-out → ${suggestions[0] ? suggestions[0].title : "all clear"}.`;
  }
  if (/automat|hermes|delegate|agent/.test(q)) {
    const a = suggestions.find((s) => s.id === "s-auto");
    return a ? a.rationale : `The strongest automation candidate is anything tagged "weekly" — same inputs each run. Sign one off to Hermes and watch it for a cycle.`;
  }
  // default: "what next" / anything
  const top = suggestions[0];
  return top
    ? `${top.title}. ${top.rationale}`
    : `You're in good shape — start the highest-priority committed task and protect the capacity ceiling.`;
}

async function callBridge(messages) {
  if (window.claude && typeof window.claude.complete === "function") {
    try { return await window.claude.complete({ messages }); } catch (e) { return null; }
  }
  return null;
}

// render text with inline, clickable task-id chips
function renderWithChips(text, onOpenTask) {
  const parts = [];
  let last = 0, m;
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const id = m[0];
    parts.push(
      React.createElement("button", {
        key: m.index, className: "id-chip", onClick: () => onOpenTask(id),
      }, id)
    );
    last = m.index + id.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Advisor chat ───────────────────────────────────────────────────────
const SUGGESTED = [
  "What should I work on next?",
  "What's blocking me?",
  "Draft my standup",
  "What can Hermes take off my plate?",
];

function AdvisorChat({ tasks, notes, suggestions, onOpenTask }) {
  const Icon = window.Icon;
  const bridge = !!(window.claude && window.claude.complete);
  const [msgs, setMsgs] = React.useState([
    { role: "assistant", text: suggestions[0]
      ? `I've read your ${tasks.filter((t) => t.status !== "done").length} open tasks, ${notes.length} notes and the brain index. The one thing I'd flag first: ${suggestions[0].title.toLowerCase()}. Ask me anything, or tap a prompt below.`
      : `I've read your tasks, notes and the brain index. Ask me what to focus on, what's blocking you, or for a standup draft.` },
  ]);
  const [val, setVal] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const threadRef = React.useRef(null);

  React.useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [msgs, busy]);

  const send = async (textArg) => {
    const text = (textArg != null ? textArg : val).trim();
    if (!text || busy) return;
    const history = [...msgs, { role: "user", text }];
    setMsgs(history); setVal(""); setBusy(true);

    const sys = `You are the Advisor inside Life OS, a calm, blunt chief-of-staff for one developer. You reason over their live workload and answer in 2–4 sentences, referencing task IDs (e.g. COND-88) directly. Never pad. Prefer one clear recommendation over a list.\n\n${snapshotContext(tasks, notes, suggestions)}`;
    const convo = [
      { role: "user", content: sys },
      { role: "assistant", content: "Understood — I have the workload, notes and brain context loaded. What do you want to look at?" },
      ...history.map((m) => ({ role: m.role, content: m.text })),
    ];
    let reply = await callBridge(convo);
    if (!reply) reply = localAdvice(text, tasks, suggestions);
    setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    setBusy(false);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    React.createElement("div", { className: "adv-chat" },
      React.createElement("div", { className: "adv-chat-head" },
        React.createElement("div", { className: "adv-avatar" }, React.createElement(Icon.Wand, { size: 16 })),
        React.createElement("div", { className: "adv-head-main" },
          React.createElement("div", { className: "adv-head-title" }, "Advisor"),
          React.createElement("div", { className: "adv-head-sub" }, "Reasons over your tasks, notes & brain")
        ),
        React.createElement("div", { className: "adv-ctx" },
          React.createElement("span", { className: "adv-ctx-chip" + (bridge ? " live" : "") },
            React.createElement("span", { className: "d" }), bridge ? "Claude · live" : "Claude"),
          React.createElement("span", { className: "adv-ctx-chip" }, "brain CLI"),
          React.createElement("span", { className: "adv-ctx-chip" }, tasks.filter((t) => t.status !== "done").length + " tasks")
        )
      ),

      React.createElement("div", { className: "adv-thread", ref: threadRef },
        msgs.map((m, i) =>
          React.createElement("div", { key: i, className: "adv-msg " + m.role },
            m.role === "assistant" && React.createElement("span", { className: "adv-msg-ico" }, React.createElement(Icon.Wand, { size: 13 })),
            React.createElement("div", { className: "adv-bubble" }, renderWithChips(m.text, onOpenTask))
          )
        ),
        busy && React.createElement("div", { className: "adv-msg assistant" },
          React.createElement("span", { className: "adv-msg-ico" }, React.createElement(Icon.Wand, { size: 13 })),
          React.createElement("div", { className: "adv-bubble thinking" },
            React.createElement("span", { className: "dot" }), React.createElement("span", { className: "dot" }), React.createElement("span", { className: "dot" }))
        )
      ),

      msgs.length <= 1 && React.createElement("div", { className: "adv-suggested" },
        SUGGESTED.map((s) =>
          React.createElement("button", { key: s, className: "prompt-chip", onClick: () => send(s) },
            React.createElement(Icon.Zap, { size: 12 }), s)
        )
      ),

      React.createElement("div", { className: "adv-composer" },
        React.createElement("div", { className: "adv-tools" },
          React.createElement("span", { className: "tool-chip" }, "@tasks"),
          React.createElement("span", { className: "tool-chip" }, "@notes"),
          React.createElement("span", { className: "tool-chip" }, React.createElement(Icon.Brain, { size: 11 }), "brain search"),
          React.createElement("span", { className: "tool-chip" }, React.createElement(Icon.Server, { size: 11 }), "ACR")
        ),
        React.createElement("div", { className: "adv-input-row" },
          React.createElement("textarea", {
            className: "adv-input", rows: 1, value: val, placeholder: "Ask about your workload, tasks or notes…",
            onChange: (e) => setVal(e.target.value), onKeyDown: onKey,
          }),
          React.createElement("button", { className: "adv-send", disabled: !val.trim() || busy, onClick: () => send() },
            React.createElement(Icon.Send, { size: 15 }))
        ),
        React.createElement("div", { className: "adv-foot-hint" },
          React.createElement("kbd", null, "↵"), " send · ", React.createElement("kbd", null, "⇧↵"), " newline · ",
          bridge ? "connected to Claude + brain CLI" : "brain CLI · Claude offline (local reasoning)")
      )
    )
  );
}

// ── Suggestion card ────────────────────────────────────────────────────
const SEV_LABEL = { critical: "Act now", warning: "Watch", info: "Consider" };

function SuggestionCard({ s, handlers }) {
  const Icon = window.Icon;
  return (
    React.createElement("div", { className: "sugg-card", "data-sev": s.severity },
      React.createElement("div", { className: "sugg-top" },
        React.createElement("span", { className: "sugg-rank" }, String(s.rank).padStart(2, "0")),
        React.createElement("span", { className: "sev-badge", "data-sev": s.severity },
          React.createElement("span", { className: "d" }), SEV_LABEL[s.severity]),
        React.createElement("button", { className: "sugg-dismiss", title: "Dismiss", onClick: () => handlers.dismiss(s.id) },
          React.createElement(Icon.X, { size: 14 }))
      ),
      React.createElement("div", { className: "sugg-title" }, s.title),
      React.createElement("div", { className: "sugg-rationale" }, s.rationale),
      React.createElement("div", { className: "sugg-foot" },
        s.taskIds.length > 0 && React.createElement("div", { className: "sugg-chips" },
          s.taskIds.map((id) =>
            React.createElement("button", { key: id, className: "id-chip", onClick: () => handlers.open(id) }, id))
        ),
        React.createElement("div", { className: "sugg-actions" },
          s.actions.includes("commit") && React.createElement("button", { className: "btn sm", onClick: () => handlers.commit(s.taskIds[0]) },
            React.createElement(Icon.Plus, { size: 13 }), "Commit"),
          s.actions.includes("hermes") && React.createElement("button", { className: "btn sm", onClick: () => handlers.hermes(s.taskIds[0]) },
            React.createElement(Icon.Robot, { size: 13 }), "Hand to Hermes"),
          s.actions.includes("open") && React.createElement("button", { className: "btn sm ghost", onClick: () => handlers.open(s.taskIds[0]) },
            "Open", React.createElement(Icon.Arrow, { size: 13 }))
        )
      ),
      s.basis && React.createElement("div", { className: "sugg-basis" },
        React.createElement(Icon.Beaker, { size: 11 }), "based on ", s.basis)
    )
  );
}

// ── Advisor view ───────────────────────────────────────────────────────
function AdvisorView({ tasks, notes, target, handlers }) {
  const Icon = window.Icon;
  const [seed, setSeed] = React.useState(0);
  const [dismissed, setDismissed] = React.useState([]);
  const all = React.useMemo(() => buildSuggestions(tasks, notes, target), [tasks, notes, target, seed]);
  const suggestions = all.filter((s) => !dismissed.includes(s.id));
  const cardHandlers = {
    open: handlers.openTask, commit: handlers.commit, hermes: handlers.hermes,
    dismiss: (id) => setDismissed((d) => [...d, id]),
  };
  return (
    React.createElement("div", { className: "advisor-view fade-up" },
      React.createElement(AdvisorChat, { tasks, notes, suggestions: all, onOpenTask: handlers.openTask }),

      React.createElement("div", { className: "sugg-section" },
        React.createElement("div", { className: "sugg-section-head" },
          React.createElement("span", { className: "section-label" }, "Suggestions"),
          React.createElement("span", { className: "sugg-sub" }, "synthesised from your tasks, notes & brain"),
          React.createElement("button", { className: "icon-btn", title: "Refresh", onClick: () => { setDismissed([]); setSeed((s) => s + 1); } },
            React.createElement(Icon.Repeat, { size: 14 }))
        ),
        suggestions.length === 0
          ? React.createElement("div", { className: "hero-empty", style: { marginBottom: 0 } }, "All clear — nothing needs your attention right now.")
          : suggestions.map((s) => React.createElement(SuggestionCard, { key: s.id, s, handlers: cardHandlers }))
      )
    )
  );
}

// ── Notes view ─────────────────────────────────────────────────────────
function NotesView({ notes, onNewNote, filterProps, filter }) {
  const Icon = window.Icon;
  const f = filter || { projects: [], areas: [] };
  const shown = notes.filter((n) => window.matchFilter(f, n.project, n.area));
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);
  const card = (n) =>
    React.createElement("div", { key: n.id, className: "note-card" },
      React.createElement("div", { className: "note-head" },
        React.createElement(window.PrefixBadge, { project: n.project }),
        React.createElement(window.AreaDot, { area: n.area, title: true }),
        n.pinned && React.createElement(Icon.StarFill, { size: 12, style: { color: "var(--amber)", marginLeft: 2 } }),
        React.createElement("span", { className: "note-at" }, n.at)
      ),
      React.createElement("div", { className: "note-title" }, n.title),
      React.createElement("div", { className: "note-body" }, n.body),
      n.tags && n.tags.length > 0 && React.createElement("div", { className: "note-tags" },
        n.tags.map((t) => React.createElement("span", { key: t, className: "ms-item" }, "#" + t)))
    );
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Notes"),
        React.createElement("span", { className: "sub" }, shown.length + " captured"),
        React.createElement("button", { className: "btn sm", style: { marginLeft: "auto" }, onClick: onNewNote },
          React.createElement(Icon.Plus, { size: 13 }), "New note")
      ),
      React.createElement(window.FilterBar, filterProps),
      shown.length === 0
        ? React.createElement("div", { className: "empty-state" },
            React.createElement("div", { className: "es-ico" }, React.createElement(Icon.Doc, { size: 28 })),
            React.createElement("div", { className: "es-title" }, "No notes here"),
            React.createElement("div", { className: "es-sub" }, "Switch the capture bar to Note and jot something — it lands here."))
        : React.createElement(React.Fragment, null,
            pinned.length > 0 && React.createElement("div", { className: "notes-grid" }, pinned.map(card)),
            pinned.length > 0 && rest.length > 0 && React.createElement("div", { className: "notes-divider" }),
            React.createElement("div", { className: "notes-grid" }, rest.map(card))
          )
    )
  );
}

// ── Completed view ─────────────────────────────────────────────────────
function CompletedView({ tasks, onOpen, filterProps, filter }) {
  const Icon = window.Icon;
  const f = filter || { projects: [], areas: [] };
  const done = tasks
    .filter((t) => t.status === "done" && window.matchFilter(f, t.project, t.area))
    .sort((a, b) => (b.done_at || 0) - (a.done_at || 0));
  const fmtWhen = (t) => (t.history && t.history.find((h) => h.to === "done") || {}).at || t.scheduled_for || "";
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Completed"),
        React.createElement("span", { className: "sub" }, done.length + " done")
      ),
      React.createElement(window.FilterBar, filterProps),
      done.length === 0
        ? React.createElement("div", { className: "empty-state" },
            React.createElement("div", { className: "es-ico" }, React.createElement(Icon.CheckCircle, { size: 28 })),
            React.createElement("div", { className: "es-title" }, "Nothing completed yet"),
            React.createElement("div", { className: "es-sub" }, "Finished tasks land here, newest first."))
        : React.createElement("div", { className: "list-block" },
            done.map((t) =>
              React.createElement("div", { key: t.id, className: "done-row", onClick: () => onOpen(t.id) },
                React.createElement("span", { className: "done-check" }, React.createElement(Icon.Check, { size: 13 })),
                React.createElement("span", { className: "done-title" }, t.title),
                React.createElement("div", { className: "t-meta" },
                  React.createElement(window.AreaDot, { area: t.area, title: true }),
                  React.createElement(window.PrefixBadge, { project: t.project }),
                  React.createElement("span", { className: "done-when" }, fmtWhen(t)))
              )
            )
          )
    )
  );
}

Object.assign(window, { AdvisorView, NotesView, CompletedView, buildSuggestions });
