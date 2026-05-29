/* Life OS — icon set. Lucide-style 1.5px strokes. Exports to window.Icon. */
const Icon = (function () {
  const S = ({ children, size = 16, sw = 1.6, style }) => {
    const kids = Array.isArray(children)
      ? children.map((c, i) => (c && c.type ? React.cloneElement(c, { key: i }) : c))
      : children;
    return React.createElement("svg", {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round",
      strokeLinejoin: "round", style,
    }, kids);
  };
  const p = (d) => React.createElement("path", { d });
  const el = (t, a) => React.createElement(t, a);

  return {
    Today: (x) => S({ ...x, children: [el("rect", { key: 1, x: 3, y: 4.5, width: 18, height: 16, rx: 2 }), p("M3 9h18"), el("path", { key: 3, d: "M8 3v3" }), el("path", { key: 4, d: "M16 3v3" }), el("path", { key: 5, d: "M12 13.5l-1.5 1.5L12 16.5" }) ] }),
    Sun: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 12, cy: 12, r: 4 }), p("M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4")] }),
    Board: (x) => S({ ...x, children: [el("rect", { key: 1, x: 3, y: 4, width: 6, height: 16, rx: 1.5 }), el("rect", { key: 2, x: 11, y: 4, width: 6, height: 11, rx: 1.5 }), el("rect", { key: 3, x: 19, y: 4, width: 2, height: 7, rx: 1 })] }),
    Brain: (x) => S({ ...x, children: p("M9.5 3.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.2A3 3 0 0 0 6.5 17a3 3 0 0 0 3 3.5 2.5 2.5 0 0 0 2.5-2.5V6a2.5 2.5 0 0 0-2.5-2.5zM14.5 3.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.2A3 3 0 0 1 17.5 17a3 3 0 0 1-3 3.5 2.5 2.5 0 0 1-2.5-2.5") }),
    Files: (x) => S({ ...x, children: [p("M14 3v4a1 1 0 0 0 1 1h4"), p("M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z")] }),
    Map: (x) => S({ ...x, children: [p("M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"), p("M9 4v14M15 6v14")] }),
    Activity: (x) => S({ ...x, children: p("M3 12h4l3 8 4-16 3 8h4") }),
    Search: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 11, cy: 11, r: 7 }), p("M21 21l-4.3-4.3")] }),
    Mic: (x) => S({ ...x, children: [el("rect", { key: 1, x: 9, y: 3, width: 6, height: 11, rx: 3 }), p("M5 11a7 7 0 0 0 14 0M12 18v3")] }),
    Plus: (x) => S({ ...x, children: p("M12 5v14M5 12h14") }),
    Check: (x) => S({ ...x, children: p("M20 6 9 17l-5-5") }),
    CheckCircle: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 12, cy: 12, r: 9 }), p("M8.5 12l2.5 2.5 4.5-5")] }),
    Pause: (x) => S({ ...x, children: [p("M8 5v14"), p("M16 5v14")] }),
    Ban: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 12, cy: 12, r: 9 }), p("M5.6 5.6l12.8 12.8")] }),
    X: (x) => S({ ...x, children: p("M18 6 6 18M6 6l12 12") }),
    Chevron: (x) => S({ ...x, children: p("M9 6l6 6-6 6") }),
    ChevronDown: (x) => S({ ...x, children: p("M6 9l6 6 6-6") }),
    Dots: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 5, cy: 12, r: 1.4 }), el("circle", { key: 2, cx: 12, cy: 12, r: 1.4 }), el("circle", { key: 3, cx: 19, cy: 12, r: 1.4 })] }),
    Copy: (x) => S({ ...x, children: [el("rect", { key: 1, x: 9, y: 9, width: 11, height: 11, rx: 2 }), p("M5 15V5a2 2 0 0 1 2-2h8")] }),
    Link: (x) => S({ ...x, children: [p("M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"), p("M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1")] }),
    Git: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 6, cy: 6, r: 2.5 }), el("circle", { key: 2, cx: 6, cy: 18, r: 2.5 }), el("circle", { key: 3, cx: 18, cy: 9, r: 2.5 }), p("M6 8.5v7M18 11.5a6 6 0 0 1-6 6H9")] }),
    Doc: (x) => S({ ...x, children: [p("M14 3v4a1 1 0 0 0 1 1h4"), p("M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"), p("M9 13h6M9 17h4")] }),
    Robot: (x) => S({ ...x, children: [el("rect", { key: 1, x: 4, y: 8, width: 16, height: 12, rx: 2 }), p("M12 8V4M9 4h6"), el("circle", { key: 3, cx: 9, cy: 14, r: 1 }), el("circle", { key: 4, cx: 15, cy: 14, r: 1 }), p("M2 13v3M22 13v3")] }),
    Send: (x) => S({ ...x, children: p("M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z") }),
    Cmd: (x) => S({ ...x, children: p("M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z") }),
    Arrow: (x) => S({ ...x, children: p("M5 12h14M13 6l6 6-6 6") }),
    Clock: (x) => S({ ...x, children: [el("circle", { key: 1, cx: 12, cy: 12, r: 9 }), p("M12 7v5l3 2")] }),
    Hash: (x) => S({ ...x, children: p("M4 9h16M4 15h16M10 3 8 21M16 3l-2 18") }),
    Corner: (x) => S({ ...x, children: p("M9 10 4 15l5 5M4 15h12a4 4 0 0 0 4-4V4") }),
    Focus: (x) => S({ ...x, children: [p("M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"), el("circle", { key: 2, cx: 12, cy: 12, r: 3 })] }),
    Inbox: (x) => S({ ...x, children: [p("M22 12h-6l-2 3h-4l-2-3H2"), p("M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z")] }),
    Star: (x) => S({ ...x, children: p("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z") }),
    StarFill: (x) => S({ ...x, sw: 0, children: React.createElement("path", { d: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z", fill: "currentColor" }) }),
    Filter: (x) => S({ ...x, children: p("M3 5h18M6 12h12M10 19h4") }),
    Zap: (x) => S({ ...x, children: p("M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z") }),
    Beaker: (x) => S({ ...x, children: [p("M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3"), p("M7.5 14h9")] }),
    Lock: (x) => S({ ...x, children: [el("rect", { key: 1, x: 4.5, y: 11, width: 15, height: 9, rx: 2 }), p("M8 11V8a4 4 0 0 1 8 0v3")] }),
    Repeat: (x) => S({ ...x, children: [p("M17 2l3 3-3 3"), p("M3 11V9a4 4 0 0 1 4-4h13"), p("M7 22l-3-3 3-3"), p("M21 13v2a4 4 0 0 1-4 4H4")] }),
    Hand: (x) => S({ ...x, children: p("M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.9-1.9L4 17.5a1.6 1.6 0 0 1 2.5-2L8 17V9.5a1.5 1.5 0 0 1 3 0") }),
    Wand: (x) => S({ ...x, children: [p("M15 4V2M15 10V8M11 6H9M21 6h-2"), p("M5 21 17 9l-2-2L3 19z"), p("M14 8l2 2")] }),
    Bolt: (x) => S({ ...x, sw: 0, children: React.createElement("path", { d: "M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z", fill: "currentColor" }) }),
    Server: (x) => S({ ...x, children: [el("rect", { key: 1, x: 3.5, y: 4, width: 17, height: 7, rx: 1.5 }), el("rect", { key: 2, x: 3.5, y: 13, width: 17, height: 7, rx: 1.5 }), el("circle", { key: 3, cx: 7.5, cy: 7.5, r: 0.6 }), el("circle", { key: 4, cx: 7.5, cy: 16.5, r: 0.6 })] }),
    Expand: (x) => S({ ...x, children: [p("M4 14h6v6"), p("M20 10h-6V4"), p("M14 10l7-7M10 14l-7 7")] }),
  };
})();
window.Icon = Icon;
