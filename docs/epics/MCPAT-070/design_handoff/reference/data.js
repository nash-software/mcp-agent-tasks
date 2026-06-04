/* Life OS — mock data layer. Plain JS on window.LifeOS.
   Today is 2026-05-29 (Fri). All content is fabricated but believable. */
(function () {
  const TODAY = "2026-05-29";

  const areas = {
    client:    { label: "Client",    color: "#F59E0B" },
    personal:  { label: "Personal",  color: "#22C55E" },
    outsource: { label: "Outsource", color: "#8B5CF6" },
    internal:  { label: "Internal",  color: "#6B7280" },
  };

  const projects = [
    { prefix: "MCPAT", name: "MCP Agent Tasks", area: "internal", self: true },
    { prefix: "COND",  name: "Conductor",       area: "client" },
    { prefix: "HRLD",  name: "Herald",          area: "client" },
    { prefix: "ACR",   name: "Agent Control Room", area: "internal" },
    { prefix: "GEN",   name: "General",         area: "personal" },
  ];

  // ── Tasks ──────────────────────────────────────────────────────────────
  // status: queued | in_progress | done | blocked | cancelled
  // priority: critical | high | medium | low
  const tasks = [
    {
      id: "MCPAT-142", project: "MCPAT", area: "internal",
      title: "Rebuild Today view with peek panels & live capacity",
      status: "in_progress", priority: "high", estimate_hours: 2,
      scheduled_for: TODAY, claimed_at: Date.now() - 47 * 60 * 1000,
      why: "The capture loop is the whole product. The current view scans like a flat list — there's no single authoritative answer to 'what now'.",
      tags: ["ui", "core"], branch: "feat/today-rebuild", pr: "#214",
      commits: 6, spec_file: "src/ui/today-view-spec.md", plan_file: "plans/today.md",
      history: [
        { to: "queued", at: "2026-05-27 09:12" },
        { to: "in_progress", at: "2026-05-29 09:48" },
      ],
    },
    {
      id: "COND-88", project: "COND", area: "client",
      title: "Fix race when two workers claim the same job",
      status: "queued", priority: "critical", estimate_hours: 1,
      scheduled_for: TODAY,
      why: "Prod incident #44 — duplicate side-effects on retry. Client-facing.",
      tags: ["bug", "scheduler"], branch: "fix/claim-race", commits: 2,
      spec_file: "incidents/44.md",
      history: [{ to: "queued", at: "2026-05-29 07:30" }],
    },
    {
      id: "HRLD-31", project: "HRLD", area: "client",
      title: "Ship morning-briefing digest to Telegram",
      status: "queued", priority: "high", estimate_hours: 0.5,
      scheduled_for: TODAY,
      why: "nash-ai briefing has been silent for 3 days; client noticed.",
      tags: ["integration"], branch: "feat/tg-digest", commits: 4, pr: "#57",
      history: [{ to: "queued", at: "2026-05-28 18:02" }],
    },
    {
      id: "ACR-57", project: "ACR", area: "internal",
      title: "Add retry + backoff to failed agent dispatch",
      status: "queued", priority: "high", estimate_hours: 0.5,
      scheduled_for: TODAY,
      why: "One transient failure shouldn't kill a job. Exponential backoff, 3 tries.",
      tags: ["reliability"], branch: "feat/dispatch-retry", commits: 1,
      history: [{ to: "queued", at: "2026-05-29 08:10" }],
    },
    {
      id: "MCPAT-139", project: "MCPAT", area: "internal",
      title: "Wire Ctrl+Space global capture from any view",
      status: "queued", priority: "medium", estimate_hours: 0.5,
      scheduled_for: TODAY,
      why: "Capture must be sub-2s from anywhere or the whole thesis breaks.",
      tags: ["ux", "keyboard"], branch: "feat/global-capture", commits: 0,
      history: [{ to: "queued", at: "2026-05-29 08:40" }],
    },
    {
      id: "GEN-12", project: "GEN", area: "personal",
      title: "Renew domain & move DNS to Cloudflare",
      status: "queued", priority: "medium", estimate_hours: 0.25,
      scheduled_for: TODAY,
      why: "Expires in 6 days. Don't be the person whose domain lapsed.",
      tags: ["chore"],
      history: [{ to: "queued", at: "2026-05-26 21:15" }],
    },

    // ── Unscheduled candidates (scheduled_for: null) ──
    {
      id: "HRLD-34", project: "HRLD", area: "client",
      title: "Investigate webhook drops on Herald prod",
      status: "queued", priority: "high", estimate_hours: 1.5, scheduled_for: null,
      why: "~2% of events missing. Could be the same retry gap as ACR-57.",
      tags: ["bug"], history: [{ to: "queued", at: "2026-05-28 11:00" }],
    },
    {
      id: "COND-90", project: "COND", area: "client",
      title: "Draft Q3 SOW for Conductor renewal",
      status: "queued", priority: "medium", estimate_hours: 1, scheduled_for: null,
      tags: ["admin"], history: [{ to: "queued", at: "2026-05-27 16:20" }],
    },
    {
      id: "MCPAT-145", project: "MCPAT", area: "internal",
      title: "Command palette: fuzzy ranking + recent commands",
      status: "queued", priority: "medium", estimate_hours: 1, scheduled_for: null,
      why: "Empty palette on open is an anti-pattern — show recents.",
      tags: ["ux"], history: [{ to: "queued", at: "2026-05-28 09:05" }],
    },
    {
      id: "ACR-60", project: "ACR", area: "internal",
      title: "Surface ACR queue depth as a sparkline",
      status: "queued", priority: "low", estimate_hours: 1.5, scheduled_for: null,
      tags: ["observability"], history: [{ to: "queued", at: "2026-05-25 14:30" }],
    },
    {
      id: "HRLD-36", project: "HRLD", area: "outsource",
      title: "Hand Herald logo redraw to contractor",
      status: "queued", priority: "low", estimate_hours: 0.25, scheduled_for: null,
      why: "Not my craft. Write the brief, send the references, get out of the way.",
      tags: ["design", "delegate"], history: [{ to: "queued", at: "2026-05-24 10:00" }],
    },
    {
      id: "GEN-21", project: "GEN", area: "personal",
      title: "Plan Saturday trail run — pick route + check weather",
      status: "queued", priority: "low", estimate_hours: 0.25, scheduled_for: null,
      tags: ["life"], history: [{ to: "queued", at: "2026-05-28 22:10" }],
    },
    {
      id: "GEN-22", project: "GEN", area: "personal",
      title: "Read 'Thinking in Systems' — stock & flow chapter",
      status: "queued", priority: "low", estimate_hours: 0.75, scheduled_for: null,
      tags: ["reading"], history: [{ to: "queued", at: "2026-05-23 20:00" }],
    },

    // ── Signed off to the agent (agent_status: "scheduled") ──
    {
      id: "HRLD-40", project: "HRLD", area: "client",
      title: "Run full SEO audit on the Herald client site",
      status: "queued", priority: "high", estimate_hours: 1.5, scheduled_for: null,
      agent_status: "scheduled",
      why: "Client review on Monday — they'll ask about search visibility.",
      tags: ["seo", "audit", "client"], history: [{ to: "queued", at: "2026-05-29 07:50" }],
    },
    {
      id: "GEN-24", project: "GEN", area: "personal",
      title: "Generate this week's performance report across all client sites",
      status: "queued", priority: "medium", estimate_hours: 2, scheduled_for: null,
      agent_status: "scheduled",
      why: "I do this every Friday by hand — it's the same 2 hours each time.",
      tags: ["report", "weekly"], history: [{ to: "queued", at: "2026-05-29 08:00" }],
    },
    {
      id: "ACR-62", project: "ACR", area: "internal",
      title: "Scrape competitor changelogs into a weekly digest",
      status: "queued", priority: "low", estimate_hours: 1.5, scheduled_for: null,
      agent_status: "scheduled",
      tags: ["scrape", "weekly", "research"], history: [{ to: "queued", at: "2026-05-28 16:20" }],
    },
    {
      id: "COND-92", project: "COND", area: "client",
      title: "Approve Q3 SOW pricing before sending to client",
      status: "queued", priority: "high", estimate_hours: 0.5, scheduled_for: null,
      agent_status: "scheduled",
      why: "Numbers need a human call — margins are tight this quarter.",
      tags: ["sow", "pricing"], history: [{ to: "queued", at: "2026-05-29 09:10" }],
    },

    // ── Good agent candidates, not yet signed off ──
    {
      id: "MCPAT-148", project: "MCPAT", area: "internal",
      title: "Back up Postgres nightly and verify the restore",
      status: "queued", priority: "medium", estimate_hours: 1, scheduled_for: null,
      tags: ["backup", "reliability"], history: [{ to: "queued", at: "2026-05-27 19:00" }],
    },
    {
      id: "GEN-26", project: "GEN", area: "personal",
      title: "Weekly review — clean the board, plan next week",
      status: "queued", priority: "medium", estimate_hours: 0.5, scheduled_for: null,
      tags: ["ritual", "weekly"], history: [{ to: "queued", at: "2026-05-29 06:30" }],
    },

    // ── Blocked ──
    {
      id: "COND-86", project: "COND", area: "client",
      title: "Migrate Conductor DB to Postgres 16",
      status: "blocked", priority: "high", estimate_hours: 3, scheduled_for: null,
      why: "Waiting on the client's infra maintenance window (req. 2026-06-02).",
      block_reason: "Infra window not scheduled until June 2",
      tags: ["infra"], branch: "chore/pg16",
      history: [
        { to: "queued", at: "2026-05-20 10:00" },
        { to: "in_progress", at: "2026-05-22 13:30" },
        { to: "blocked", at: "2026-05-22 15:10" },
      ],
    },

    // ── Recently done (feed + board) ──
    {
      id: "MCPAT-138", project: "MCPAT", area: "internal",
      title: "Define color + type tokens for dark theme",
      status: "done", priority: "medium", estimate_hours: 1, scheduled_for: "2026-05-28",
      done_at: Date.now() - 3 * 60 * 1000, tags: ["design-system"],
      history: [{ to: "done", at: "2026-05-29 (3m ago)" }],
    },
    {
      id: "COND-85", project: "COND", area: "client",
      title: "Patch n+1 query on job-list endpoint",
      status: "done", priority: "high", estimate_hours: 1, scheduled_for: "2026-05-29",
      done_at: Date.now() - 41 * 60 * 1000, tags: ["perf"],
      history: [{ to: "done", at: "2026-05-29 (41m ago)" }],
    },
    {
      id: "GEN-9", project: "GEN", area: "personal",
      title: "Pay quarterly estimated taxes",
      status: "done", priority: "high", estimate_hours: 0.5, scheduled_for: "2026-05-29",
      done_at: Date.now() - 4 * 60 * 60 * 1000, tags: ["chore"],
      history: [{ to: "done", at: "2026-05-29 (4h ago)" }],
    },
    {
      id: "ACR-55", project: "ACR", area: "internal",
      title: "Persist agent job logs to disk",
      status: "done", priority: "medium", estimate_hours: 1.5, scheduled_for: "2026-05-27",
      tags: ["reliability"], history: [{ to: "done", at: "2026-05-27" }],
    },
  ];

  // ── Artifacts (files Claude created/edited, last 30 days) ──
  // staleness = days since last viewed
  const artifacts = [
    { name: "dns-migration-checklist.md", ext: "md", project: "GEN",
      path: "C:/code/notes/gen/dns-migration-checklist.md", days: 28, task_id: "GEN-12" },
    { name: "conductor-scheduler-notes.md", ext: "md", project: "COND",
      path: "C:/code/conductor/docs/scheduler-notes.md", days: 21, task_id: "COND-88" },
    { name: "briefing-digest.ts", ext: "ts", project: "HRLD",
      path: "C:/code/herald/src/jobs/briefing-digest.ts", days: 14, task_id: "HRLD-31" },
    { name: "herald-landing.html", ext: "html", project: "HRLD",
      path: "C:/code/herald/marketing/landing.html", days: 9 },
    { name: "acr-retry-plan.md", ext: "md", project: "ACR",
      path: "C:/code/acr/plans/retry-plan.md", days: 5, task_id: "ACR-57" },
    { name: "today-view-spec.md", ext: "md", project: "MCPAT",
      path: "C:/code/mcp-agent-tasks/src/ui/today-view-spec.md", days: 2, task_id: "MCPAT-142" },
    { name: "capacity-gauge.tsx", ext: "tsx", project: "MCPAT",
      path: "C:/code/mcp-agent-tasks/src/ui/components/capacity-gauge.tsx", days: 1, unvisited: true, task_id: "MCPAT-142" },
    { name: "area-map.json", ext: "json", project: "MCPAT",
      path: "C:/code/mcp-agent-tasks/config/area-map.json", days: 1, unvisited: true },
  ];

  // ── ACR (agent control room) jobs ──
  const acrJobs = [
    { id: "j1", title: "Regenerate Herald briefing template", status: "running", elapsed_s: 184, project: "HRLD" },
    { id: "j2", title: "Backfill embeddings for brain index", status: "running", elapsed_s: 742, project: "MCPAT" },
    { id: "j3", title: "Lint + typecheck MCPAT", status: "done", elapsed_s: 53, project: "MCPAT" },
    { id: "j4", title: "Deploy Conductor → staging", status: "pending", project: "COND" },
    { id: "j5", title: "Scrape competitor changelog", status: "failed", elapsed_s: 21, project: "GEN",
      error: "HTTP 403 from target host" },
  ];

  // ── Brain (semantic KB) corpus — searched client-side ──
  const brainCorpus = [
    { title: "Why we abandoned Notion", source: "journal/2026-03-11.md",
      text: "Structure-before-content: every capture forced a navigation decision. The friction killed it. Anything that asks 'where does this go' at capture time gets abandoned." },
    { title: "Capacity target rationale", source: "notes/working-hours.md",
      text: "6h of deep work is the honest daily ceiling. Past that, estimates lie and tomorrow borrows from today. Turn the gauge red over 100% — it should feel like a warning, not a goal." },
    { title: "Retry/backoff pattern", source: "patterns/dispatch.md",
      text: "Exponential backoff with jitter, cap at 3 attempts, then dead-letter. The same gap explains both ACR-57 and the Herald webhook drops." },
    { title: "Telegram briefing pipeline", source: "herald/briefing.md",
      text: "mcp-bridge-tasks (VPS:8091) feeds the nash-ai morning briefing. If the bridge is down the digest silently stops — add a heartbeat." },
    { title: "Postgres 16 migration plan", source: "conductor/pg16.md",
      text: "Logical replication, cut over in the client's maintenance window, keep 15 as warm standby for 48h. Blocked on infra scheduling." },
    { title: "The capture loop", source: "journal/2026-05-01.md",
      text: "Thought to captured in under two seconds, zero routing decision, then back to work. That loop is the entire product. Everything else is secondary." },
    { title: "Geist vs Inter for tooling", source: "design/type.md",
      text: "Geist reads as a real developer tool; Inter has become the default-app font. Mono pairing matters more than the sans for a dashboard." },
  ];

  // ── Recent activity (status transitions) ──
  const activity = [
    { id: "MCPAT-138", title: "Define color + type tokens for dark theme", to: "done", ago: "3m" },
    { id: "MCPAT-142", title: "Rebuild Today view with peek panels", to: "in_progress", ago: "47m" },
    { id: "COND-85", title: "Patch n+1 query on job-list endpoint", to: "done", ago: "41m" },
    { id: "HRLD-31", title: "Ship morning-briefing digest to Telegram", to: "queued", ago: "1h" },
    { id: "COND-86", title: "Migrate Conductor DB to Postgres 16", to: "blocked", ago: "2h" },
    { id: "GEN-9", title: "Pay quarterly estimated taxes", to: "done", ago: "4h" },
  ];

  // milestones for roadmap
  const milestones = [
    { project: "MCPAT", title: "Life OS v1 — the capture loop", progress: 0.72,
      due: "2026-06-06", items: ["Today rebuild", "Global capture", "Command palette", "Artifacts panel"] },
    { project: "HRLD", title: "Herald reliability sweep", progress: 0.4,
      due: "2026-06-13", items: ["Retry/backoff", "Webhook drops", "Briefing heartbeat"] },
    { project: "COND", title: "Conductor Q3 renewal", progress: 0.25,
      due: "2026-06-30", items: ["SOW draft", "pg16 migration", "Scheduler race fix"] },
  ];

  const config = {
    today: TODAY,
    daily_target_hours: 6,
    acr_online: true,
    brain_online: true,
    agent_daily_budget: 1,
  };

  // ── Skills / Automations library (reusable, agent-runnable) ──
  // match: lowercase substrings the triage classifier looks for in a task
  const skills = [
    { id: "sk-seo", name: "SEO Audit Suite", project: "—", engine: "acr",
      desc: "Lighthouse SEO + meta-tag, sitemap & broken-link pass, exported to a shareable report.",
      match: ["seo", "audit", "lighthouse", "meta tag", "sitemap", "search visibility"],
      runs: 12, minutesSaved: 540, lastRun: "2026-05-22", origin: "promoted from a task, Apr 14" },
    { id: "sk-brief", name: "Briefing Digest", project: "HRLD", engine: "n8n",
      desc: "Pulls overnight task + git activity and posts the nash-ai morning briefing to Telegram.",
      match: ["briefing", "digest", "telegram", "morning"],
      runs: 31, minutesSaved: 620, lastRun: "today 08:05", origin: "promoted from a task, Feb 02" },
    { id: "sk-deps", name: "Dependency Bump & Test", project: "—", engine: "acr",
      desc: "Bumps dependencies, runs the test + typecheck suite, opens a PR if green.",
      match: ["dependency", "deps", "bump", "upgrade", "npm audit"],
      runs: 9, minutesSaved: 270, lastRun: "2026-05-19", origin: "promoted from a task, Mar 30" },
    { id: "sk-relnotes", name: "Release Notes Draft", project: "—", engine: "hermes",
      desc: "Summarises merged PRs since the last tag into a changelog draft.",
      match: ["release notes", "changelog", "what's new"],
      runs: 6, minutesSaved: 180, lastRun: "2026-05-15", origin: "promoted from a task, Apr 28" },
  ];

  // ── Notes (captured thoughts, not yet tasks) ──
  const notes = [
    { id: "n1", project: "MCPAT", area: "internal", pinned: true,
      title: "Capture must never ask 'where does this go'",
      body: "Every routing decision at capture time is friction that kills the loop. Infer first, let the human correct after. This is the whole thesis.",
      tags: ["product", "principle"], at: "today 07:42" },
    { id: "n2", project: "COND", area: "client",
      title: "Client hinted at a second team for Q3",
      body: "On the renewal call — they mentioned onboarding a second pod. Could mean multi-tenant scheduling sooner than planned. Flag in the SOW.",
      tags: ["sales", "scheduler"], at: "yesterday 16:10" },
    { id: "n3", project: "HRLD", area: "client",
      title: "Briefing went silent — add a heartbeat",
      body: "If mcp-bridge-tasks (VPS:8091) drops, the digest stops with no error. A 1-line heartbeat ping would have caught the 3-day outage.",
      tags: ["reliability", "idea"], at: "2026-05-28" },
    { id: "n4", project: "GEN", area: "personal",
      title: "Idea: weekly review as a generated draft",
      body: "Instead of a blank page on Friday, have the advisor pre-fill what changed, what slipped, what's next. I edit instead of author.",
      tags: ["ritual", "idea"], at: "2026-05-27" },
    { id: "n5", project: "ACR", area: "internal",
      title: "Backoff + jitter, cap at 3, then dead-letter",
      body: "Same pattern fixes ACR-57 and the Herald webhook drops. Write it once as a shared dispatch util.",
      tags: ["pattern"], at: "2026-05-26" },
  ];

  // ── Agent activity log (what the agent has done for you) ──
  const agentLog = [
    { id: "al1", kind: "run", title: "Ran Briefing Digest for Herald", skill: "Briefing Digest",
      project: "HRLD", savedMin: 20, at: "today 08:05" },
    { id: "al2", kind: "research", title: "Scoped automation for “weekly client report”",
      project: "GEN", savedMin: 0, at: "yesterday 17:40" },
    { id: "al3", kind: "run", title: "Ran SEO Audit Suite on conductor.app", skill: "SEO Audit Suite",
      project: "COND", savedMin: 45, at: "2026-05-22" },
    { id: "al4", kind: "promote", title: "Promoted “Broken-link sweep” into SEO Audit Suite",
      project: "—", savedMin: 0, at: "2026-05-20" },
  ];

  window.LifeOS = { TODAY, areas, projects, tasks, artifacts, acrJobs, brainCorpus, activity, milestones, skills, agentLog, notes, config };
})();
