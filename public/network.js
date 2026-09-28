// Build Network: nodes for the accounts you have, arrows for the bridges you
// want. While an arrow is being dragged the target lights up with whether the
// bridge is possible, how, and whether each end has a working key.
(() => {
  const af = window.af;
  const $ = (sel) => document.querySelector(sel);
  const canvas = $("#canvas");
  const svg = $("#arrows");
  const NS = "http://www.w3.org/2000/svg";

  const LEVELS = {
    direct: { label: "Possible, direct", color: "#15803d" },
    orchestrator: { label: "Possible with an orchestrator", color: "#1d4ed8" },
    partial: { label: "Possible up to a point", color: "#b45309" },
    partner: { label: "Needs a partner key", color: "#b45309" },
    human: { label: "Ends with a human step", color: "#c2410c" },
    blocked: { label: "Not possible", color: "#b91c1c" },
  };

  const net = {
    nodes: new Map(), // id -> {x, y}
    bridges: [], // [{from, to}]
    pairs: {},
    drag: null,
  };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem("agentforge.network") || "{}");
      for (const [id, pos] of Object.entries(saved.nodes || {})) net.nodes.set(id, pos);
      net.bridges = (saved.bridges || []).filter((b) => b.from && b.to);
    } catch {
      // start empty
    }
  }

  function persist() {
    localStorage.setItem("agentforge.network", JSON.stringify({ nodes: Object.fromEntries(net.nodes), bridges: net.bridges }));
  }

  // Nodes follow the accounts ticked above; anything added here is ticked too.
  function syncNodes() {
    const selected = af.selectedIds().filter((id) => af.service(id));
    for (const id of selected) if (!net.nodes.has(id)) net.nodes.set(id, freeSpot());
    for (const id of [...net.nodes.keys()]) if (!selected.includes(id)) net.nodes.delete(id);
    net.bridges = net.bridges.filter((b) => net.nodes.has(b.from) && net.nodes.has(b.to));
  }

  function freeSpot() {
    const n = net.nodes.size;
    const w = canvas.clientWidth || 900;
    const cols = Math.max(2, Math.floor(w / 190));
    return { x: 24 + (n % cols) * 180, y: 24 + Math.floor(n / cols) * 110 };
  }

  async function refresh() {
    syncNodes();
    const ids = [...net.nodes.keys()];
    net.pairs = ids.length > 1 ? (await af.api("/api/network", { nodes: ids })).pairs : {};
    render();
    persist();
  }

  function render() {
    canvas.querySelectorAll(".node").forEach((n) => n.remove());
    for (const [id, pos] of net.nodes) canvas.append(nodeEl(id, pos));
    drawArrows();
    renderBridges();
    $("#network-empty").hidden = net.nodes.size > 0;
  }

  function nodeEl(id, pos) {
    const s = af.service(id);
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.id = id;
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
    const status = keyStatus(s);
    node.innerHTML = `<div class="node-name"></div><div class="node-status ${status.cls}"></div><div class="port" title="Drag to another account"></div>`;
    node.querySelector(".node-name").textContent = s.name;
    node.querySelector(".node-status").textContent = status.text;
    node.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("port")) return startArrow(e, id);
      startMove(e, id, node);
    });
    return node;
  }

  function keyStatus(s) {
    const saved = s.keys.length > 0 && s.keys.every((k) => af.saved()[k.env]);
    if (!s.keys.length) return { cls: "none", text: s.access === "none" ? "no API" : "no key needed" };
    if (!saved) return { cls: "missing", text: "no key" };
    if (af.verified()[s.id]) return { cls: "ok", text: "key tested" };
    return { cls: "saved", text: "key saved, untested" };
  }

  // --- moving nodes ------------------------------------------------------

  function startMove(e, id, node) {
    e.preventDefault();
    const pos = net.nodes.get(id);
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev) => {
      pos.x = Math.max(0, Math.min(canvas.clientWidth - node.offsetWidth, ev.clientX - start.x));
      pos.y = Math.max(0, Math.min(canvas.clientHeight - node.offsetHeight, ev.clientY - start.y));
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
      drawArrows();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // --- dragging an arrow -------------------------------------------------

  function startArrow(e, from) {
    e.preventDefault();
    e.stopPropagation();
    const temp = document.createElementNS(NS, "path");
    temp.setAttribute("class", "arrow temp");
    svg.append(temp);
    const hint = $("#hint");
    net.drag = { from, temp, over: null };

    const move = (ev) => {
      const a = center(from);
      const p = toCanvas(ev.clientX, ev.clientY);
      temp.setAttribute("d", curve(a, p));
      const target = ev.target.closest?.(".node");
      const over = target && target.dataset.id !== from ? target.dataset.id : null;
      if (over !== net.drag.over) {
        canvas.querySelectorAll(".node.over").forEach((n) => n.classList.remove("over"));
        net.drag.over = over;
        if (over) {
          target.classList.add("over");
          showHint(hint, from, over, ev);
        } else {
          hint.hidden = true;
        }
      } else if (over) {
        hint.style.left = `${ev.clientX + 16}px`;
        hint.style.top = `${ev.clientY + 16}px`;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      temp.remove();
      hint.hidden = true;
      canvas.querySelectorAll(".node.over").forEach((n) => n.classList.remove("over"));
      if (net.drag.over) addBridge(from, net.drag.over);
      net.drag = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function showHint(hint, from, to, ev) {
    const r = net.pairs[`${from}>${to}`];
    if (!r) return;
    const lvl = LEVELS[r.level];
    hint.innerHTML = "";
    hint.append(pill(r.level), el("strong", "", r.title), endLine(r.ends.from), endLine(r.ends.to));
    hint.style.borderColor = lvl.color;
    hint.style.left = `${ev.clientX + 16}px`;
    hint.style.top = `${ev.clientY + 16}px`;
    hint.hidden = false;
  }

  function endLine(end) {
    const s = af.service(end.id);
    const st = keyStatus(s);
    const line = el("div", `end ${st.cls}`);
    line.textContent = `${end.name}: ${end.access === "none" ? "no API" : st.text}`;
    return line;
  }

  function addBridge(from, to) {
    if (net.bridges.some((b) => b.from === from && b.to === to)) return;
    net.bridges.push({ from, to });
    persist();
    drawArrows();
    renderBridges();
  }

  function removeBridge(i) {
    net.bridges.splice(i, 1);
    persist();
    drawArrows();
    renderBridges();
  }

  // --- drawing -----------------------------------------------------------

  function drawArrows() {
    svg.querySelectorAll(".arrow:not(.temp)").forEach((a) => a.remove());
    svg.setAttribute("width", canvas.clientWidth);
    svg.setAttribute("height", canvas.clientHeight);
    net.bridges.forEach((b, i) => {
      const r = net.pairs[`${b.from}>${b.to}`];
      const path = document.createElementNS(NS, "path");
      path.setAttribute("class", "arrow");
      path.setAttribute("d", curve(center(b.from), center(b.to)));
      path.setAttribute("stroke", r ? LEVELS[r.level].color : "#9ca3af");
      path.setAttribute("marker-end", `url(#head-${r ? r.level : "blocked"})`);
      path.addEventListener("click", () => {
        document.querySelectorAll(".bridge").forEach((n) => n.classList.remove("focus"));
        document.querySelector(`.bridge[data-i="${i}"]`)?.classList.add("focus");
        document.querySelector(`.bridge[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      svg.append(path);
    });
  }

  function center(id) {
    const node = canvas.querySelector(`.node[data-id="${id}"]`);
    const pos = net.nodes.get(id);
    return { x: pos.x + (node?.offsetWidth ?? 160) / 2, y: pos.y + (node?.offsetHeight ?? 56) / 2 };
  }

  function toCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function curve(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  // --- the list under the canvas -------------------------------------------

  function renderBridges() {
    const list = $("#bridges");
    list.innerHTML = "";
    if (!net.bridges.length) {
      list.append(el("p", "muted", "Drag from the dot on one account to another account to ask whether they can be bridged."));
      $("#network-summary").hidden = true;
      return;
    }
    net.bridges.forEach((b, i) => {
      const r = net.pairs[`${b.from}>${b.to}`];
      if (!r) return;
      const card = el("div", "bridge card");
      card.dataset.i = i;
      const head = el("div", "row");
      head.append(el("h4", "", `${af.nameOf(b.from)} → ${af.nameOf(b.to)}`), pill(r.level));
      card.append(head, el("strong", "", r.title), el("p", "", r.text));
      const ends = el("div", "ends");
      for (const end of [r.ends.from, r.ends.to]) {
        const s = af.service(end.id);
        const st = keyStatus(s);
        const row = el("div", `end ${st.cls}`);
        row.append(el("span", "", `${end.name}: ${end.access === "none" ? "no API" : st.text}`));
        if (s.keys.length && (!end.keySaved || !af.verified()[s.id])) {
          const btn = el("button", "ghost small", end.keySaved ? "Test key" : "Add key");
          btn.addEventListener("click", () => af.openModal(s));
          row.append(btn);
        }
        ends.append(row);
      }
      card.append(ends);
      if (r.hubs?.length) card.append(el("p", "muted small", `Connects both without code: ${r.hubs.map((h) => h.name).join(", ")}.`));
      const remove = el("button", "ghost small", "Remove");
      remove.addEventListener("click", () => removeBridge(i));
      card.append(remove);
      list.append(card);
    });
    renderSummary();
  }

  function renderSummary() {
    const box = $("#network-summary");
    const results = net.bridges.map((b) => net.pairs[`${b.from}>${b.to}`]).filter(Boolean);
    const counts = {};
    for (const r of results) counts[r.level] = (counts[r.level] || 0) + 1;
    const parts = Object.entries(counts).map(([lvl, n]) => `${n} ${LEVELS[lvl].label.toLowerCase()}`);
    const needHub = results.filter((r) => r.level === "orchestrator" || r.level === "partial" || r.level === "partner");
    let hubLine = "";
    if (needHub.length) {
      const common = needHub.reduce((acc, r) => acc.filter((h) => r.hubs.some((x) => x.id === h.id)), needHub[0].hubs);
      hubLine = common.length
        ? `${common.map((h) => h.name).join(" or ")} can carry every bridge that needs a middle piece.`
        : "No single workflow tool covers every bridge that needs one; expect a short script for the rest.";
    }
    const hasModel = [...net.nodes.keys()].some((id) => af.service(id).category === "model");
    box.innerHTML = "";
    box.append(el("strong", "", `${results.length} bridge${results.length === 1 ? "" : "s"}: ${parts.join(", ")}.`));
    if (!hasModel) box.append(el("p", "", "There is no model in this network yet. Add an Anthropic or OpenAI account so something can decide what happens on each bridge."));
    if (hubLine) box.append(el("p", "", hubLine));
    box.hidden = false;
  }

  function pill(level) {
    const p = el("span", "pill", LEVELS[level].label);
    p.style.background = LEVELS[level].color + "1a";
    p.style.color = LEVELS[level].color;
    return p;
  }

  function el(tag, cls = "", text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Arrowheads, one per level colour.
  const defs = document.createElementNS(NS, "defs");
  for (const [level, { color }] of Object.entries(LEVELS)) {
    const m = document.createElementNS(NS, "marker");
    m.setAttribute("id", `head-${level}`);
    m.setAttribute("viewBox", "0 0 10 10");
    m.setAttribute("refX", "9");
    m.setAttribute("refY", "5");
    m.setAttribute("markerWidth", "7");
    m.setAttribute("markerHeight", "7");
    m.setAttribute("orient", "auto-start-reverse");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    p.setAttribute("fill", color);
    m.append(p);
    defs.append(m);
  }
  svg.append(defs);

  $("#add-node").addEventListener("change", (e) => {
    if (!e.target.value) return;
    af.select(e.target.value);
    e.target.value = "";
  });
  $("#clear-network").addEventListener("click", () => {
    net.bridges = [];
    persist();
    drawArrows();
    renderBridges();
  });
  window.addEventListener("resize", drawArrows);

  af.onChange(refresh);
  load();
  window.afNetwork = { refresh };
})();
