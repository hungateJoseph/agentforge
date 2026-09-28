import { ORCHESTRATORS, serviceById } from "./catalog.js";

// A bridge is an arrow the user draws from one service to another: "I want
// things that happen in A to lead to actions in B". This works out whether
// that is possible, how, and what each end still needs.
//
// levels:
//   direct       - a model key plus the services' own APIs or MCP servers is enough
//   orchestrator - possible, but something has to sit in the middle (n8n, Composio, code)
//   partial      - possible up to a point the vendor does not expose (Instacart checkout)
//   partner      - possible once a partner key is granted
//   human        - the far end has no API; the agent can prepare the work for a person
//   blocked      - nothing can flow this way

// Services that can start a bridge on their own: they call out when something
// happens (an inbound text, an email, a payment, a push).
const EMITS_EVENTS = new Set(["twilio", "agentmail", "gmail", "slack", "github", "stripe"]);

export function evaluateBridge(fromId, toId, env = {}) {
  const from = serviceById(fromId);
  const to = serviceById(toId);
  if (!from || !to) return { level: "blocked", title: "Unknown service", text: "One end of this bridge is not in the catalogue." };
  if (from.id === to.id) return { level: "blocked", title: "Same service", text: "Pick two different services.", ends: ends(from, to, env) };

  const base = { from: from.id, to: to.id, ends: ends(from, to, env), hubs: hubsFor(from, to) };

  if (from.role === "model" && to.role === "model") {
    return { ...base, level: "blocked", title: "Two brains", text: "Two model providers do not bridge to each other. Pick one to think and connect it to the services." };
  }

  if (from.access === "none") {
    return {
      ...base,
      level: "blocked",
      title: `${from.name} cannot start anything`,
      text: `${from.name} has no API, so nothing can flow out of it. It can only be the last step in a chain, and that step is done by you.`,
    };
  }

  if (to.access === "none") {
    return {
      ...base,
      level: "human",
      title: `${to.name} is a human step`,
      text: `${to.name} has no API. The agent can carry what comes out of ${from.name} as far as a ready brief or a link, then a person finishes it. ${to.workarounds?.[0] ?? ""}`.trim(),
    };
  }

  if (from.role === "model") {
    return modelToService(base, from, to);
  }

  if (to.role === "model") {
    return {
      ...base,
      level: EMITS_EVENTS.has(from.id) ? "direct" : "orchestrator",
      title: EMITS_EVENTS.has(from.id) ? `${from.name} events reach ${to.name}` : `${to.name} can poll ${from.name}`,
      text: EMITS_EVENTS.has(from.id)
        ? `${from.name} can call a webhook when something happens. Point it at a small endpoint (or an n8n trigger) that hands the event to ${to.name}, and the model takes it from there.`
        : `${from.name} does not push events, so the model has to ask it on a schedule. n8n's schedule trigger or a cron job with a few lines of code does that.`,
    };
  }

  return serviceToService(base, from, to);
}

function modelToService(base, model, to) {
  const official = to.official?.length ? ` The official ${to.official[0].name} is the shortest route.` : "";
  if (to.access === "limited") {
    return {
      ...base,
      level: "partial",
      title: `${model.name} can drive part of ${to.name}`,
      text: `${to.name}'s API covers part of the job. ${to.notes[1] ?? to.notes[0]}${official}`,
    };
  }
  if (to.access === "partner") {
    return {
      ...base,
      level: "partner",
      title: `${to.name} needs a partner key first`,
      text: `${to.notes[0]} Once you have the key, the model can call the API directly.`,
    };
  }
  return {
    ...base,
    level: "direct",
    title: `${model.name} can call ${to.name} as a tool`,
    text: to.oauth
      ? `${to.name} authorises through OAuth rather than a key, so the easiest bridge is an orchestrator that holds the login (n8n or Composio) and exposes it to the model as a tool.`
      : `With your ${model.name} key and your ${to.name} credentials the model can call ${to.name} directly.${official}`,
  };
}

function serviceToService(base, from, to) {
  const hubs = base.hubs;
  const level = to.access === "limited" ? "partial" : to.access === "partner" ? "partner" : "orchestrator";
  const emits = EMITS_EVENTS.has(from.id);
  const parts = [];
  parts.push(
    emits
      ? `${from.name} can announce events by webhook, so something has to catch them and act on ${to.name}.`
      : `${from.name} does not push events, so something has to check it on a schedule and then act on ${to.name}.`,
  );
  if (hubs.length) {
    parts.push(`${hubs.map((h) => h.name).join(" or ")} connect${hubs.length === 1 ? "s" : ""} both without custom code${hubs.some((h) => h.id === "mcp") ? " (the MCP route needs a model key in the network)" : ""}.`);
  } else {
    parts.push("No workflow tool covers both ends, so this bridge is a short script using each service's SDK.");
  }
  if (to.access === "limited") parts.push(to.notes[1] ?? to.notes[0]);
  if (to.access === "partner") parts.push(to.notes[0]);
  return {
    ...base,
    level,
    title: hubs.length ? `${from.name} to ${to.name} through ${hubs[0].name}` : `${from.name} to ${to.name} with code`,
    text: parts.join(" "),
  };
}

// Everything that can sit in the middle without custom code, in catalogue
// order, so a model with MCP servers ranks ahead of a workflow tool.
function hubsFor(from, to) {
  return ORCHESTRATORS.filter((o) => o.id !== "code" && o.covers.includes(from.id) && o.covers.includes(to.id)).map((o) => ({ id: o.id, name: o.name }));
}

function ends(from, to, env) {
  return { from: endStatus(from, env), to: endStatus(to, env) };
}

function endStatus(service, env) {
  const missing = service.keys.filter((k) => !env[k.env]).map((k) => k.env);
  return {
    id: service.id,
    name: service.name,
    access: service.access,
    needsKey: service.keys.length > 0,
    keySaved: service.keys.length > 0 && missing.length === 0,
    keysMissing: missing,
    canVerify: Boolean(service.verify),
  };
}

// All ordered pairs among a set of nodes, so the page can answer instantly
// while an arrow is being dragged.
export function evaluateNetwork(ids, env = {}) {
  const pairs = {};
  for (const a of ids) for (const b of ids) if (a !== b) pairs[`${a}>${b}`] = evaluateBridge(a, b, env);
  return { pairs };
}
