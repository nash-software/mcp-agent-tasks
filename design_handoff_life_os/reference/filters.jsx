/* Life OS — global filter: matchFilter helper + FilterBar component */

// project -> area lookup for non-task records (artifacts, milestones, activity)
function areaOfProject(prefix) { const p = window.projById[prefix]; return p ? p.area : null; }
function projectOfId(id) { return String(id).split("-")[0]; }

// filter = { projects: [], areas: [] }
function matchFilter(filter, project, area) {
  if (filter.projects.length && !filter.projects.includes(project)) return false;
  if (filter.areas.length) {
    const a = area != null ? area : areaOfProject(project);
    if (!filter.areas.includes(a)) return false;
  }
  return true;
}
function filterActive(filter) { return filter.projects.length > 0 || filter.areas.length > 0; }

function Checkbox({ on }) {
  return React.createElement("span", {
    style: {
      width: 15, height: 15, borderRadius: 4, flexShrink: 0,
      border: "1px solid " + (on ? "var(--accent)" : "var(--s3)"),
      background: on ? "var(--accent)" : "transparent",
      display: "grid", placeItems: "center", color: "#fff",
    },
  }, on && React.createElement(window.Icon.Check, { size: 11 }));
}

function FilterBar({ filter, favorites, projectCounts, onToggleProject, onToggleArea, onToggleFav, onClear }) {
  const Icon = window.Icon;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const favProjects = PROJECTS.filter((p) => favorites.includes(p.prefix));
  const active = filterActive(filter);

  return (
    React.createElement("div", { className: "filter-bar" },
      // favourite quick chips
      favProjects.map((p) =>
        React.createElement("button", {
          key: p.prefix,
          className: "fav-chip " + (filter.projects.includes(p.prefix) ? "active" : ""),
          onClick: () => onToggleProject(p.prefix), title: p.name,
        },
          React.createElement(Icon.StarFill, { size: 11, style: { color: "var(--amber)" } }),
          React.createElement("span", { className: "fc-prefix" }, p.prefix),
          projectCounts[p.prefix] ? React.createElement("span", { className: "fc-count" }, projectCounts[p.prefix]) : null
        )
      ),
      favProjects.length > 0 && React.createElement("span", { className: "fb-divider" }),

      // filter button + popover
      React.createElement("div", { className: "filter-anchor", ref },
        React.createElement("button", { className: "filter-btn " + (open || active ? "on" : ""), onClick: () => setOpen((o) => !o) },
          React.createElement(Icon.Filter, { size: 13 }), "Filter",
          active && React.createElement("span", { className: "filter-btn-n" }, filter.projects.length + filter.areas.length)
        ),
        open && React.createElement("div", { className: "filter-pop" },
          React.createElement("div", { className: "filter-pop-sec" },
            React.createElement("div", { className: "section-label", style: { padding: "2px 4px 8px" } }, "Projects"),
            PROJECTS.map((p) =>
              React.createElement("div", { key: p.prefix, className: "filter-pop-row" },
                React.createElement("button", { className: "fpr-main", onClick: () => onToggleProject(p.prefix) },
                  React.createElement(Checkbox, { on: filter.projects.includes(p.prefix) }),
                  React.createElement("span", { className: "fpr-prefix" }, p.prefix),
                  React.createElement("span", { className: "fpr-name" }, p.name),
                  React.createElement(AreaDot, { area: p.area })
                ),
                React.createElement("button", {
                  className: "fav-star " + (favorites.includes(p.prefix) ? "on" : ""),
                  title: favorites.includes(p.prefix) ? "Unfavourite" : "Favourite — pins to sidebar",
                  onClick: (e) => { e.stopPropagation(); onToggleFav(p.prefix); },
                }, React.createElement(favorites.includes(p.prefix) ? Icon.StarFill : Icon.Star, { size: 14 }))
              )
            )
          ),
          React.createElement("div", { className: "filter-pop-sec", style: { borderTop: "1px solid var(--s3)" } },
            React.createElement("div", { className: "section-label", style: { padding: "2px 4px 8px" } }, "Areas"),
            React.createElement("div", { className: "fp-areas" },
              Object.keys(AREAS).map((a) =>
                React.createElement("button", {
                  key: a, className: "fp-area-chip " + (filter.areas.includes(a) ? "sel" : ""),
                  style: filter.areas.includes(a) ? { color: AREAS[a].color, borderColor: "currentColor" } : undefined,
                  onClick: () => onToggleArea(a),
                },
                  React.createElement("span", { className: "d", style: { background: AREAS[a].color } }),
                  AREAS[a].label)
              )
            )
          )
        )
      ),

      // active filter chips
      filter.projects.map((p) =>
        React.createElement("button", { key: "fp-" + p, className: "filter-chip", onClick: () => onToggleProject(p) },
          React.createElement("span", { className: "fpr-prefix" }, p),
          React.createElement(Icon.X, { size: 12 }))
      ),
      filter.areas.map((a) =>
        React.createElement("button", { key: "fa-" + a, className: "filter-chip", onClick: () => onToggleArea(a) },
          React.createElement("span", { className: "d", style: { width: 7, height: 7, borderRadius: "50%", background: AREAS[a].color } }),
          AREAS[a].label,
          React.createElement(Icon.X, { size: 12 }))
      ),
      active && React.createElement("button", { className: "filter-clear", onClick: onClear }, "Clear")
    )
  );
}

Object.assign(window, { matchFilter, filterActive, areaOfProject, projectOfId, FilterBar });
