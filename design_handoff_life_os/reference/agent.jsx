/* Life OS — Agent: the signed-off work queue, triage, and automation flywheel.
   The agent only ever sees tasks you've signed off (agent_status set). It triages
   each into a bucket, runs what it can, and turns repeatable work into Skills. */

const BUCKET_ORDER = ["signoff", "automatable", "research", "recurring", "manual"];
const BUCKETS = {
  signoff:     { label: "Needs your sign-off", glyph: () => window.Icon.Lock,   color: "var(--amber)" },
  automatable: { label: "Automatable now",     glyph: () => window.Icon.Bolt,   color: "var(--green)" },
  research:    { label: "Worth automating",    glyph: () => window.Icon.Beaker, color: "var(--accent)" },
  recurring:   { label: "Recurring ritual",    glyph: () => window.Icon.Repeat, color: "var(--blue)" },
  manual:      { label: "One-off · manual",    glyph: () => window.Icon.Hand,   color: "var(--muted)" },
};

function matchSkill(task, skills) {
  const text = (task.title + " " + (task.tags || []).join(" ")).toLowerCase();
  return skills.find((s) => s.match.some((m) => text.includes(m)));
}

const SOFTWARE_RE = /\b(deploy|migrat|build|api|endpoint|bug|refactor|script|backup|database|db|crawl|scrape|test|ci|pipeline|audit|lighthouse|lint|typecheck|code|server|cron|postgres|webhook)\b/;
function isSoftware(task) { return SOFTWARE_RE.test((task.title + " " + (task.tags || []).join(" ") + " " + (task.why || "")).toLowerCase()); }
const VENUE = { acr: "on ACR", n8n: "via an n8n flow", hermes: "myself" };

// returns { bucket, skill?, action, rationale, acr? }
function triage(task, skills) {
  const text = (task.title + " " + (task.tags || []).join(" ") + " " + (task.why || "")).toLowerCase();
  const skill = matchSkill(task, skills);
  if (skill) return { bucket: "automatable", skill, action: "run",
    rationale: `Matches your “${skill.name}” skill — I'll run it ${VENUE[skill.engine] || "myself"} and hand you the output.` };
  if (/\b(sow|contract|approve|approval|decide|decision|sign off|pricing|invoice|client call|negotiat|hire|legal)\b/.test(text) || task.priority === "critical")
    return { bucket: "signoff", action: "approve",
      rationale: "This touches a client commitment or a judgement call. I won't act until you approve it." };
  if ((task.tags || []).includes("ritual") || /\b(weekly|daily|every (week|day|morning)|recurring|standup|review)\b/.test(text))
    return { bucket: "recurring", action: "schedule", acr: isSoftware(task),
      rationale: "Looks like something you repeat on a cadence — worth putting on a schedule so it just happens." };
  if (/\b(audit|report|check|scan|scrape|crawl|sync|generate|lint|test|backup|monitor|migrate|export|screenshot|benchmark|digest|compile)\b/.test(text)) {
    const sw = isSoftware(task);
    return { bucket: "research", action: "research", acr: sw,
      rationale: sw
        ? "No skill yet — and this is software work. I can scope it, and I'd likely hand execution to ACR."
        : "No skill yet, but it's repeatable. I can scope it and build an n8n flow so it runs itself." };
  }
  const sw = isSoftware(task);
  return { bucket: "manual", action: "assist", acr: sw,
    rationale: sw
      ? "One-off, but it's software — I can draft it, or hand it straight to ACR to execute."
      : "One-off — automating it would cost more than it saves. I can draft a first pass, but it's yours to own." };
}
function bucketOf(task, skills) { return triage(task, skills).bucket; }

function fmtSaved(min) {
  if (min < 60) return min + "m";
  const h = Math.round(min / 6) / 10;
  return h + "h";
}

// ── Agent control header ──────────────────────────────────────────────
function AgentControl({ skills, dailyBudget, jobsToday, runningCount, recommended, onSetBudget, onDispatch }) {
  const Icon = window.Icon;
  const savedTotal = skills.reduce((s, k) => s + k.minutesSaved, 0);
  const runsTotal = skills.reduce((s, k) => s + k.runs, 0);
  const budgetLeft = Math.max(0, dailyBudget - jobsToday);
  return (
    React.createElement("div", { className: "agent-control" },
      React.createElement("div", { className: "ac-left" },
        React.createElement("div", { className: "ac-avatar " + (runningCount ? "working" : "") },
          React.createElement(Icon.Robot, { size: 20 })),
        React.createElement("div", null,
          React.createElement("div", { className: "ac-state" },
            runningCount ? "Working — " + runningCount + " job" + (runningCount > 1 ? "s" : "") + " running"
              : budgetLeft > 0 ? "Idle — ready for today's job" : "Done for today",
            React.createElement("span", { className: "acr-link-chip", title: "Hermes has access to the ACR machine" },
              React.createElement(Icon.Server, { size: 10 }), "ACR")),
          React.createElement("div", { className: "ac-sub" },
            "Saved you ", React.createElement("b", null, fmtSaved(savedTotal)), " across ", runsTotal, " runs · ",
            React.createElement("span", { className: "mono" }, jobsToday + "/" + dailyBudget), " jobs today")
        )
      ),
      React.createElement("div", { className: "ac-right" },
        React.createElement("div", { className: "budget-stepper", title: "How many jobs the agent may run per day" },
          React.createElement("span", { className: "bs-label" }, "Daily budget"),
          React.createElement("button", { className: "bs-btn", onClick: () => onSetBudget(Math.max(0, dailyBudget - 1)) }, "−"),
          React.createElement("span", { className: "bs-val mono" }, dailyBudget),
          React.createElement("button", { className: "bs-btn", onClick: () => onSetBudget(dailyBudget + 1) }, "+")
        ),
        React.createElement("button", {
          className: "btn primary", disabled: !recommended || budgetLeft <= 0,
          style: (!recommended || budgetLeft <= 0) ? { opacity: 0.5, cursor: "not-allowed" } : undefined,
          onClick: onDispatch,
          title: recommended ? "Run: " + recommended.task.title : "Nothing queued to auto-run",
        }, React.createElement(Icon.Zap, { size: 14 }),
          budgetLeft <= 0 ? "Budget spent" : "Dispatch next job")
      )
    )
  );
}

// ── A triaged task card ───────────────────────────────────────────────
function AgentTaskCard({ task, tri, onAction, onOpen, onUnschedule }) {
  const Icon = window.Icon;
  const b = BUCKETS[tri.bucket];
  return (
    React.createElement("div", { className: "agent-card", "data-bucket": tri.bucket },
      React.createElement("div", { className: "agent-card-head" },
        React.createElement("span", { className: "bucket-badge", style: { color: b.color } },
          React.createElement(b.glyph(), { size: 13 }), b.label),
        React.createElement(PrefixBadge, { project: task.project }),
        React.createElement(AreaDot, { area: task.area, title: true }),
        React.createElement("button", { className: "agent-unschedule", title: "Remove from agent queue", onClick: () => onUnschedule(task) },
          React.createElement(Icon.X, { size: 13 }))
      ),
      React.createElement("div", { className: "agent-card-title", onClick: () => onOpen(task) }, task.title),
      React.createElement("div", { className: "agent-rationale" },
        React.createElement(Icon.Robot, { size: 13, style: { color: "var(--muted)", flexShrink: 0, marginTop: 1 } }),
        React.createElement("span", null, tri.rationale)),
      React.createElement("div", { className: "agent-card-actions" },
        tri.bucket === "automatable" && React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn sm primary", onClick: () => onAction("run", task, tri) },
            React.createElement(tri.skill.engine === "acr" ? Icon.Server : tri.skill.engine === "n8n" ? Icon.Repeat : Icon.Zap, { size: 13 }),
            tri.skill.engine === "acr" ? "Run on ACR" : tri.skill.engine === "n8n" ? "Run via n8n" : "Run " + tri.skill.name),
          React.createElement("span", { className: "skill-chip" }, React.createElement(Icon.Bolt, { size: 11 }), tri.skill.name + " · " + tri.skill.runs + " runs")),
        tri.bucket === "research" && React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn sm primary", onClick: () => onAction("research", task, tri) },
            React.createElement(Icon.Beaker, { size: 13 }), "Research automation"),
          tri.acr && React.createElement("button", { className: "btn sm", onClick: () => onAction("acr", task, tri), title: "Hand straight to ACR to execute once" },
            React.createElement(Icon.Server, { size: 13 }), "→ ACR")),
        tri.bucket === "recurring" && React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn sm", onClick: () => onAction("schedule", task, tri) },
            React.createElement(Icon.Repeat, { size: 13 }), "Put on a schedule"),
          tri.acr
            ? React.createElement("button", { className: "btn sm ghost", onClick: () => onAction("acr", task, tri) }, React.createElement(Icon.Server, { size: 13 }), "Run once on ACR")
            : React.createElement("button", { className: "btn sm ghost", onClick: () => onAction("assist", task, tri) }, "Run once")),
        tri.bucket === "signoff" && React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn sm", onClick: () => onAction("approve", task, tri) },
            React.createElement(Icon.Check, { size: 13 }), "Approve & dispatch"),
          React.createElement("button", { className: "btn sm ghost", onClick: () => onOpen(task) }, "Open")),
        tri.bucket === "manual" && React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn sm ghost", onClick: () => onAction("assist", task, tri) },
            React.createElement(Icon.Wand, { size: 13 }), "Draft a first pass"),
          tri.acr && React.createElement("button", { className: "btn sm", onClick: () => onAction("acr", task, tri), title: "Software work — hand it to ACR" },
            React.createElement(Icon.Server, { size: 13 }), "Put on ACR"))
      )
    )
  );
}

function RunningCard({ task }) {
  const Icon = window.Icon;
  const onAcr = task._via === "ACR";
  return (
    React.createElement("div", { className: "agent-card running" },
      React.createElement("div", { className: "agent-card-head" },
        React.createElement("span", { className: "bucket-badge", style: { color: "var(--blue)" } },
          React.createElement("span", { className: "bd-spinner", style: { width: 12, height: 12 } }),
          onAcr ? "Running on ACR" : "Hermes working"),
        React.createElement(PrefixBadge, { project: task.project })),
      React.createElement("div", { className: "agent-card-title" }, task.title),
      React.createElement("div", { className: "agent-run-stream mono" },
        onAcr ? "$ acr run — " + (task._runSkill || "job") + "  ·  streaming…" : "hermes · " + (task._runSkill || "working") + (task._via === "n8n" ? "  ·  n8n flow" : "") + "  ·  …")
    )
  );
}

function ProposalCard({ proposal, onPromote, onDismiss }) {
  const Icon = window.Icon;
  return (
    React.createElement("div", { className: "proposal-card" },
      React.createElement("div", { className: "agent-card-head" },
        React.createElement("span", { className: "bucket-badge", style: { color: "var(--accent)" } },
          React.createElement(Icon.Wand, { size: 13 }), "Automation proposal"),
        React.createElement(PrefixBadge, { project: proposal.project })),
      React.createElement("div", { className: "agent-card-title" }, "Turn this into a skill: ", React.createElement("b", null, proposal.skillName)),
      React.createElement("div", { className: "proposal-from" }, "from “" + proposal.taskTitle + "”"),
      React.createElement("div", { className: "proposal-summary" }, proposal.summary),
      React.createElement("div", { className: "proposal-steps" },
        proposal.steps.map((s, i) => React.createElement("div", { key: i, className: "p-step" },
          React.createElement("span", { className: "p-step-n mono" }, (i + 1)), s))),
      React.createElement("div", { className: "proposal-foot" },
        React.createElement("span", { className: "proposal-stat" }, "≈ ", React.createElement("b", null, fmtSaved(proposal.savedPerRun)), " saved / run"),
        React.createElement("span", { className: "proposal-stat" }, proposal.frequency),
        React.createElement("div", { style: { flex: 1 } }),
        React.createElement("button", { className: "btn sm ghost", onClick: () => onDismiss(proposal) }, "Dismiss"),
        React.createElement("button", { className: "btn sm primary", onClick: () => onPromote(proposal) },
          React.createElement(Icon.Plus, { size: 13 }), "Promote to skill")
      )
    )
  );
}

function SkillCard({ skill, onRun }) {
  const Icon = window.Icon;
  const eng = skill.engine || "hermes";
  const engLabel = eng === "acr" ? "ACR" : eng === "n8n" ? "n8n" : "Hermes";
  return (
    React.createElement("div", { className: "skill-card" },
      React.createElement("div", { className: "skill-ico" }, React.createElement(Icon.Bolt, { size: 16 })),
      React.createElement("div", { className: "skill-main" },
        React.createElement("div", { className: "skill-name" }, skill.name,
          React.createElement("span", { className: "engine-chip eng-" + eng }, React.createElement(eng === "acr" ? Icon.Server : eng === "n8n" ? Icon.Repeat : Icon.Robot, { size: 10 }), engLabel)),
        React.createElement("div", { className: "skill-desc" }, skill.desc),
        React.createElement("div", { className: "skill-meta mono" },
          skill.runs + " runs", React.createElement("span", { className: "dot-sep" }, "·"),
          fmtSaved(skill.minutesSaved) + " saved", React.createElement("span", { className: "dot-sep" }, "·"),
          "last " + skill.lastRun)
      )
    )
  );
}

function AgentLogRow({ e }) {
  const Icon = window.Icon;
  const ico = e.kind === "run" ? Icon.Zap : e.kind === "research" ? Icon.Beaker : Icon.Wand;
  const col = e.kind === "run" ? "var(--green)" : e.kind === "research" ? "var(--accent)" : "var(--blue)";
  return (
    React.createElement("div", { className: "agent-log-row" },
      React.createElement("span", { className: "alr-ico", style: { color: col } }, React.createElement(ico, { size: 13 })),
      React.createElement("span", { className: "alr-title" }, e.title),
      e.savedMin > 0 && React.createElement("span", { className: "alr-saved mono" }, "+" + fmtSaved(e.savedMin)),
      React.createElement("span", { className: "alr-at mono" }, e.at)
    )
  );
}

function Section({ label, n, children, hint }) {
  return React.createElement("div", { className: "agent-section" },
    React.createElement("div", { className: "agent-section-head" },
      React.createElement("span", { className: "section-label" }, label),
      n != null && React.createElement("span", { className: "asn mono" }, n),
      hint && React.createElement("span", { className: "agent-section-hint" }, hint)),
    children);
}

function AgentView({ tasks, skills, proposals, agentLog, dailyBudget, jobsToday, handlers }) {
  const Icon = window.Icon;
  const scheduled = tasks.filter((tk) => tk.agent_status && tk.agent_status !== "done" && tk.status !== "done");
  const running = scheduled.filter((tk) => tk.agent_status === "running");
  const proposalTaskIds = proposals.map((p) => p.taskId);
  const triaged = scheduled
    .filter((tk) => tk.agent_status === "scheduled" && !proposalTaskIds.includes(tk.id))
    .map((tk) => ({ task: tk, tri: triage(tk, skills) }));

  const byBucket = {};
  triaged.forEach((x) => { (byBucket[x.tri.bucket] = byBucket[x.tri.bucket] || []).push(x); });
  const recommended = (byBucket.automatable && byBucket.automatable[0]) || null;

  const empty = scheduled.length === 0 && proposals.length === 0;

  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Hermes"),
        React.createElement("span", { className: "sub" }, "Your assistant — triages, automates, and hands software work to ACR")
      ),
      React.createElement(AgentControl, {
        skills, dailyBudget, jobsToday, runningCount: running.length, recommended,
        onSetBudget: handlers.setBudget, onDispatch: () => recommended && handlers.run(recommended.task, recommended.tri),
      }),

      empty && React.createElement("div", { className: "agent-empty" },
        React.createElement("div", { className: "es-ico" }, React.createElement(Icon.Robot, { size: 30 })),
        React.createElement("div", { className: "es-title" }, "Nothing signed off yet"),
        React.createElement("div", { className: "es-sub" },
          "Sign a task off from the Board, Today, or any task menu and it lands here. Hermes only ever touches what you've explicitly handed him.")
      ),

      running.length > 0 && React.createElement(Section, { label: "Working now", n: running.length },
        running.map((tk) => React.createElement(RunningCard, { key: tk.id, task: tk }))
      ),

      proposals.length > 0 && React.createElement(Section, { label: "Automation proposals", n: proposals.length, hint: "review → promote to a reusable skill" },
        proposals.map((p) => React.createElement(ProposalCard, { key: p.id, proposal: p, onPromote: handlers.promote, onDismiss: handlers.dismiss }))
      ),

      BUCKET_ORDER.filter((bk) => byBucket[bk] && byBucket[bk].length).map((bk) =>
        React.createElement(Section, { key: bk, label: BUCKETS[bk].label, n: byBucket[bk].length },
          byBucket[bk].map(({ task, tri }) =>
            React.createElement(AgentTaskCard, {
              key: task.id, task, tri, onAction: handlers.action, onOpen: handlers.openTask, onUnschedule: handlers.unschedule,
            })
          )
        )
      ),

      React.createElement("div", { className: "agent-section" },
        React.createElement("div", { className: "agent-section-head" },
          React.createElement("span", { className: "section-label" }, "Skills & automations"),
          React.createElement("span", { className: "asn mono" }, skills.length),
          React.createElement("span", { className: "agent-section-hint" }, "your recurring work, absorbed — Don't Repeat Yourself")),
        React.createElement("div", { className: "skill-grid" },
          skills.map((s) => React.createElement(SkillCard, { key: s.id, skill: s, onRun: handlers.runSkillDirect }))
        )
      ),

      agentLog.length > 0 && React.createElement(Section, { label: "Agent log", hint: "what it's done for you" },
        React.createElement("div", { className: "agent-log" },
          agentLog.slice(0, 8).map((e) => React.createElement(AgentLogRow, { key: e.id, e }))
        )
      )
    )
  );
}

Object.assign(window, { AgentView, triage, bucketOf, matchSkill, BUCKETS });
