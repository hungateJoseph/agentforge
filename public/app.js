(() => {
  const state = { catalog: null, saved: {}, selected: new Set(), advice: null };
  const $ = (sel) => document.querySelector(sel);

  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    return res.json();
  }

  async function load() {
    state.catalog = await api("/api/catalog");
    state.saved = (await api("/api/env")).saved;
    $("#env-path").textContent = `Keys go to ${state.catalog.envFile}`;
    try {
      const remembered = JSON.parse(localStorage.getItem("agentforge.selected") || "[]");
      remembered.forEach((id) => state.selected.add(id));
    } catch {
      // ignore a broken value
    }
    // Anything that already has a key in the .env counts as an account you have.
    for (const s of state.catalog.services) {
      if (s.keys.length && s.keys.every((k) => state.saved[k.env])) state.selected.add(s.id);
    }
    renderServices();
    if (state.selected.size) refreshAdvice();
  }

  function renderServices() {
    const root = $("#services");
    root.innerHTML = "";
    for (const cat of state.catalog.categories) {
      const services = state.catalog.services.filter((s) => s.category === cat.id);
      if (!services.length) continue;
      const section = el("div", "category");
      section.append(el("h2", "", cat.name), el("p", "", cat.blurb));
      const grid = el("div", "grid");
      for (const s of services) grid.append(serviceCard(s));
      section.append(grid);
      root.append(section);
    }
    const bar = el("div", "sticky");
    const count = el("span", "muted", "");
    count.id = "count";
    const go = el("button", "", "Show my setup");
    go.addEventListener("click", refreshAdvice);
    bar.append(count, go);
    root.append(bar);
    updateCount();
  }

  function serviceCard(s) {
    const card = el("div", "service" + (state.selected.has(s.id) ? " on" : ""));
    const row = el("div", "row");
    const label = el("label", "", "");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.selected.has(s.id);
    box.addEventListener("change", () => {
      box.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
      card.classList.toggle("on", box.checked);
      localStorage.setItem("agentforge.selected", JSON.stringify([...state.selected]));
      updateCount();
    });
    label.append(box, " ", el("span", "name", s.name));
    row.append(label, el("span", `pill ${s.access}`, accessLabel(s)));
    card.append(row, el("div", "summary", s.summary));
    const actions = el("div", "actions");
    if (s.keys.length) {
      const saved = s.keys.every((k) => state.saved[k.env]);
      if (saved) actions.append(el("span", "pill saved", "key saved"));
      const add = el("button", "ghost", saved ? "Edit key" : "Add key");
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal(s);
      });
      actions.append(add);
    }
    const find = el("button", "ghost", "Find integrations");
    find.addEventListener("click", (e) => {
      e.stopPropagation();
      openDiscover(s);
    });
    actions.append(find);
    card.append(actions);
    card.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, label")) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
    });
    return card;
  }

  function accessLabel(s) {
    return { direct: "API + key", limited: "partial API", partner: "partner API", none: "no API" }[s.access];
  }

  function updateCount() {
    const n = state.selected.size;
    $("#count").textContent = n ? `${n} account${n === 1 ? "" : "s"} selected` : "Nothing selected yet";
  }

  // --- key modal ---------------------------------------------------------

  function openModal(s) {
    const modal = $("#modal");
    $("#modal-title").textContent = s.name;
    $("#modal-summary").textContent = s.summary;
    const form = $("#modal-form");
    form.innerHTML = "";
    for (const k of s.keys) {
      const field = el("div", "field");
      const label = el("label", "", k.label);
      label.htmlFor = `f-${k.env}`;
      const input = document.createElement("input");
      input.id = `f-${k.env}`;
      input.name = k.env;
      input.type = k.secret ? "password" : "text";
      input.placeholder = k.hint || k.env;
      input.autocomplete = "off";
      input.spellcheck = false;
      field.append(label, input);
      if (state.saved[k.env]) field.append(el("div", "saved", `Saved: ${state.saved[k.env]}. Leave blank to keep it, or type a new value.`));
      form.append(field);
    }
    const result = el("div", "result", "");
    result.id = "verify-result";
    form.append(result);
    $("#modal-link").innerHTML = s.getKey ? `Where to get it: <a href="${s.getKey}" target="_blank" rel="noopener">${s.getKey}</a>` : "";

    const actions = $(".modal-actions");
    actions.querySelectorAll(".test").forEach((b) => b.remove());
    if (s.canVerify) {
      const test = el("button", "ghost test", "Test");
      test.type = "button";
      test.addEventListener("click", async () => {
        test.disabled = true;
        result.textContent = "Checking…";
        result.className = "result";
        await saveForm(s, form);
        const r = await api(`/api/verify/${s.id}`, {});
        result.textContent = r.message;
        result.className = "result " + (r.ok ? "ok" : "bad");
        test.disabled = false;
      });
      actions.prepend(test);
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      await saveForm(s, form);
      closeModal();
      renderServices();
      if (state.selected.size) refreshAdvice();
    };
    modal.hidden = false;
    form.querySelector("input")?.focus();
  }

  async function saveForm(s, form) {
    const values = {};
    for (const k of s.keys) {
      const v = form.elements[k.env].value.trim();
      if (v) values[k.env] = v;
    }
    if (Object.keys(values).length) {
      await api("/api/env", { values });
      state.saved = (await api("/api/env")).saved;
      state.selected.add(s.id);
      localStorage.setItem("agentforge.selected", JSON.stringify([...state.selected]));
    }
  }

  function closeModal() {
    $("#modal").hidden = true;
  }
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => {
    if (e.target === $("#modal")) closeModal();
  });

  // --- discover ----------------------------------------------------------

  async function openDiscover(s) {
    const box = $("#discover");
    $("#discover-title").textContent = `Community integrations for ${s.name}`;
    const body = $("#discover-body");
    body.innerHTML = '<p class="muted">Searching GitHub…</p>';
    box.hidden = false;
    const r = await api(`/api/discover/${s.id}`);
    body.innerHTML = "";
    if (r.error) body.append(el("p", "result bad", r.error));
    for (const [kind, title] of [["mcp", "MCP servers"], ["n8n", "n8n community nodes"]]) {
      body.append(el("h3", "", title));
      if (!r[kind]?.length) {
        body.append(el("p", "muted small", "Nothing found."));
        continue;
      }
      for (const repo of r[kind]) {
        const row = el("div", "repo");
        const link = document.createElement("a");
        link.href = repo.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = repo.name;
        row.append(link, el("div", "", repo.description), el("div", "meta", `${repo.stars} stars · updated ${repo.updated}`));
        body.append(row);
      }
    }
    body.append(el("p", "muted small", "Results are whatever GitHub search ranks highest; check a repository before trusting it with a key."));
  }
  $("#discover-close").addEventListener("click", () => ($("#discover").hidden = true));
  $("#discover").addEventListener("click", (e) => {
    if (e.target === $("#discover")) $("#discover").hidden = true;
  });

  // --- report ------------------------------------------------------------

  async function refreshAdvice() {
    state.advice = await api("/api/advice", { selected: [...state.selected] });
    renderReport();
    $("#report").hidden = false;
    $("#report").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderReport() {
    const a = state.advice;
    const warnings = $("#warnings");
    warnings.innerHTML = "";
    for (const w of a.warnings) warnings.append(el("div", `notice ${w.level}`, w.text));

    const statuses = $("#statuses");
    statuses.innerHTML = "";
    for (const s of a.services) {
      const card = el("div", "card");
      const head = el("div", "row");
      head.append(el("h4", "", s.name), el("span", `pill ${s.access}`, s.title));
      card.append(head);
      if (s.keysMissing.length && s.access !== "none") card.append(el("p", "missing", `No key saved yet (${s.keysMissing.join(", ")}).`));
      const notes = el("ul");
      for (const n of s.notes) notes.append(el("li", "", n));
      card.append(notes);
      if (s.workarounds.length) {
        const fixes = el("div", "fixes");
        fixes.append(el("strong", "", "What to do instead"));
        const ul = el("ul");
        for (const w of s.workarounds) ul.append(el("li", "", w));
        fixes.append(ul);
        card.append(fixes);
      }
      statuses.append(card);
    }

    const pairings = $("#pairings");
    pairings.innerHTML = "";
    if (!a.pairings.length) pairings.append(el("p", "muted", "Add a model and at least one other account to see what they can do together."));
    for (const p of a.pairings) {
      const card = el("div", "card " + (p.ready ? "ready" : "blocked"));
      card.append(el("h4", "", p.title));
      const uses = el("div", "uses");
      for (const id of p.uses) uses.append(el("span", "", nameOf(id)));
      card.append(uses, el("p", "", p.text));
      pairings.append(card);
    }

    const orch = $("#orchestrators");
    orch.innerHTML = "";
    for (const o of a.orchestrators) {
      const row = el("div", "orch");
      const title = el("h4");
      const link = document.createElement("a");
      link.href = o.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = o.name;
      title.append(link);
      row.append(title, el("div", "score", `${o.covered.length}/${o.covered.length + o.uncovered.length}`));
      row.append(el("p", "muted", o.summary));
      const lists = el("div", "lists");
      if (o.covered.length) lists.append(el("span", "", "Connects: " + o.covered.map(nameOf).join(", ")));
      if (o.uncovered.length) lists.append(el("span", "", "Custom code for: " + o.uncovered.map(nameOf).join(", ")));
      if (o.human.length) lists.append(el("span", "", "Human step for: " + o.human.map(nameOf).join(", ")));
      row.append(lists, el("p", "needs", o.needs));
      orch.append(row);
    }
  }

  function nameOf(id) {
    return state.catalog.services.find((s) => s.id === id)?.name ?? id;
  }

  $("#download").addEventListener("click", () => {
    const a = state.advice;
    if (!a) return;
    const lines = ["# AgentForge plan", ""];
    for (const w of a.warnings) lines.push(`> ${w.text}`, "");
    lines.push("## Accounts", "");
    for (const s of a.services) {
      lines.push(`### ${s.name} (${s.title})`);
      for (const n of s.notes) lines.push(`- ${n}`);
      for (const w of s.workarounds) lines.push(`- Instead: ${w}`);
      lines.push("");
    }
    lines.push("## What you can build", "");
    for (const p of a.pairings) lines.push(`### ${p.title} ${p.ready ? "" : "(needs a human step or a missing account)"}`, p.text, "");
    lines.push("## Ways to wire it up", "");
    for (const o of a.orchestrators) lines.push(`- **${o.name}** (${o.covered.length}/${o.covered.length + o.uncovered.length}): ${o.summary} ${o.needs}`);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "agentforge-plan.md";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  function el(tag, cls = "", text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  load();
})();
