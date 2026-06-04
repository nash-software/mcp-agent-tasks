/* Life OS — shared helpers + atomic components. Exports to window. */

const AREAS = window.LifeOS.areas;
const PROJECTS = window.LifeOS.projects;
const projById = Object.fromEntries(PROJECTS.map((p) => [p.prefix, p]));

const PRI_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function fmtEst(h) {
  if (h == null) return null;
  const m = Math.round(h * 60);
  if (m < 60) return m + "m";
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}
function fmtHM(h) {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60), mm = m % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtJobElapsed(s) {
  if (s == null) return "";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m + "m " + (s % 60) + "s";
}

// fuzzy match — returns {score, ranges} or null
function fuzzy(query, text) {
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, ti = 0, score = 0, streak = 0;
  const ranges = [];
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      ranges.push(ti);
      streak++; score += 1 + streak * 1.5;
      if (ti === 0 || t[ti - 1] === " ") score += 4;
      qi++;
    } else streak = 0;
    ti++;
  }
  return qi === q.length ? { score, ranges } : null;
}
function highlight(text, ranges) {
  if (!ranges || !ranges.length) return text;
  const set = new Set(ranges);
  const out = [];
  let buf = "", mark = false;
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== mark) { if (buf) out.push(mark ? React.createElement("mark", { key: i }, buf) : buf); buf = ""; mark = m; }
    buf += text[i];
  }
  if (buf) out.push(mark ? React.createElement("mark", { key: "end" }, buf) : buf);
  return out;
}

const StatusDot = ({ status }) =>
  React.createElement("span", { className: `status-dot sd-${status}` });

const AreaDot = ({ area, title }) =>
  React.createElement("span", {
    className: "area-dot", title: title ? AREAS[area].label : undefined,
    style: { background: AREAS[area].color },
  });

const AreaChip = ({ area }) =>
  React.createElement("span", { className: "area-chip" },
    React.createElement("span", { className: "dot", style: { background: AREAS[area].color } }),
    AREAS[area].label
  );

const PrefixBadge = ({ project }) =>
  React.createElement("span", { className: "prefix-badge" }, project);

// ── TaskRow ────────────────────────────────────────────────────────────
function TaskRow({ task, selected, onClick, onCommit, onMenu, mode, animClass }) {
  const [hoverArea, setHoverArea] = React.useState(false);
  const showPri = task.priority === "critical" || task.priority === "high";
  return (
    React.createElement("div", {
      className: `task-row ${selected ? "sel" : ""} ${task.status === "done" ? "done" : ""} ${animClass || ""}`,
      "data-pri": task.priority, "data-task": task.id,
      onClick: onClick,
    },
      React.createElement(StatusDot, { status: task.status }),
      React.createElement("span", { className: "t-title" }, task.title),
      React.createElement("div", { className: "t-meta" },
        task.status === "blocked" && task.block_reason &&
          React.createElement("span", { className: "t-blocked-reason" }, "blocked"),
        showPri && React.createElement("span", { className: "pri-tag", "data-pri": task.priority }, task.priority),
        task.estimate_hours != null &&
          React.createElement("span", { className: "t-est" }, fmtEst(task.estimate_hours)),
        React.createElement("span", {
          onMouseEnter: () => setHoverArea(true), onMouseLeave: () => setHoverArea(false),
        }, hoverArea ? React.createElement(AreaChip, { area: task.area }) : React.createElement(AreaDot, { area: task.area, title: true })),
        React.createElement(PrefixBadge, { project: task.project }),
        mode === "candidate"
          ? React.createElement("button", {
              className: "commit-btn", title: "Commit to today (T)",
              onClick: (e) => { e.stopPropagation(); onCommit(task); },
            }, React.createElement(window.Icon.Plus, { size: 14 }))
          : React.createElement("button", {
              className: "row-menu-btn", title: "Actions",
              onClick: (e) => { e.stopPropagation(); onMenu && onMenu(task, e); },
            }, React.createElement(window.Icon.Dots, { size: 15 }))
      )
    )
  );
}

Object.assign(window, {
  AREAS, PROJECTS, projById, PRI_RANK,
  fmtEst, fmtHM, fmtElapsed, fmtJobElapsed, fuzzy, highlight,
  StatusDot, AreaDot, AreaChip, PrefixBadge, TaskRow,
});
