/* Life OS — Brain Dump view: capture textarea → parsed candidate cards */

const PROJECT_HINTS = [
  { re: /conductor|cond\b|scheduler|sow|renewal/i, project: "COND", area: "client" },
  { re: /herald|hrld|briefing|webhook|telegram|digest/i, project: "HRLD", area: "client" },
  { re: /\bacr\b|agent|dispatch|queue|backoff|retry/i, project: "ACR", area: "internal" },
  { re: /mcpat|today view|capture|palette|dashboard|tokens/i, project: "MCPAT", area: "internal" },
  { re: /\b(hike|run|read|dentist|tax|domain|dns|book|call mom|gym)\b/i, project: "GEN", area: "personal" },
  { re: /contractor|outsource|delegate|logo|design/i, project: "HRLD", area: "outsource" },
];

function inferCandidate(line, i) {
  const text = line.trim().replace(/^[-*•\d.]+\s*/, "");
  let project = "GEN", area = "personal";
  for (const h of PROJECT_HINTS) { if (h.re.test(text)) { project = h.project; area = h.area; break; } }
  // crude title: first clause, capitalized
  let title = text.split(/[.;—]| - /)[0].trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 70) title = title.slice(0, 67) + "…";
  const whyMatch = text.match(/because (.*)/i) || text.match(/so (?:that |i )?(.*)/i);
  const why = whyMatch ? whyMatch[1].trim().replace(/[.;]$/, "") : "";
  return { id: "cand-" + i + "-" + Date.now(), title, project, area, why, whyOpen: !!why, source: text };
}

function parseDump(text) {
  return text.split(/\n+/).map((l) => l.trim())
    .filter((l) => l.length > 3)
    .flatMap((l) => l.length > 120 ? l.split(/(?<=[.!?])\s+/).filter((s) => s.length > 6) : [l])
    .slice(0, 8)
    .map(inferCandidate);
}

function CandidateCard({ cand, autoFocus, acrOnline, onChange, onCreate, onAcr, onDiscard }) {
  const Icon = window.Icon;
  const set = (patch) => onChange({ ...cand, ...patch });
  return (
    React.createElement("div", { className: "cand-card" },
      React.createElement("input", {
        className: "cc-title-input", autoFocus, value: cand.title,
        onChange: (e) => set({ title: e.target.value }),
        placeholder: "Task title",
      }),
      React.createElement("div", { className: "cc-controls" },
        React.createElement("select", { className: "cc-select", value: cand.project, onChange: (e) => set({ project: e.target.value }) },
          PROJECTS.map((p) => React.createElement("option", { key: p.prefix, value: p.prefix }, p.prefix + " · " + p.name))
        ),
        React.createElement("div", { className: "cc-area-chips" },
          Object.keys(AREAS).map((a) =>
            React.createElement("button", {
              key: a, className: "cc-area-chip " + (cand.area === a ? "sel" : ""),
              style: cand.area === a ? { color: AREAS[a].color } : undefined,
              onClick: () => set({ area: a }),
            },
              React.createElement("span", { className: "d", style: { background: AREAS[a].color } }),
              AREAS[a].label
            )
          )
        ),
        React.createElement("button", {
          className: "btn sm ghost", style: { marginLeft: "auto" },
          onClick: () => set({ whyOpen: !cand.whyOpen }),
        }, cand.whyOpen ? "− Why" : "+ Why")
      ),
      cand.whyOpen && React.createElement("textarea", {
        className: "cc-why", style: { width: "100%", border: "none", resize: "vertical", minHeight: 38, outline: "none" },
        placeholder: "Why does this matter? (optional)", value: cand.why,
        onChange: (e) => set({ why: e.target.value }),
      }),
      React.createElement("div", { className: "cc-actions" },
        React.createElement("button", { className: "btn sm primary", onClick: () => onCreate(cand) },
          React.createElement(Icon.Check, { size: 13 }), "Create task"),
        React.createElement("button", {
          className: "btn sm", disabled: !acrOnline, title: acrOnline ? "Send to autonomous agent" : "ACR offline",
          style: !acrOnline ? { opacity: 0.45, cursor: "not-allowed" } : undefined,
          onClick: () => acrOnline && onAcr(cand),
        }, React.createElement(Icon.Send, { size: 13 }), "ACR"),
        React.createElement("div", { className: "spacer" }),
        React.createElement("button", { className: "btn sm ghost", onClick: () => onDiscard(cand) },
          React.createElement(Icon.X, { size: 14 }))
      )
    )
  );
}

const SAMPLE_DUMP = `Fix the duplicate-claim race in Conductor before it bites a client again
Herald webhooks are dropping ~2% of events — probably the same retry gap as ACR
Add fuzzy ranking to the command palette so it shows recent commands first
Renew the domain this week because it expires in 6 days
Hand the Herald logo redraw to the contractor — not my craft
Read the stock-and-flow chapter of Thinking in Systems`;

function BrainDumpView({ acrOnline, onCreateTasks, onToast, seed }) {
  const Icon = window.Icon;
  const [text, setText] = React.useState(SAMPLE_DUMP);
  const [phase, setPhase] = React.useState("input"); // input | processing | review | done
  const [cands, setCands] = React.useState([]);
  const [recording, setRecording] = React.useState(false);
  const [createdCount, setCreatedCount] = React.useState(0);
  const taRef = React.useRef(null);

  const process = () => {
    if (!text.trim()) return;
    setPhase("processing");
    setTimeout(() => {
      const parsed = parseDump(text);
      if (parsed.length === 0) { setPhase("input"); onToast("Couldn't parse that — your text is preserved."); return; }
      setCands(parsed); setPhase("review"); setCreatedCount(0);
    }, 1100);
  };

  const voice = () => {
    setRecording(true);
    setTimeout(() => {
      setRecording(false);
      setText((t) => (t ? t + "\n" : "") + "Call the accountant about the Q3 filing deadline");
      onToast("Transcribed via Whisper");
    }, 1600);
  };

  React.useEffect(() => {
    if (seed && seed.nonce) { setText(seed.text || ""); setPhase("input"); setCands([]); setTimeout(() => taRef.current && taRef.current.focus(), 60); }
  }, [seed && seed.nonce]);

  React.useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && phase === "input") { e.preventDefault(); process(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [text, phase]);

  const updateCand = (c) => setCands((cs) => cs.map((x) => (x.id === c.id ? c : x)));
  const removeCand = (c) => setCands((cs) => cs.filter((x) => x.id !== c.id));
  const createOne = (c) => { onCreateTasks([c]); setCreatedCount((n) => n + 1); removeCand(c); };
  const createAll = () => { onCreateTasks(cands); setCreatedCount((n) => n + cands.length); setCands([]); };
  const sendAcr = (c) => { onToast("Dispatched “" + c.title.slice(0, 28) + "…” to ACR"); removeCand(c); };

  React.useEffect(() => { if (phase === "review" && cands.length === 0 && createdCount > 0) setPhase("done"); }, [cands, phase, createdCount]);

  return (
    React.createElement("div", { className: "fade-up" },
      React.createElement("div", { className: "view-head" },
        React.createElement("h1", null, "Brain dump"),
        React.createElement("span", { className: "sub" }, "Write anything. It gets decomposed — no routing decisions.")
      ),
      phase === "input" && React.createElement(React.Fragment, null,
        React.createElement("div", { className: "bd-textarea-wrap" },
          React.createElement("textarea", {
            ref: taRef, className: "bd-textarea", value: text, onChange: (e) => setText(e.target.value),
            placeholder: "Write anything. Tasks, ideas, worries, plans. ⌘+Enter to process.",
          }),
          React.createElement("button", { className: "mic-btn bd-mic " + (recording ? "recording" : ""), onClick: voice, title: "Voice capture (Whisper)" },
            React.createElement(Icon.Mic, { size: 16 })),
          React.createElement("span", { className: "bd-counter" }, text.length + " chars · " + text.split(/\n+/).filter((l) => l.trim()).length + " lines")
        ),
        React.createElement("div", { className: "bd-toolbar" },
          React.createElement("span", { style: { fontSize: 12.5, color: "var(--muted)" } }, recording ? "Listening…" : "Drafts are never lost while processing."),
          React.createElement("div", { className: "spacer" }),
          React.createElement("button", { className: "btn", onClick: () => setText("") }, "Clear"),
          React.createElement("button", { className: "btn primary", onClick: process, disabled: !text.trim() },
            React.createElement(Icon.Brain, { size: 14 }), "Process",
            React.createElement("kbd", { style: { marginLeft: 4, background: "rgba(255,255,255,0.15)", borderColor: "transparent", color: "#fff" } }, "⌘↵"))
        )
      ),
      phase === "processing" && React.createElement("div", { className: "bd-processing" },
        React.createElement("span", { className: "bd-spinner" }),
        "Parsing " + parseDump(text).length + " tasks from your dump…"
      ),
      phase === "review" && React.createElement(React.Fragment, null,
        React.createElement("div", { className: "bd-bulk" },
          React.createElement("span", { className: "section-label" }, cands.length + " candidates"),
          React.createElement("div", { style: { flex: 1 } }),
          React.createElement("button", { className: "btn sm", onClick: () => { setPhase("input"); } }, "Back to text"),
          React.createElement("button", { className: "btn sm primary", onClick: createAll },
            React.createElement(Icon.Check, { size: 13 }), "Create all " + cands.length)
        ),
        cands.map((c, i) =>
          React.createElement(CandidateCard, {
            key: c.id, cand: c, autoFocus: i === 0, acrOnline,
            onChange: updateCand, onCreate: createOne, onAcr: sendAcr, onDiscard: removeCand,
          })
        )
      ),
      phase === "done" && React.createElement("div", { className: "empty-state" },
        React.createElement("div", { className: "es-ico" }, React.createElement(Icon.CheckCircle, { size: 32 })),
        React.createElement("div", { className: "es-title" }, createdCount + " task" + (createdCount === 1 ? "" : "s") + " created"),
        React.createElement("div", { className: "es-sub" }, "They're in your inbox and ready to commit to today."),
        React.createElement("button", { className: "btn", style: { marginTop: 16 }, onClick: () => { setText(""); setCreatedCount(0); setPhase("input"); } },
          React.createElement(Icon.Plus, { size: 14 }), "Dump again")
      )
    )
  );
}

Object.assign(window, { BrainDumpView });
