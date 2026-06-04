/* Life OS — Today view: hero, capacity, committed list, candidate queue */

function HeroTask({ task, variant, onDone, onPause, onBlock, onOpen }) {
  const [elapsed, setElapsed] = React.useState(task ? Date.now() - task.claimed_at : 0);
  React.useEffect(() => {
    if (!task || !task.claimed_at) return;
    const id = setInterval(() => setElapsed(Date.now() - task.claimed_at), 1000);
    return () => clearInterval(id);
  }, [task && task.id, task && task.claimed_at]);

  if (!task) {
    return React.createElement("div", { className: "hero-empty" },
      "Nothing in progress — pick one from today's list, or press ",
      React.createElement("kbd", null, "J"), " then ", React.createElement("kbd", null, "Enter"), "."
    );
  }
  const Icon = window.Icon;
  return (
    React.createElement("div", { className: "hero", "data-variant": variant },
      React.createElement("div", { className: "hero-top" },
        React.createElement("span", { className: "hero-now" },
          React.createElement("span", { className: "live-dot" }), "In progress"
        ),
        task.claimed_at && React.createElement("span", { className: "hero-timer", title: "Elapsed since claimed" },
          React.createElement(Icon.Clock, { size: 13, style: { verticalAlign: "-2px", marginRight: 5 } }),
          fmtElapsed(elapsed)
        )
      ),
      React.createElement("div", { className: "hero-title", onClick: onOpen, style: { cursor: "pointer" } }, task.title),
      React.createElement("div", { className: "hero-meta" },
        React.createElement(PrefixBadge, { project: task.project }),
        React.createElement(AreaChip, { area: task.area }),
        React.createElement("span", { className: "pri-tag", "data-pri": task.priority }, task.priority),
        task.estimate_hours != null && React.createElement("span", { className: "t-est" }, "est " + fmtEst(task.estimate_hours)),
        task.branch && React.createElement("span", { className: "git-row" },
          React.createElement(Icon.Git, { size: 13 }), task.branch
        )
      ),
      task.why && variant !== "calm" && React.createElement("div", { className: "hero-why" }, task.why),
      React.createElement("div", { className: "hero-actions" },
        React.createElement("button", { className: "btn primary", onClick: () => onDone(task) },
          React.createElement(Icon.Check, { size: 14 }), "Mark done"),
        React.createElement("button", { className: "btn", onClick: () => onPause(task) },
          React.createElement(Icon.Pause, { size: 13 }), "Pause"),
        React.createElement("button", { className: "btn danger", onClick: () => onBlock(task) },
          React.createElement(Icon.Ban, { size: 13 }), "Block"),
        React.createElement("button", { className: "btn ghost", onClick: onOpen, style: { marginLeft: "auto" } },
          "Open detail", React.createElement(Icon.Arrow, { size: 13 }))
      )
    )
  );
}

function CapacityGauge({ committed, target, style, onTarget }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(String(target));
  const pct = target > 0 ? committed / target : 0;
  const clamped = Math.min(pct, 1);
  const zone = pct <= 0.8 ? "green" : pct <= 1.0 ? "amber" : "red";
  const color = zone === "green" ? "var(--green)" : zone === "amber" ? "var(--amber)" : "var(--red)";

  const commit = () => {
    const v = parseFloat(draft);
    if (!isNaN(v) && v > 0) onTarget(v);
    else setDraft(String(target));
    setEditing(false);
  };

  let gauge;
  if (style === "ring") {
    const r = 22, c = 2 * Math.PI * r;
    gauge = React.createElement("div", { className: "cap-ring-wrap" },
      React.createElement("svg", { className: "cap-ring", viewBox: "0 0 56 56" },
        React.createElement("circle", { className: "track", cx: 28, cy: 28, r }),
        React.createElement("circle", { className: "val", cx: 28, cy: 28, r,
          style: { stroke: color, strokeDasharray: `${c * clamped} ${c}`, transform: "rotate(-90deg)", transformOrigin: "center" } })
      ),
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 20, fontWeight: 600, fontFamily: "var(--font-mono)", color } }, Math.round(pct * 100) + "%"),
        React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginTop: 2 } }, fmtHM(committed) + " of " + fmtHM(target))
      )
    );
  } else if (style === "segmented") {
    const cells = 12;
    const filled = Math.round(clamped * cells);
    gauge = React.createElement("div", { className: "cap-seg" },
      Array.from({ length: cells }, (_, i) =>
        React.createElement("div", { key: i, className: "cell",
          style: { background: i < filled ? color : (pct > 1 && i === cells - 1 ? "var(--red)" : undefined) } })
      )
    );
  } else {
    gauge = React.createElement("div", { className: "cap-bar " + (pct > 1 ? "over" : "") },
      React.createElement("div", { className: "fill", style: { width: (clamped * 100) + "%", background: color } })
    );
  }

  return (
    React.createElement("div", { className: "capacity" },
      React.createElement("div", { className: "capacity-head" },
        React.createElement("span", { className: "label" }, "Capacity"),
        React.createElement("span", { className: "nums", style: { color } },
          fmtHM(committed),
          React.createElement("span", { style: { color: "var(--muted)" } }, " / "),
          editing
            ? React.createElement("input", {
                className: "cap-target-input", autoFocus: true, value: draft,
                onChange: (e) => setDraft(e.target.value.replace(/[^0-9.]/g, "")),
                onBlur: commit, onKeyDown: (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(target)); setEditing(false); } },
              })
            : React.createElement("span", { className: "target-edit", title: "Click to edit target", onClick: () => { setDraft(String(target)); setEditing(true); } }, fmtHM(target)),
          React.createElement("span", { style: { color: "var(--muted)" } }, " committed")
        )
      ),
      style !== "ring" && gauge,
      style === "ring" && gauge,
      pct > 1 && React.createElement("div", { className: "cap-overflow" },
        "Over target by " + fmtHM(committed - target) + " — consider deferring something.")
    )
  );
}

const AREA_ORDER = { client: 0, personal: 1, internal: 2, outsource: 3 };
function taskCmp(sortBy) {
  return (a, b) => {
    if (sortBy === "area") return (AREA_ORDER[a.area] - AREA_ORDER[b.area]) || (PRI_RANK[a.priority] - PRI_RANK[b.priority]);
    if (sortBy === "estimate") return ((b.estimate_hours || 0) - (a.estimate_hours || 0)) || (PRI_RANK[a.priority] - PRI_RANK[b.priority]);
    if (sortBy === "project") return (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) || (PRI_RANK[a.priority] - PRI_RANK[b.priority]);
    return PRI_RANK[a.priority] - PRI_RANK[b.priority];
  };
}

function CandidateQueue({ candidates, selectedId, onCommit, onOpen, onMenu, animMap, sortBy }) {
  const [open, setOpen] = React.useState(true);
  const byArea = {};
  candidates.forEach((t) => { (byArea[t.area] = byArea[t.area] || []).push(t); });
  const order = ["client", "personal", "internal", "outsource"];
  return (
    React.createElement("div", { className: "list-block" },
      React.createElement("button", { className: "cand-toggle " + (open ? "open" : ""), onClick: () => setOpen(!open) },
        React.createElement("span", { className: "chev" }, React.createElement(window.Icon.Chevron, { size: 14 })),
        React.createElement("span", { className: "section-label" }, candidates.length + " unscheduled"),
        React.createElement("span", { style: { color: "var(--muted-2)", fontSize: 12 } }, "commit to today")
      ),
      open && order.filter((a) => byArea[a]).map((area) =>
        React.createElement("div", { key: area },
          React.createElement("div", { className: "area-group-head" },
            React.createElement(AreaChip, { area }),
            React.createElement("span", { className: "list-block-head", style: { padding: 0 } },
              React.createElement("span", { className: "n", style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-2)" } }, byArea[area].length))
          ),
          byArea[area].sort(taskCmp(sortBy || "priority")).map((t) =>
            React.createElement(TaskRow, {
              key: t.id, task: t, mode: "candidate", selected: selectedId === t.id,
              animClass: animMap[t.id], onClick: () => onOpen(t), onCommit,
            })
          )
        )
      )
    )
  );
}

function TodayView({ tasks, selectedId, tweaks, target, setTarget, handlers, animMap, filter, sortBy }) {
  const f = filter || { projects: [], areas: [] };
  const inProgress = tasks.find((t) => t.status === "in_progress");
  const committed = tasks
    .filter((t) => t.scheduled_for === window.LifeOS.TODAY && t.status !== "in_progress" && t.status !== "cancelled" && window.matchFilter(f, t.project, t.area))
    .sort((a, b) => {
      const done = (a.status === "done") - (b.status === "done");
      if (done) return done;
      return taskCmp(sortBy || "priority")(a, b);
    });
  const candidates = tasks.filter((t) => t.scheduled_for == null && t.status === "queued" && window.matchFilter(f, t.project, t.area));
  const committedHours = tasks
    .filter((t) => t.scheduled_for === window.LifeOS.TODAY && t.status !== "done" && t.status !== "cancelled")
    .reduce((s, t) => s + (t.estimate_hours || 0), 0);

  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement(HeroTask, {
        task: inProgress, variant: tweaks.heroVariant,
        onDone: handlers.markDone, onPause: handlers.pause, onBlock: handlers.block,
        onOpen: () => inProgress && handlers.openDetail(inProgress),
      }),
      React.createElement(CapacityGauge, {
        committed: committedHours, target, style: tweaks.capacityStyle, onTarget: setTarget,
      }),
      React.createElement("div", { className: "list-block" },
        React.createElement("div", { className: "list-block-head" },
          React.createElement("span", { className: "label" }, "Committed today"),
          React.createElement("span", { className: "n" }, committed.length)
        ),
        committed.length === 0
          ? React.createElement("div", { className: "hero-empty", style: { marginBottom: 0 } }, "Nothing committed yet. Commit something from below.")
          : committed.map((t) =>
              React.createElement(TaskRow, {
                key: t.id, task: t, selected: selectedId === t.id, animClass: animMap[t.id],
                onClick: () => handlers.openPeek(t), onMenu: handlers.menu,
              })
            )
      ),
      candidates.length > 0 && React.createElement(CandidateQueue, {
        candidates, selectedId, onCommit: handlers.commit,
        onOpen: handlers.openPeek, onMenu: handlers.menu, animMap, sortBy,
      })
    )
  );
}

Object.assign(window, { TodayView, HeroTask, CapacityGauge });
