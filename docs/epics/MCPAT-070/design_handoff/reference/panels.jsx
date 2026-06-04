/* Life OS — ambient panel, peek/detail panels, command palette */

function AcrSection({ jobs, online, onJob }) {
  const Icon = window.Icon;
  const anyRunning = jobs.some((j) => j.status === "running");
  const anyFailed = jobs.some((j) => j.status === "failed");
  const dotColor = !online ? "var(--muted-2)" : anyFailed ? "var(--red)" : anyRunning ? "var(--green)" : "var(--muted)";
  return (
    React.createElement("div", { className: "ambient-sec" },
      React.createElement("div", { className: "ambient-sec-head" },
        React.createElement(Icon.Server, { size: 14, style: { color: "var(--muted)" } }),
        React.createElement("span", { className: "label" }, "ACR"),
        React.createElement("span", { style: { fontSize: 10.5, color: "var(--muted-2)" } }, "Agent Control Room"),
        React.createElement("span", { className: "status-dot-sm", style: { background: dotColor, marginLeft: "auto" } }),
        online && React.createElement("span", { className: "more" }, jobs.length)
      ),
      !online
        ? React.createElement("div", { className: "offline-row" }, React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", border: "1px solid var(--muted-2)" } }), "ACR offline")
        : jobs.slice(0, 5).map((j) =>
            React.createElement("div", { key: j.id, className: "acr-job", onClick: () => onJob(j), style: { cursor: "pointer" } },
              React.createElement("span", { className: "jt" },
                j.hermes && React.createElement("span", { className: "hermes-tag", title: "Dispatched by Hermes" }, "H"),
                j.title),
              j.status === "running" && React.createElement("span", { className: "je" }, fmtJobElapsed(j.elapsed_s)),
              React.createElement("span", { className: "job-chip " + j.status },
                React.createElement("span", { className: "d" }), j.status)
            )
          )
    )
  );
}

function BrainSection({ online }) {
  const Icon = window.Icon;
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState([]);
  React.useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const id = setTimeout(() => {
      const scored = window.LifeOS.brainCorpus
        .map((r) => { const m = fuzzy(q, r.title + " " + r.text); return m ? { ...r, score: m.score } : null; })
        .filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);
      setResults(scored);
    }, 400);
    return () => clearTimeout(id);
  }, [q]);
  return (
    React.createElement("div", { className: "ambient-sec" },
      React.createElement("div", { className: "ambient-sec-head" },
        React.createElement(Icon.Brain, { size: 14, style: { color: "var(--muted)" } }),
        React.createElement("span", { className: "label" }, "Knowledge")
      ),
      !online
        ? React.createElement("div", { className: "offline-row" }, "Brain unavailable")
        : React.createElement(React.Fragment, null,
            React.createElement("div", { className: "brain-input-wrap" },
              React.createElement(Icon.Search, { size: 13, style: { color: "var(--muted)" } }),
              React.createElement("input", { className: "brain-input", placeholder: "Search your knowledge base…", value: q, onChange: (e) => setQ(e.target.value) })
            ),
            q.trim() && React.createElement("div", { style: { marginTop: 8 } },
              results.length === 0
                ? React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", padding: "6px 0" } }, "No matches.")
                : results.map((r, i) =>
                    React.createElement("div", { key: i, className: "brain-result" },
                      React.createElement("div", { className: "bt" }, r.title),
                      React.createElement("div", { className: "bs" }, r.text),
                      React.createElement("div", { className: "bsrc" }, r.source)
                    )
                  )
            )
          )
    )
  );
}

function ActivitySection({ activity, onItem }) {
  return (
    React.createElement("div", { className: "ambient-sec" },
      React.createElement("div", { className: "ambient-sec-head" },
        React.createElement(window.Icon.Activity, { size: 14, style: { color: "var(--muted)" } }),
        React.createElement("span", { className: "label" }, "Recent activity")
      ),
      activity.slice(0, 6).map((a, i) =>
        React.createElement("div", { key: i, className: "act-row", onClick: () => onItem(a.id), style: { cursor: "pointer" } },
          React.createElement(StatusDot, { status: a.to }),
          React.createElement("span", { className: "at" }, a.title),
          React.createElement("span", { className: "ago" }, a.ago)
        )
      )
    )
  );
}

function AmbientPanel({ acrJobs, activity, config, onJob, onActivity }) {
  return (
    React.createElement("aside", { className: "ambient" },
      React.createElement(AcrSection, { jobs: acrJobs, online: config.acr_online, onJob }),
      React.createElement(BrainSection, { online: config.brain_online }),
      React.createElement(ActivitySection, { activity, onItem: onActivity })
    )
  );
}

// ── Peek / Detail slide-in panel ──────────────────────────────────────
function TaskPanel({ task, mode, onClose, onAction }) {
  const Icon = window.Icon;
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  if (!task) return null;
  const isDetail = mode === "detail";
  return (
    React.createElement(React.Fragment, null,
      React.createElement("div", { className: "panel-overlay", onClick: onClose }),
      React.createElement("div", { className: "slide-panel " + (isDetail ? "detail" : "peek") },
        React.createElement("div", { className: "panel-head" },
          React.createElement(StatusDot, { status: task.status }),
          React.createElement("span", { className: "pid" }, task.id),
          React.createElement("span", { style: { fontSize: 12, color: "var(--muted)" } }, isDetail ? "Detail" : "Peek"),
          React.createElement("button", { className: "icon-btn x", onClick: onClose }, React.createElement(Icon.X, { size: 16 }))
        ),
        React.createElement("div", { className: "panel-body" },
          React.createElement("div", { className: "panel-title" }, task.title),
          React.createElement("div", { className: "hero-meta", style: { marginBottom: 18 } },
            React.createElement(AreaChip, { area: task.area }),
            React.createElement("span", { className: "pri-tag", "data-pri": task.priority }, task.priority),
            React.createElement("span", { className: "badge up" }, task.status.replace("_", " ")),
            task.estimate_hours != null && React.createElement("span", { className: "t-est" }, "est " + fmtEst(task.estimate_hours))
          ),
          task.block_reason && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k", style: { color: "var(--red)" } }, "Blocked"),
            React.createElement("div", { className: "v", style: { color: "var(--red)" } }, task.block_reason)
          ),
          task.why && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k" }, "Why"),
            React.createElement("div", { className: "v" }, task.why)
          ),
          (task.spec_file || task.plan_file) && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k" }, "Linked docs"),
            task.spec_file && React.createElement("div", { className: "link-row" },
              React.createElement("span", { className: "lk-ico" }, React.createElement(Icon.Doc, { size: 14 })),
              React.createElement("span", { className: "lk-path" }, task.spec_file)),
            task.plan_file && React.createElement("div", { className: "link-row" },
              React.createElement("span", { className: "lk-ico" }, React.createElement(Icon.Doc, { size: 14 })),
              React.createElement("span", { className: "lk-path" }, task.plan_file))
          ),
          task.branch && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k" }, "Git"),
            React.createElement("div", { className: "link-row" },
              React.createElement("span", { className: "lk-ico" }, React.createElement(Icon.Git, { size: 14 })),
              React.createElement("span", { className: "lk-path" }, task.branch),
              task.commits != null && React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" } }, task.commits + " commits")),
            task.pr && React.createElement("div", { className: "link-row" },
              React.createElement("span", { className: "lk-ico" }, React.createElement(Icon.Git, { size: 14 })),
              React.createElement("span", { className: "lk-path" }, "PR " + task.pr))
          ),
          isDetail && task.history && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k" }, "Status history"),
            task.history.map((h, i) =>
              React.createElement("div", { key: i, className: "history-item" },
                React.createElement("span", { className: "hdot", style: { background: { done: "var(--green)", in_progress: "var(--blue)", blocked: "var(--red)", queued: "var(--muted)" }[h.to] || "var(--muted)" } }),
                React.createElement("span", null, "→ " + h.to.replace("_", " ")),
                React.createElement("span", { className: "hat" }, h.at)
              )
            )
          ),
          task.tags && task.tags.length > 0 && React.createElement("div", { className: "panel-field" },
            React.createElement("div", { className: "k" }, "Tags"),
            React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              task.tags.map((t) => React.createElement("span", { key: t, className: "ms-item" }, "#" + t)))
          )
        ),
        React.createElement("div", { className: "panel-head", style: { borderTop: "1px solid var(--s3)", borderBottom: "none" } },
          task.status !== "done" && React.createElement("button", { className: "btn sm primary", onClick: () => onAction("done", task) },
            React.createElement(Icon.Check, { size: 13 }), "Done"),
          task.scheduled_for === window.LifeOS.TODAY
            ? React.createElement("button", { className: "btn sm", onClick: () => onAction("uncommit", task) }, "Remove from today")
            : React.createElement("button", { className: "btn sm", onClick: () => onAction("commit", task) },
                React.createElement(Icon.Plus, { size: 13 }), "Commit to today"),
          React.createElement("button", {
            className: "btn sm ghost", onClick: () => onAction(task.agent_status ? "unagent" : "agent", task), style: { marginLeft: "auto" },
            title: task.agent_status ? "Remove from Hermes" : "Sign off to Hermes (your assistant)",
          }, React.createElement(Icon.Robot, { size: 13 }), task.agent_status ? "Un-sign-off" : "Hermes"),
          React.createElement("button", {
            className: "btn sm ghost", onClick: () => onAction("acr", task),
            title: "Dispatch straight to ACR (the execution machine)",
          }, React.createElement(Icon.Server, { size: 13 }), "ACR")
        ),
        !isDetail && React.createElement("div", { className: "peek-hint" },
          React.createElement("span", null, React.createElement("kbd", null, "Enter"), " full detail"),
          React.createElement("span", null, React.createElement("kbd", null, "Esc"), " close")
        )
      )
    )
  );
}

// ── Command palette ───────────────────────────────────────────────────
function CommandPalette({ open, onClose, view, selectedTask, commands, onRun }) {
  const Icon = window.Icon;
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

  const items = React.useMemo(() => {
    const list = commands();
    if (!q.trim()) return list;
    return list.map((c) => { const m = fuzzy(q, c.label + " " + (c.sub || "")); return m ? { ...c, _m: m, _score: m.score } : null; })
      .filter(Boolean).sort((a, b) => b._score - a._score);
  }, [q, open, view, selectedTask]);

  React.useEffect(() => { setSel(0); }, [q]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) { onRun(items[sel]); onClose(); } }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [open, items, sel]);

  if (!open) return null;
  // group preserving order
  const groups = [];
  items.forEach((it) => {
    let g = groups.find((x) => x.cat === it.cat);
    if (!g) { g = { cat: it.cat, items: [] }; groups.push(g); }
    g.items.push(it);
  });
  let flatIdx = -1;
  return (
    React.createElement("div", { className: "cmdk-overlay", onClick: onClose },
      React.createElement("div", { className: "cmdk", onClick: (e) => e.stopPropagation() },
        React.createElement("div", { className: "cmdk-input-wrap" },
          React.createElement(Icon.Search, { size: 17, style: { color: "var(--muted)" } }),
          React.createElement("input", { ref: inputRef, className: "cmdk-input", placeholder: "Type a command or search…", value: q, onChange: (e) => setQ(e.target.value) }),
          React.createElement("kbd", null, "Esc")
        ),
        React.createElement("div", { className: "cmdk-list" },
          items.length === 0
            ? React.createElement("div", { className: "cmdk-empty" }, "No commands match “" + q + "”")
            : groups.map((g) =>
                React.createElement("div", { key: g.cat },
                  React.createElement("div", { className: "cmdk-group-label section-label" }, g.cat),
                  g.items.map((it) => {
                    flatIdx++;
                    const idx = flatIdx;
                    return React.createElement("div", {
                      key: it.id, className: "cmdk-row " + (idx === sel ? "sel" : ""),
                      onMouseEnter: () => setSel(idx),
                      onClick: () => { onRun(it); onClose(); },
                    },
                      React.createElement("span", { className: "ci" }, it.icon ? React.createElement(it.icon, { size: 15 }) : React.createElement(Icon.Arrow, { size: 15 })),
                      React.createElement("span", { className: "cl" },
                        it._m ? highlight(it.label, it._m.ranges.filter((r) => r < it.label.length)) : it.label,
                        it.sub && React.createElement("span", { className: "cl-sub" }, it.sub)
                      ),
                      it.kbd && React.createElement("span", { className: "ck" }, it.kbd.split("+").map((k, i) => React.createElement("kbd", { key: i }, k)))
                    );
                  })
                )
              )
        ),
        React.createElement("div", { className: "cmdk-foot" },
          React.createElement("span", { className: "fk" }, React.createElement("kbd", null, "↑"), React.createElement("kbd", null, "↓"), "navigate"),
          React.createElement("span", { className: "fk" }, React.createElement("kbd", null, "↵"), "run"),
          React.createElement("span", { className: "fk", style: { marginLeft: "auto" } }, "Life OS")
        )
      )
    )
  );
}

Object.assign(window, { AmbientPanel, TaskPanel, CommandPalette });
