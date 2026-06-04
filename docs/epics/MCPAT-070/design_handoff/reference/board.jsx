/* Life OS — Board (kanban), Roadmap, Activity views */

function BoardView({ tasks, onOpen, filterProps, filter }) {
  const f = filter || { projects: [], areas: [] };
  const cols = [
    { key: "queued", label: "Queued" },
    { key: "in_progress", label: "In progress" },
    { key: "blocked", label: "Blocked" },
    { key: "done", label: "Done" },
  ];
  const byStatus = (k) => tasks.filter((t) => t.status === k && window.matchFilter(f, t.project, t.area)).sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]);
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Board"),
        React.createElement("span", { className: "sub" }, "All tasks across every project")
      ),
      React.createElement(window.FilterBar, filterProps),
      React.createElement("div", { className: "board" },
        cols.map((c) => {
          const items = byStatus(c.key);
          return React.createElement("div", { key: c.key, className: "board-col" },
            React.createElement("div", { className: "board-col-head" },
              React.createElement(StatusDot, { status: c.key }),
              React.createElement("span", { className: "label" }, c.label),
              React.createElement("span", { className: "n" }, items.length)
            ),
            items.map((t) =>
              React.createElement("div", { key: t.id, className: "board-card", "data-pri": t.priority, onClick: () => onOpen(t) },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                  React.createElement("span", { className: "bc-id" }, t.id),
                  React.createElement("span", { className: "pri-tag", "data-pri": t.priority, style: { marginLeft: "auto" } }, t.priority)
                ),
                React.createElement("div", { className: "bc-title" }, t.title),
                React.createElement("div", { className: "bc-foot" },
                  React.createElement(AreaDot, { area: t.area, title: true }),
                  t.estimate_hours != null && React.createElement("span", { className: "t-est" }, fmtEst(t.estimate_hours)),
                  React.createElement("div", { style: { flex: 1 } }),
                  t.agent_status && t.agent_status !== "done" && React.createElement("span", { className: "board-agent-badge", title: "Signed off to the agent" },
                    React.createElement(window.Icon.Robot, { size: 11 })),
                  t.scheduled_for === window.LifeOS.TODAY && React.createElement("span", { className: "badge", style: { fontSize: 10, color: "var(--accent)" } }, "today")
                )
              )
            )
          );
        })
      )
    )
  );
}

function RoadmapView({ milestones, filterProps, filter }) {
  const f = filter || { projects: [], areas: [] };
  const list = milestones.filter((m) => window.matchFilter(f, m.project));
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Roadmap"),
        React.createElement("span", { className: "sub" }, "Milestones across active projects")
      ),
      React.createElement(window.FilterBar, filterProps),
      list.length === 0 && React.createElement("div", { className: "filter-empty" }, "No milestones match the current filter."),
      list.map((m, i) =>
        React.createElement("div", { key: i, className: "milestone" },
          React.createElement("div", { className: "ms-head" },
            React.createElement(PrefixBadge, { project: m.project }),
            React.createElement("span", { className: "ms-title" }, m.title),
            React.createElement("span", { className: "ms-due" }, "due " + m.due)
          ),
          React.createElement("div", { className: "ms-bar" },
            React.createElement("div", { className: "fill", style: { width: Math.round(m.progress * 100) + "%" } })
          ),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } },
            React.createElement("span", { style: { fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" } }, Math.round(m.progress * 100) + "% complete")
          ),
          React.createElement("div", { className: "ms-items" },
            m.items.map((it, j) => React.createElement("span", { key: j, className: "ms-item" }, it))
          )
        )
      )
    )
  );
}

function ActivityView({ tasks, activity, onOpen, filterProps, filter }) {
  const f = filter || { projects: [], areas: [] };
  // build a richer timeline from task histories
  const events = [];
  activity.forEach((a) => events.push({ id: a.id, title: a.title, to: a.to, ago: a.ago }));
  const shown = events.filter((e) => window.matchFilter(f, window.projectOfId(e.id)));
  const dot = (to) => ({ done: "var(--green)", in_progress: "var(--blue)", blocked: "var(--red)", queued: "var(--muted)" }[to] || "var(--muted)");
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Activity"),
        React.createElement("span", { className: "sub" }, "Recent status transitions, newest first")
      ),
      React.createElement(window.FilterBar, filterProps),
      React.createElement("div", { className: "timeline" },
        shown.map((e, i) =>
          React.createElement("div", { key: i, className: "tl-item", onClick: () => onOpen(e.id), style: { cursor: "pointer" } },
            React.createElement("span", { className: "tl-dot", style: { background: dot(e.to) } }),
            React.createElement("div", { className: "tl-title" }, e.title),
            React.createElement("div", { className: "tl-sub" },
              React.createElement("span", { className: "trans trans-" + e.to }, "→ " + e.to.replace("_", " ")),
              React.createElement("span", { style: { margin: "0 8px", color: "var(--muted-2)" } }, "·"),
              React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, e.ago + " ago")
            )
          )
        )
      )
    )
  );
}

Object.assign(window, { BoardView, RoadmapView, ActivityView });
