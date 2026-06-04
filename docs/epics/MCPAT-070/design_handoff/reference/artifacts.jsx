/* Life OS — Artifacts view */

function staleClass(d) { return d <= 7 ? "stale-fresh" : d <= 21 ? "stale-mid" : "stale-old"; }

function ArtifactRow({ a, onCopy, onTask }) {
  const Icon = window.Icon;
  const [copied, setCopied] = React.useState(false);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard && navigator.clipboard.writeText(a.path).catch(() => {});
    setCopied(true); onCopy(a.name); setTimeout(() => setCopied(false), 1400);
  };
  return (
    React.createElement("div", { className: "artifact-row", title: a.path },
      React.createElement("span", { className: "file-ico fi-" + a.ext }, a.ext),
      React.createElement("div", { className: "art-main" },
        React.createElement("div", { className: "art-name" },
          a.name,
          a.unvisited && React.createElement("span", { className: "unvisited-dot", title: "Not yet viewed" })
        ),
        React.createElement("div", { className: "art-path" }, a.path)
      ),
      React.createElement(PrefixBadge, { project: a.project }),
      React.createElement("span", { className: "stale-badge " + staleClass(a.days), title: "Days since last viewed" }, a.days + "d"),
      React.createElement("div", { className: "art-actions" },
        copied
          ? React.createElement("span", { className: "copied-tip" }, "copied")
          : React.createElement("button", { className: "icon-btn", title: "Copy path", onClick: copy }, React.createElement(Icon.Copy, { size: 15 })),
        a.task_id && React.createElement("button", { className: "icon-btn", title: "Open linked task " + a.task_id, onClick: (e) => { e.stopPropagation(); onTask(a.task_id); } },
          React.createElement(Icon.Link, { size: 15 }))
      )
    )
  );
}

function ArtifactsView({ artifacts, onToast, onTask, filterProps, filter }) {
  const f = filter || { projects: [], areas: [] };
  const sorted = [...artifacts].filter((a) => window.matchFilter(f, a.project)).sort((a, b) => b.days - a.days);
  const unvisited = sorted.filter((a) => a.unvisited).length;
  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Artifacts"),
        React.createElement("span", { className: "sub" }, "last 30 days · " + sorted.length + " files · " + unvisited + " unvisited")
      ),
      React.createElement(window.FilterBar, filterProps),
      React.createElement("div", { style: { fontSize: 12, color: "var(--muted)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 } },
        React.createElement(window.Icon.Clock, { size: 13 }),
        "Sorted by staleness — oldest-viewed first. This is what you might be forgetting."
      ),
      sorted.length === 0
        ? (window.filterActive(f)
            ? React.createElement("div", { className: "filter-empty" }, "No artifacts match the current filter.")
            : React.createElement("div", { className: "empty-state" },
                React.createElement("div", { className: "es-ico" }, React.createElement(window.Icon.Files, { size: 32 })),
                React.createElement("div", { className: "es-title" }, "No artifacts yet"),
                React.createElement("div", { className: "es-sub" }, "They'll appear here automatically whenever Claude creates or edits files for you.")))
        : React.createElement("div", { className: "list-block" },
            sorted.map((a) => React.createElement(ArtifactRow, { key: a.path, a, onCopy: (n) => onToast("Copied path · " + n), onTask }))
          )
    )
  );
}

Object.assign(window, { ArtifactsView });
