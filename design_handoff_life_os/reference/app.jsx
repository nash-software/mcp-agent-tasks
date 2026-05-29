/* Life OS — App shell, state, keyboard, routing, capture bar, tweaks */

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const LS = window.LifeOS;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "heroVariant": "signal",
  "capacityStyle": "bar",
  "accent": "#0070F3",
  "font": "geist",
  "density": "balanced",
  "acrOnline": true,
  "brainOnline": true
}/*EDITMODE-END*/;

const NAV = [
  { id: "today", label: "Today", icon: () => React.createElement(window.Icon.Sun, { size: 16 }), kbd: "1" },
  { id: "board", label: "Board", icon: () => React.createElement(window.Icon.Board, { size: 16 }), kbd: "2" },
  { id: "agent", label: "Hermes", icon: () => React.createElement(window.Icon.Robot, { size: 16 }), kbd: "3" },
  { id: "braindump", label: "Brain dump", icon: () => React.createElement(window.Icon.Brain, { size: 16 }), kbd: "4" },
  { id: "artifacts", label: "Artifacts", icon: () => React.createElement(window.Icon.Files, { size: 16 }), kbd: "5" },
  { id: "roadmap", label: "Roadmap", icon: () => React.createElement(window.Icon.Map, { size: 16 }), kbd: "6" },
  { id: "activity", label: "Activity", icon: () => React.createElement(window.Icon.Activity, { size: 16 }), kbd: "7" },
];

let captureSeq = 1;

// ── automation-proposal helpers (the flywheel) ──
const STOP = new Set(["this","week's","weeks","week","across","all","the","into","and","with","from","that","your","for","run","new"]);
function keyTokens(title) {
  return title.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 4);
}
function proposeSkillName(task) {
  const t = task.title.toLowerCase();
  if (/report/.test(t)) return "Client Performance Report";
  if (/scrape|changelog|crawl/.test(t)) return "Changelog Scraper";
  if (/backup|restore/.test(t)) return "DB Backup & Verify";
  if (/audit|seo/.test(t)) return "Site Audit Pass";
  if (/screenshot/.test(t)) return "Screenshot Pipeline";
  if (/lint|typecheck|test/.test(t)) return "Lint & Test Gate";
  return task.title.split(/\s+/).slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function deriveSteps(task) {
  const t = task.title.toLowerCase();
  if (/report/.test(t)) return ["Pull metrics from each client site's analytics", "Diff against last week, flag regressions", "Render a one-page report + post to the project channel"];
  if (/scrape|changelog|crawl/.test(t)) return ["Fetch each competitor's changelog / RSS", "Extract + summarise what actually changed", "Compile into a weekly digest artifact"];
  if (/backup|restore/.test(t)) return ["Snapshot the database", "Restore into a scratch instance", "Verify row counts + integrity, alert on any drift"];
  if (/audit|seo/.test(t)) return ["Crawl the target site", "Run Lighthouse + meta/sitemap/broken-link checks", "Export a shareable findings report"];
  return ["Capture the inputs you normally provide", "Run the core steps headlessly in an ACR sandbox", "Hand back the output as an artifact for review"];
}
function makeProposal(task) {
  const skillName = proposeSkillName(task);
  const software = /\b(deploy|migrat|build|api|endpoint|bug|refactor|script|backup|database|\bdb\b|crawl|scrape|test|ci|pipeline|audit|lighthouse|lint|typecheck|code|server|cron)\b/.test((task.title + " " + (task.tags || []).join(" ")).toLowerCase());
  const engine = software ? "acr" : "n8n";
  return {
    id: "prop" + Date.now(), taskId: task.id, taskTitle: task.title, project: task.project, skillName, engine,
    summary: software
      ? "This is software work, so I'd wrap it as a skill and run it on ACR — same inputs, same output, on demand or on a schedule. You'd never run it by hand again."
      : "I'd build this as an n8n flow and run it myself — same inputs, same output, on demand or on a schedule. You'd never run it by hand again.",
    steps: deriveSteps(task),
    savedPerRun: task.estimate_hours ? Math.round(task.estimate_hours * 60) : 60,
    frequency: /week|weekly|friday|monday/.test(task.title.toLowerCase()) ? "likely weekly" : "ad-hoc, recurring",
    matchSeed: keyTokens(task.title),
  };
}

function CaptureBar({ onCapture, onExpand, registerFocus }) {
  const Icon = window.Icon;
  const [val, setVal] = useState("");
  const [flash, setFlash] = useState(false);
  const [recording, setRecording] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { registerFocus(() => inputRef.current && inputRef.current.focus()); }, []);

  const projMatches = useMemo(() => {
    const m = val.match(/#(\w*)$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    return PROJECTS.filter((p) => p.prefix.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [val]);
  const [acSel, setAcSel] = useState(0);
  useEffect(() => setAcSel(0), [val]);

  const submit = () => {
    const text = val.trim();
    if (!text) return;
    const m = text.match(/^#(\w+)\s+(.*)/);
    let project = "GEN", title = text;
    if (m) { const p = PROJECTS.find((x) => x.prefix.toLowerCase() === m[1].toLowerCase()); if (p) { project = p.prefix; title = m[2]; } }
    onCapture(title, project);
    setVal(""); setFlash(true); setTimeout(() => setFlash(false), 600);
  };

  const pickProj = (p) => {
    setVal(val.replace(/#\w*$/, "#" + p.prefix + " "));
    inputRef.current && inputRef.current.focus();
  };

  const onKey = (e) => {
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onExpand(val); setVal(""); return; }
    if (projMatches && projMatches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAcSel((s) => Math.min(s + 1, projMatches.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAcSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && val.match(/#\w*$/))) { e.preventDefault(); pickProj(projMatches[acSel]); return; }
    }
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };

  const voice = () => { setRecording(true); setTimeout(() => { setRecording(false); }, 1400); };

  return (
    React.createElement("header", { className: "capture-bar" },
      React.createElement("div", { className: "capture-brand" },
        React.createElement("div", { className: "logo" }),
        React.createElement("div", { className: "name" }, "Life", React.createElement("span", null, "OS"))
      ),
      React.createElement("div", { className: "capture-input-wrap" },
        React.createElement("span", { className: "lead" }, React.createElement(Icon.Plus, { size: 15 })),
        React.createElement("input", {
          ref: inputRef, className: "capture-input",
          placeholder: "Capture anything — Enter to save · \u21e7Enter for Brain Dump · #project",
          value: val, onChange: (e) => setVal(e.target.value), onKeyDown: onKey,
        }),
        flash && React.createElement("span", { className: "capture-flash" },
          React.createElement(Icon.Check, { size: 14 }), "Captured"),
        !flash && React.createElement("span", { className: "capture-hint" }, React.createElement("kbd", null, "Ctrl"), React.createElement("kbd", null, "Space")),
        React.createElement("button", { className: "expand-btn", onClick: () => { onExpand(val); setVal(""); }, title: "Open in Brain Dump (\u21e7Enter)" },
          React.createElement(Icon.Expand, { size: 15 })),
        React.createElement("button", { className: "mic-btn " + (recording ? "recording" : ""), onClick: voice, title: "Voice capture" },
          React.createElement(Icon.Mic, { size: 15 })),
        projMatches && projMatches.length > 0 && React.createElement("div", { className: "capture-ac" },
          projMatches.map((p, i) =>
            React.createElement("div", { key: p.prefix, className: "ac-row " + (i === acSel ? "sel" : ""),
              onMouseEnter: () => setAcSel(i), onClick: () => pickProj(p) },
              React.createElement("span", { className: "ac-prefix" }, "#" + p.prefix),
              React.createElement("span", { className: "ac-name" }, p.name),
              React.createElement(AreaDot, { area: p.area })
            )
          )
        )
      )
    )
  );
}

function RowMenu({ menu, onClose, onAction }) {
  useEffect(() => {
    if (!menu) return;
    const h = () => onClose();
    window.addEventListener("click", h);
    window.addEventListener("scroll", h, true);
    return () => { window.removeEventListener("click", h); window.removeEventListener("scroll", h, true); };
  }, [menu]);
  if (!menu) return null;
  const t = menu.task;
  const items = [
    t.scheduled_for === LS.TODAY ? { k: "uncommit", label: "Remove from today" } : { k: "commit", label: "Commit to today" },
    t.agent_status ? { k: "unagent", label: "Remove from Hermes" } : { k: "agent", label: "Sign off to Hermes" },
    { k: "acr", label: "Dispatch to ACR" },
    { k: "done", label: "Mark done" },
    { k: "detail", label: "Open detail" },
  ];
  return React.createElement("div", {
    style: { position: "fixed", top: menu.y, left: Math.min(menu.x, window.innerWidth - 200), zIndex: 90,
      background: "var(--s1)", border: "1px solid var(--s3)", borderRadius: 8, padding: 4, minWidth: 180, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" },
    onClick: (e) => e.stopPropagation(),
  },
    items.map((it) => React.createElement("div", {
      key: it.k, className: "cmdk-row",
      onClick: () => { onAction(it.k, t); onClose(); },
    }, React.createElement("span", { className: "cl", style: { fontSize: 13 } }, it.label)))
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tasks, setTasks] = useState(() => LS.tasks.map((x) => ({ ...x })));
  const [view, setView] = useState(() => localStorage.getItem("lifeos-view") || "today");
  const [selectedId, setSelectedId] = useState(null);
  const [panel, setPanel] = useState(null); // {mode, taskId}
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [target, setTargetState] = useState(() => parseFloat(localStorage.getItem("lifeos-target")) || LS.config.daily_target_hours);
  const [toast, setToast] = useState(null);
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState(null);
  const [acrJob, setAcrJob] = useState(null);
  const [acrJobs, setAcrJobs] = useState(() => LS.acrJobs.map((j) => ({ ...j })));
  const [animMap, setAnimMap] = useState({});
  const [filter, setFilter] = useState(() => { try { return JSON.parse(localStorage.getItem("lifeos-filter")) || { projects: [], areas: [] }; } catch (e) { return { projects: [], areas: [] }; } });
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem("lifeos-favs")) || ["MCPAT", "COND"]; } catch (e) { return ["MCPAT", "COND"]; } });
  const [bdSeed, setBdSeed] = useState(null);
  const [skills, setSkills] = useState(() => LS.skills.map((s) => ({ ...s })));
  const [proposals, setProposals] = useState([]);
  const [agentLog, setAgentLog] = useState(() => LS.agentLog.map((e) => ({ ...e })));
  const [dailyBudget, setDailyBudget] = useState(() => parseInt(localStorage.getItem("lifeos-budget"), 10) || LS.config.agent_daily_budget);
  const [jobsToday, setJobsToday] = useState(0);
  const captureFocusRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => { localStorage.setItem("lifeos-view", view); }, [view]);
  useEffect(() => { localStorage.setItem("lifeos-filter", JSON.stringify(filter)); }, [filter]);
  useEffect(() => { localStorage.setItem("lifeos-favs", JSON.stringify(favorites)); }, [favorites]);

  const toggleFilterProject = (p) => setFilter((f) => ({ ...f, projects: f.projects.includes(p) ? f.projects.filter((x) => x !== p) : [...f.projects, p] }));
  const toggleFilterArea = (a) => setFilter((f) => ({ ...f, areas: f.areas.includes(a) ? f.areas.filter((x) => x !== a) : [...f.areas, a] }));
  const clearFilter = () => setFilter({ projects: [], areas: [] });
  const toggleFav = (p) => setFavorites((fs) => fs.includes(p) ? fs.filter((x) => x !== p) : [...fs, p]);
  const setTarget = (v) => { setTargetState(v); localStorage.setItem("lifeos-target", String(v)); };
  const showToast = useCallback((msg) => {
    setToast(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // root attributes for tweaks
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent", t.accent);
    // derive hover
    r.style.setProperty("--accent-hover", t.accent);
    r.setAttribute("data-font", t.font);
    r.setAttribute("data-density", t.density);
  }, [t.accent, t.font, t.density]);

  const config = { ...LS.config, acr_online: t.acrOnline, brain_online: t.brainOnline };

  // open-task counts per project (for sidebar + fav chips)
  const projectCounts = useMemo(() => {
    const m = {};
    tasks.forEach((tk) => { if (tk.status !== "done" && tk.status !== "cancelled") m[tk.project] = (m[tk.project] || 0) + 1; });
    return m;
  }, [tasks]);

  const filterProps = {
    filter, favorites, projectCounts,
    onToggleProject: toggleFilterProject, onToggleArea: toggleFilterArea,
    onToggleFav: toggleFav, onClear: clearFilter,
  };

  const openBrainDump = (seedText) => { setBdSeed({ text: (seedText || "").trim(), nonce: Date.now() }); setView("braindump"); setPanel(null); };

  // ── task ordering for keyboard nav on today ──
  const visibleIds = useMemo(() => {
    if (view !== "today") return [];
    const committed = tasks.filter((x) => x.scheduled_for === LS.TODAY && x.status !== "in_progress" && x.status !== "cancelled")
      .sort((a, b) => ((a.status === "done") - (b.status === "done")) || PRI_RANK[a.priority] - PRI_RANK[b.priority]);
    const cands = tasks.filter((x) => x.scheduled_for == null && x.status === "queued");
    const order = ["client", "personal", "internal", "outsource"];
    const candSorted = order.flatMap((ar) => cands.filter((c) => c.area === ar).sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]));
    return [...committed, ...candSorted].map((x) => x.id);
  }, [tasks, view]);

  const taskById = useCallback((id) => tasks.find((x) => x.id === id), [tasks]);

  // ── animations helper ──
  const flagAnim = (id, cls, dur) => {
    setAnimMap((m) => ({ ...m, [id]: cls }));
    setTimeout(() => setAnimMap((m) => { const n = { ...m }; delete n[id]; return n; }), dur);
  };

  // ── task mutations ──
  const mutate = (id, patch) => setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const commit = (task) => {
    flagAnim(task.id, "row-anim-enter", 360);
    mutate(task.id, { scheduled_for: LS.TODAY });
    showToast("Committed to today · " + task.id);
  };
  const uncommit = (task) => { mutate(task.id, { scheduled_for: null }); showToast("Removed from today · " + task.id); };
  const markDone = (task) => {
    mutate(task.id, { status: "done", done_at: Date.now(), claimed_at: undefined });
    showToast("Done · " + task.id);
    if (panel && panel.taskId === task.id) setPanel(null);
  };
  const pause = (task) => { mutate(task.id, { status: "queued", claimed_at: undefined }); showToast("Paused · back to queue"); };
  const block = (task) => {
    const reason = prompt("Block reason:", "Waiting on…");
    if (reason == null) return;
    mutate(task.id, { status: "blocked", block_reason: reason, claimed_at: undefined });
    showToast("Blocked · " + task.id);
  };
  const cyclePriority = (task) => {
    const order = ["critical", "high", "medium", "low"];
    const next = order[(order.indexOf(task.priority) + 1) % order.length];
    mutate(task.id, { priority: next }); showToast("Priority → " + next);
  };
  const sendAcr = (task) => showToast(config.acr_online ? "Dispatched to ACR · " + task.id : "ACR offline — can't dispatch");

  const openPeek = (task) => { setSelectedId(task.id); setPanel({ mode: "peek", taskId: task.id }); };
  const openDetail = (task) => { setSelectedId(task.id); setPanel({ mode: "detail", taskId: task.id }); };
  const openMenu = (task, e) => { setMenu({ task, x: e.clientX, y: e.clientY }); };

  // ── agent flywheel ──
  const setBudget = (n) => { setDailyBudget(n); localStorage.setItem("lifeos-budget", String(n)); };
  const logAdd = (entry) => setAgentLog((l) => [{ id: "al" + Date.now() + Math.random(), ...entry }, ...l]);
  const scheduleForAgent = (task) => {
    flagAnim(task.id, "row-anim-enter", 360);
    mutate(task.id, { agent_status: "scheduled" });
    showToast("Signed off to agent · " + task.id);
  };
  const unscheduleAgent = (task) => { mutate(task.id, { agent_status: undefined }); showToast("Removed from agent queue · " + task.id); };

  const runSkill = (task, skill) => {
    setJobsToday((n) => n + 1);
    if (skill.engine === "acr") {
      // software work → Hermes hands it to the ACR machine
      mutate(task.id, { agent_status: "running", _runSkill: skill.name, _via: "ACR" });
      const jobId = "acr" + Date.now();
      setAcrJobs((js) => [{ id: jobId, title: skill.name + " · " + task.project, status: "running", elapsed_s: 0, project: task.project, hermes: true }, ...js]);
      showToast("Hermes → ACR · running “" + skill.name + "”");
      setTimeout(() => {
        const saved = 20 + Math.round(Math.random() * 35);
        setSkills((ks) => ks.map((k) => (k.id === skill.id ? { ...k, runs: k.runs + 1, minutesSaved: k.minutesSaved + saved, lastRun: "just now" } : k)));
        setAcrJobs((js) => js.map((j) => (j.id === jobId ? { ...j, status: "done", elapsed_s: 40 + Math.round(Math.random() * 70) } : j)));
        mutate(task.id, { agent_status: "done", status: "done", done_at: Date.now(), _runSkill: undefined, _via: undefined });
        logAdd({ kind: "run", title: "Ran " + skill.name + " on ACR for " + task.project, skill: skill.name, project: task.project, savedMin: saved, at: "just now" });
        showToast("ACR finished · " + skill.name + " saved ~" + saved + "m");
      }, 2400);
    } else {
      // Hermes runs it himself (n8n flow / native)
      const via = skill.engine === "n8n" ? "n8n" : "Hermes";
      mutate(task.id, { agent_status: "running", _runSkill: skill.name, _via: via });
      showToast("Hermes running “" + skill.name + "”" + (skill.engine === "n8n" ? " via n8n" : ""));
      setTimeout(() => {
        const saved = 15 + Math.round(Math.random() * 25);
        setSkills((ks) => ks.map((k) => (k.id === skill.id ? { ...k, runs: k.runs + 1, minutesSaved: k.minutesSaved + saved, lastRun: "just now" } : k)));
        mutate(task.id, { agent_status: "done", status: "done", done_at: Date.now(), _runSkill: undefined, _via: undefined });
        logAdd({ kind: "run", title: "Hermes ran " + skill.name + (skill.engine === "n8n" ? " (n8n)" : "") + " for " + task.project, skill: skill.name, project: task.project, savedMin: saved, at: "just now" });
        showToast("Hermes finished · " + skill.name + " saved ~" + saved + "m");
      }, 1700);
    }
  };

  // Hermes hands a raw task to the ACR machine for execution
  const dispatchToACR = (task, fromHermes) => {
    if (fromHermes) mutate(task.id, { agent_status: "running", _runSkill: "ACR" });
    const jobId = "acr" + Date.now();
    setAcrJobs((js) => [{ id: jobId, title: task.title.slice(0, 42) + " · " + task.project, status: "running", elapsed_s: 0, project: task.project, hermes: fromHermes }, ...js]);
    showToast((fromHermes ? "Hermes → ACR · " : "Dispatched to ACR · ") + task.id);
    setTimeout(() => {
      setAcrJobs((js) => js.map((j) => (j.id === jobId ? { ...j, status: "done", elapsed_s: 50 + Math.round(Math.random() * 90) } : j)));
      mutate(task.id, { agent_status: fromHermes ? "done" : task.agent_status, status: "done", done_at: Date.now(), _runSkill: undefined });
      logAdd({ kind: "run", title: "ACR executed “" + task.title.slice(0, 34) + "”", project: task.project, savedMin: task.estimate_hours ? Math.round(task.estimate_hours * 60) : 30, at: "just now" });
      showToast("ACR finished · " + task.id);
    }, 2600);
  };

  const researchAutomation = (task) => {
    mutate(task.id, { agent_status: "running", _runSkill: "research" });
    setJobsToday((n) => n + 1);
    showToast("Agent researching: could this be automated?");
    setTimeout(() => {
      setProposals((ps) => [makeProposal(task), ...ps]);
      mutate(task.id, { agent_status: "scheduled", _runSkill: undefined });
      logAdd({ kind: "research", title: "Scoped automation for “" + task.title.slice(0, 38) + "”", project: task.project, savedMin: 0, at: "just now" });
      showToast("Proposal ready — review & promote");
    }, 2100);
  };

  const promoteProposal = (prop) => {
    const match = Array.from(new Set([...proposeSkillName({ title: prop.skillName }).toLowerCase().split(/\s+/).filter((w) => w.length > 3), ...prop.matchSeed]));
    const newSkill = { id: "sk" + Date.now(), name: prop.skillName, project: prop.project, desc: prop.summary,
      match, runs: 0, minutesSaved: 0, lastRun: "never", engine: prop.engine || "hermes", origin: "promoted from " + prop.taskId };
    setSkills((ks) => [newSkill, ...ks]);
    setProposals((ps) => ps.filter((p) => p.id !== prop.id));
    logAdd({ kind: "promote", title: "Promoted “" + prop.skillName + "” to a skill", project: prop.project, savedMin: 0, at: "just now" });
    showToast("New skill: " + prop.skillName + " — future matches will auto-run");
  };
  const dismissProposal = (prop) => { setProposals((ps) => ps.filter((p) => p.id !== prop.id)); showToast("Proposal dismissed"); };

  const agentAction = (action, task, tri) => {
    if (action === "run") runSkill(task, tri.skill);
    else if (action === "acr") dispatchToACR(task, true);
    else if (action === "research") researchAutomation(task);
    else if (action === "approve") {
      mutate(task.id, { agent_status: "done", status: "done", done_at: Date.now() });
      logAdd({ kind: "run", title: "Handled (approved) " + task.title.slice(0, 38), project: task.project, savedMin: task.estimate_hours ? Math.round(task.estimate_hours * 60) : 30, at: "just now" });
      showToast("Approved & dispatched · " + task.id);
    } else if (action === "schedule") {
      mutate(task.id, { agent_status: "done", recurring: true });
      logAdd({ kind: "promote", title: "Put “" + task.title.slice(0, 34) + "” on a weekly schedule", project: task.project, savedMin: 0, at: "just now" });
      showToast("Scheduled weekly · " + task.id);
    } else if (action === "assist") {
      showToast("Agent drafting a first pass…");
      setTimeout(() => {
        logAdd({ kind: "run", title: "Drafted a first pass for " + task.title.slice(0, 34), project: task.project, savedMin: 15, at: "just now" });
        showToast("Draft ready · saved ~15m");
      }, 1400);
    }
  };

  const agentHandlers = {
    setBudget, action: agentAction, promote: promoteProposal, dismiss: dismissProposal,
    unschedule: unscheduleAgent, openTask: (task) => openDetail(task),
    run: (task, tri) => tri.skill && runSkill(task, tri.skill),
    runSkillDirect: (skill) => showToast("Sign a matching task off to run " + skill.name),
  };

  const captureTask = (title, project) => {
    const proj = projById[project] || projById.GEN;
    const id = project + "-NEW" + captureSeq++;
    const nt = { id, project, area: proj.area, title, status: "queued", priority: "medium", scheduled_for: null, estimate_hours: null, history: [{ to: "queued", at: "just now" }], tags: [] };
    setTasks((ts) => [nt, ...ts]);
  };

  const createFromCandidates = (cands) => {
    const nts = cands.map((c, i) => ({
      id: c.project + "-NEW" + captureSeq++, project: c.project, area: c.area, title: c.title,
      status: "queued", priority: "medium", scheduled_for: null, estimate_hours: null,
      why: c.why || undefined, history: [{ to: "queued", at: "just now" }], tags: [],
    }));
    setTasks((ts) => [...nts, ...ts]);
    showToast(nts.length + " task" + (nts.length === 1 ? "" : "s") + " created");
  };

  const panelAction = (action, task) => {
    if (action === "done") markDone(task);
    else if (action === "commit") commit(task);
    else if (action === "uncommit") uncommit(task);
    else if (action === "acr") dispatchToACR(task, false);
    else if (action === "agent") scheduleForAgent(task);
    else if (action === "unagent") unscheduleAgent(task);
    else if (action === "detail") openDetail(task);
  };

  const navigateToTask = (id) => {
    setView("today"); setSelectedId(id);
    const tk = taskById(id);
    if (tk) setPanel({ mode: "detail", taskId: id });
  };

  // ── global keyboard ──
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const h = (e) => {
      // Ctrl+Space — focus capture (works even while typing)
      if (e.ctrlKey && e.code === "Space") { e.preventDefault(); captureFocusRef.current && captureFocusRef.current(); return; }
      // Cmd/Ctrl+K — palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen((o) => !o); return; }
      if (cmdkOpen) return;
      if (isTyping()) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      // number keys -> nav
      if (!e.metaKey && !e.ctrlKey && /^[1-7]$/.test(e.key)) { const n = NAV[parseInt(e.key, 10) - 1]; if (n) { setView(n.id); setPanel(null); } return; }
      if (e.key === "Escape") { if (panel) setPanel(null); else if (focus) setFocus(false); return; }
      if (e.key === "." ) { setFocus((f) => !f); return; }

      if (view !== "today") return;
      const ids = visibleIds;
      const cur = ids.indexOf(selectedId);
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") { e.preventDefault(); const ni = cur < 0 ? 0 : Math.min(cur + 1, ids.length - 1); setSelectedId(ids[ni]); if (panel) setPanel((p) => ({ ...p, taskId: ids[ni] })); }
      else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") { e.preventDefault(); const ni = cur <= 0 ? 0 : cur - 1; setSelectedId(ids[ni]); if (panel) setPanel((p) => ({ ...p, taskId: ids[ni] })); }
      else if (e.code === "Space" && selectedId) { e.preventDefault(); const tk = taskById(selectedId); if (tk) setPanel({ mode: "peek", taskId: selectedId }); }
      else if (e.key === "Enter" && selectedId) { e.preventDefault(); setPanel({ mode: "detail", taskId: selectedId }); }
      else if ((e.key === "d" || e.key === "D") && selectedId) { const tk = taskById(selectedId); if (tk) markDone(tk); }
      else if ((e.key === "p" || e.key === "P") && selectedId) { const tk = taskById(selectedId); if (tk) cyclePriority(tk); }
      else if ((e.key === "t" || e.key === "T") && selectedId) { const tk = taskById(selectedId); if (tk) (tk.scheduled_for === LS.TODAY ? uncommit(tk) : commit(tk)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [view, selectedId, visibleIds, panel, focus, cmdkOpen, tasks]);

  // ── command palette commands ──
  const buildCommands = useCallback(() => {
    const Icon = window.Icon;
    const cmds = [];
    const sel = selectedId ? taskById(selectedId) : null;
    if (sel) {
      cmds.push({ id: "c-done", cat: "Selected task", label: "Mark done", sub: sel.id, icon: Icon.Check, kbd: "D", run: () => markDone(sel) });
      cmds.push({ id: "c-commit", cat: "Selected task", label: sel.scheduled_for === LS.TODAY ? "Remove from today" : "Commit to today", sub: sel.id, icon: Icon.Plus, kbd: "T", run: () => (sel.scheduled_for === LS.TODAY ? uncommit(sel) : commit(sel)) });
      cmds.push({ id: "c-agent", cat: "Selected task", label: sel.agent_status ? "Remove from Hermes" : "Sign off to Hermes", sub: sel.id, icon: Icon.Robot, run: () => (sel.agent_status ? unscheduleAgent(sel) : scheduleForAgent(sel)) });
      cmds.push({ id: "c-acr", cat: "Selected task", label: "Dispatch to ACR", sub: sel.id, icon: Icon.Server, run: () => dispatchToACR(sel, false) });
      cmds.push({ id: "c-detail", cat: "Selected task", label: "Open detail", sub: sel.id, icon: Icon.Arrow, run: () => openDetail(sel) });
    }
    cmds.push({ id: "n-capture", cat: "Create", label: "Quick capture", icon: Icon.Plus, kbd: "Ctrl+Space", run: () => captureFocusRef.current && captureFocusRef.current() });
    cmds.push({ id: "n-dump", cat: "Create", label: "Open Brain Dump", icon: Icon.Brain, run: () => setView("braindump") });
    NAV.forEach((n) => cmds.push({ id: "go-" + n.id, cat: "Navigate", label: "Go to " + n.label, icon: n.icon, kbd: n.kbd, run: () => { setView(n.id); setPanel(null); } }));
    cmds.push({ id: "go-focus", cat: "Navigate", label: focus ? "Exit focus mode" : "Enter focus mode", icon: Icon.Focus, kbd: ".", run: () => setFocus((f) => !f) });
    // filter
    if (window.filterActive(filter)) cmds.push({ id: "f-clear", cat: "Filter", label: "Clear all filters", icon: Icon.X, run: clearFilter });
    PROJECTS.forEach((p) => cmds.push({ id: "f-" + p.prefix, cat: "Filter", label: (filter.projects.includes(p.prefix) ? "Remove filter: " : "Filter by ") + p.prefix, sub: p.name, icon: Icon.Filter, run: () => toggleFilterProject(p.prefix) }));
    // search tasks
    tasks.forEach((tk) => cmds.push({ id: "task-" + tk.id, cat: "Tasks", label: tk.title, sub: tk.id, icon: () => React.createElement(StatusDot, { status: tk.status }), run: () => navigateToTask(tk.id) }));
    LS.artifacts.forEach((a) => cmds.push({ id: "art-" + a.path, cat: "Artifacts", label: a.name, sub: a.project, icon: Icon.Doc, run: () => setView("artifacts") }));
    return cmds;
  }, [selectedId, tasks, focus, filter]);

  const runCmd = (c) => c.run();

  const counts = {
    today: tasks.filter((x) => x.scheduled_for === LS.TODAY && x.status !== "done").length,
    board: tasks.length,
    agent: tasks.filter((x) => x.agent_status && x.agent_status !== "done" && x.status !== "done").length,
    artifacts: LS.artifacts.length,
  };

  const activePanelTask = panel ? taskById(panel.taskId) : null;

  return (
    React.createElement("div", { className: "app", "data-focus": focus },
      React.createElement(CaptureBar, { onCapture: captureTask, onExpand: openBrainDump, registerFocus: (fn) => (captureFocusRef.current = fn) }),

      // ── left nav ──
      React.createElement("nav", { className: "nav" },
        React.createElement("div", { className: "nav-group-label section-label" }, "Workspace"),
        NAV.map((n) =>
          React.createElement("div", {
            key: n.id, className: "nav-item " + (view === n.id ? "active" : ""),
            onClick: () => { setView(n.id); setPanel(null); },
          },
            React.createElement("span", { className: "ico" }, n.icon()),
            React.createElement("span", null, n.label),
            counts[n.id] != null
              ? React.createElement("span", { className: "count" }, counts[n.id])
              : React.createElement("span", { className: "nav-kbd" }, React.createElement("kbd", null, n.kbd))
          )
        ),
        React.createElement("div", { className: "nav-spacer" }),
        favorites.length > 0 && React.createElement("div", { className: "nav-pinned" },
          React.createElement("div", { className: "nav-group-label section-label", style: { paddingTop: 8 } }, "Favourites"),
          favorites.map((pref) => {
            const proj = projById[pref];
            if (!proj) return null;
            return React.createElement("div", {
              key: pref, className: "pin-item " + (filter.projects.includes(pref) ? "active" : ""),
              title: proj.name + " — click to filter everywhere",
              onClick: () => toggleFilterProject(pref),
            },
              React.createElement("span", { className: "pin-dot", style: { background: AREAS[proj.area].color } }),
              React.createElement("span", { className: "pin-prefix" }, pref),
              projectCounts[pref] ? React.createElement("span", { className: "pin-count" }, projectCounts[pref]) : null
            );
          })
        ),
        React.createElement("div", { className: "nav-foot" },
          React.createElement("div", { className: "row" },
            React.createElement("span", { className: "status-dot-sm", style: { width: 7, height: 7, borderRadius: "50%", background: config.acr_online ? "var(--green)" : "var(--muted-2)" } }),
            "ACR ", config.acr_online ? "online" : "offline"),
          React.createElement("div", { className: "row" },
            React.createElement("span", { className: "status-dot-sm", style: { width: 7, height: 7, borderRadius: "50%", background: config.brain_online ? "var(--green)" : "var(--muted-2)" } }),
            "Brain ", config.brain_online ? "online" : "offline"),
          React.createElement("div", { className: "row", style: { marginTop: 10 } },
            React.createElement("button", { className: "btn sm ghost", style: { width: "100%", justifyContent: "flex-start", color: "var(--muted)" }, onClick: () => setCmdkOpen(true) },
              React.createElement(window.Icon.Search, { size: 13 }), "Search", React.createElement("kbd", { style: { marginLeft: "auto" } }, "⌘K"))
          )
        )
      ),

      // ── main ──
      React.createElement("main", { className: "main" },
        React.createElement("div", { className: "main-inner" },
          view === "today" && React.createElement(React.Fragment, null,
            React.createElement("div", { className: "view-head" },
              React.createElement("h1", null, "Today"),
              React.createElement("span", { className: "sub" }, "Friday"),
              React.createElement("span", { className: "date" }, "2026-05-29"),
              React.createElement("button", { className: "btn sm ghost", title: "Focus mode (.)", onClick: () => setFocus((f) => !f) },
                React.createElement(window.Icon.Focus, { size: 14 }))
            ),
            React.createElement(FilterBar, filterProps),
            React.createElement(TodayView, {
              tasks, selectedId, tweaks: t, target, setTarget, animMap, filter,
              handlers: { markDone, pause, block, commit, openDetail, openPeek, menu: openMenu },
            })
          ),
          view === "board" && React.createElement(BoardView, { tasks, onOpen: openDetail, filterProps, filter }),
          view === "agent" && React.createElement(AgentView, {
            tasks, skills, proposals, agentLog, dailyBudget, jobsToday, handlers: agentHandlers,
          }),
          view === "braindump" && React.createElement(BrainDumpView, { acrOnline: config.acr_online, onCreateTasks: createFromCandidates, onToast: showToast, seed: bdSeed }),
          view === "artifacts" && React.createElement(ArtifactsView, { artifacts: LS.artifacts, onToast: showToast, onTask: navigateToTask, filterProps, filter }),
          view === "roadmap" && React.createElement(RoadmapView, { milestones: LS.milestones, filterProps, filter }),
          view === "activity" && React.createElement(ActivityView, { tasks, activity: LS.activity, onOpen: navigateToTask, filterProps, filter })
        ),
        activePanelTask && React.createElement(TaskPanel, {
          task: activePanelTask, mode: panel.mode, onClose: () => setPanel(null), onAction: panelAction,
        })
      ),

      // ── right ambient ──
      React.createElement(AmbientPanel, {
        acrJobs: config.acr_online ? acrJobs : [], activity: LS.activity, config,
        onJob: (j) => setAcrJob(j), onActivity: navigateToTask,
      }),

      // ── overlays ──
      React.createElement(CommandPalette, {
        open: cmdkOpen, onClose: () => setCmdkOpen(false), view, selectedTask: selectedId,
        commands: buildCommands, onRun: runCmd,
      }),
      React.createElement(RowMenu, { menu, onClose: () => setMenu(null), onAction: panelAction }),
      acrJob && React.createElement(AcrJobPanel, { job: acrJob, onClose: () => setAcrJob(null) }),
      toast && React.createElement("div", { className: "toast" },
        React.createElement(window.Icon.Check, { size: 14, style: { color: "var(--green)" } }), toast),

      // ── tweaks ──
      React.createElement(TweaksPanel, null,
        React.createElement(TweakSection, { label: "Today hero" }),
        React.createElement(TweakRadio, { label: "Treatment", value: t.heroVariant, options: ["signal", "calm", "bold"], onChange: (v) => setTweak("heroVariant", v) }),
        React.createElement(TweakSection, { label: "Capacity gauge" }),
        React.createElement(TweakRadio, { label: "Style", value: t.capacityStyle, options: ["bar", "segmented", "ring"], onChange: (v) => setTweak("capacityStyle", v) }),
        React.createElement(TweakSection, { label: "Appearance" }),
        React.createElement(TweakColor, { label: "Accent", value: t.accent, options: ["#0070F3", "#7C5CFF", "#F0653A", "#2BD4A8"], onChange: (v) => setTweak("accent", v) }),
        React.createElement(TweakRadio, { label: "Typeface", value: t.font, options: ["geist", "inter"], onChange: (v) => setTweak("font", v) }),
        React.createElement(TweakRadio, { label: "Density", value: t.density, options: ["compact", "balanced", "airy"], onChange: (v) => setTweak("density", v) }),
        React.createElement(TweakSection, { label: "Integrations (demo states)" }),
        React.createElement(TweakToggle, { label: "ACR online", value: t.acrOnline, onChange: (v) => setTweak("acrOnline", v) }),
        React.createElement(TweakToggle, { label: "Brain online", value: t.brainOnline, onChange: (v) => setTweak("brainOnline", v) })
      )
    )
  );
}

function AcrJobPanel({ job, onClose }) {
  const Icon = window.Icon;
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true);
  }, []);
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "panel-overlay", style: { position: "fixed" }, onClick: onClose }),
    React.createElement("div", { className: "slide-panel peek", style: { position: "fixed" } },
      React.createElement("div", { className: "panel-head" },
        React.createElement(Icon.Robot, { size: 15, style: { color: "var(--muted)" } }),
        React.createElement("span", { className: "pid" }, "ACR job"),
        React.createElement("button", { className: "icon-btn x", onClick: onClose }, React.createElement(Icon.X, { size: 16 }))
      ),
      React.createElement("div", { className: "panel-body" },
        React.createElement("div", { className: "panel-title" }, job.title),
        React.createElement("div", { className: "hero-meta", style: { marginBottom: 18 } },
          React.createElement("span", { className: "job-chip " + job.status }, React.createElement("span", { className: "d" }), job.status),
          job.elapsed_s != null && React.createElement("span", { className: "t-est" }, fmtJobElapsed(job.elapsed_s)),
          React.createElement(PrefixBadge, { project: job.project })
        ),
        job.error && React.createElement("div", { className: "panel-field" },
          React.createElement("div", { className: "k", style: { color: "var(--red)" } }, "Error"),
          React.createElement("div", { className: "v mono", style: { color: "var(--red)" } }, job.error)
        ),
        React.createElement("div", { className: "panel-field" },
          React.createElement("div", { className: "k" }, "Output stream"),
          React.createElement("div", { className: "v mono", style: { fontSize: 12, background: "var(--bg)", border: "1px solid var(--s3)", borderRadius: 6, padding: 10, lineHeight: 1.6, color: "var(--text2)" } },
            "$ acr run " + job.id, React.createElement("br"),
            "→ provisioning sandbox…", React.createElement("br"),
            "→ " + (job.status === "failed" ? "exited 1" : job.status === "done" ? "exited 0" : "working…"))
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
