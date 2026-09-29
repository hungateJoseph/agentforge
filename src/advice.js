import { ORCHESTRATORS, SERVICES, serviceById } from "./catalog.js";

// Turns "these are the accounts I have" into a plan: what each account can do
// on its own, which pairs make a useful agent, and which orchestrator covers
// the most of the set.

const ACCESS_TITLES = {
  direct: "Ready to use with your key",
  limited: "Partly usable with your key",
  partner: "Needs a partner key",
  none: "No API",
};

export function buildAdvice(selectedIds, env = {}) {
  const selected = selectedIds.map(serviceById).filter(Boolean);
  const has = (id) => selected.some((s) => s.id === id);
  const models = selected.filter((s) => s.role === "model");

  const services = selected.map((s) => ({
    id: s.id,
    name: s.name,
    access: s.access,
    title: ACCESS_TITLES[s.access],
    keysSaved: s.keys.length > 0 && s.keys.every((k) => Boolean(env[k.env])),
    keysMissing: s.keys.filter((k) => !env[k.env]).map((k) => k.env),
    notes: s.notes,
    workarounds: s.workarounds ?? [],
  }));

  const warnings = [];
  if (selected.length === 0) {
    warnings.push({ level: "info", text: "Pick the accounts you already have to see how they fit together." });
  } else if (models.length === 0) {
    warnings.push({
      level: "block",
      text: "Nothing here can think. An agent needs a model provider: add an Anthropic or OpenAI key and the rest becomes usable.",
    });
  }
  const noApi = selected.filter((s) => s.access === "none");
  if (noApi.length) {
    warnings.push({
      level: "warn",
      text: `${noApi.map((s) => s.name).join(" and ")} cannot be driven by an API key. The agent can prepare the work and hand it to you, or to a person, to finish.`,
    });
  }

  return {
    services,
    warnings,
    pairings: pairings(has, models),
    orchestrators: rankOrchestrators(selected),
  };
}

function pairings(has, models) {
  const out = [];
  const model = models[0];
  const brain = model ? model.name : "a model key";

  if (has("twilio")) {
    out.push({
      title: "Text-message agent",
      uses: ["twilio", model?.id].filter(Boolean),
      ready: Boolean(model),
      text: model
        ? `Twilio receives your text, ${brain} decides what to do, Twilio sends the reply. Runs off your own keys: Twilio's MCP server with the model, or n8n's Twilio trigger into its AI Agent node.`
        : "Twilio can send and receive texts today, but needs a model to decide what to say.",
    });
  }
  if (has("agentmail")) {
    out.push({
      title: "An agent with its own inbox",
      uses: ["agentmail", model?.id].filter(Boolean),
      ready: Boolean(model),
      text: model
        ? `AgentMail gives the agent an address; inbound mail arrives by webhook, ${brain} reads it and replies through the SDK. This is direct: no orchestrator needed.`
        : "AgentMail is ready, but the replies need a model behind them.",
    });
  }
  if (has("gmail")) {
    out.push({
      title: "Working from your own mailbox",
      uses: ["gmail", model?.id].filter(Boolean),
      ready: Boolean(model),
      text: "Gmail needs OAuth, not a key. The least work is n8n or Composio: they hold the Google login and hand the mail to the model as a tool.",
    });
  }
  if (has("amazon")) {
    const carrier = has("agentmail") ? "AgentMail" : has("twilio") ? "Twilio" : has("gmail") ? "Gmail" : null;
    out.push({
      title: "Ordering on Amazon",
      uses: ["amazon", carrier === "AgentMail" ? "agentmail" : carrier === "Twilio" ? "twilio" : carrier === "Gmail" ? "gmail" : null].filter(Boolean),
      ready: false,
      text: [
        "Amazon has no API for a personal account, so the agent cannot place the order itself.",
        "What works: the agent works out the item, quantity and address, then " +
          (carrier ? `sends you the ready-to-confirm link through ${carrier}` : "puts a ready-to-confirm link in its reply") +
          ", and you tap Buy. Amazon Business accounts can apply for a purchasing API if you order in volume.",
      ].join(" "),
    });
  }
  if (has("instacart")) {
    out.push({
      title: "Groceries in an hour",
      uses: ["instacart", model?.id].filter(Boolean),
      ready: Boolean(model),
      text: "The Instacart Developer Platform builds the cart from the model's list and returns a link; checkout stays with you in the Instacart app. Their MCP tutorial is the shortest route.",
    });
  }
  if (has("fiverr") || has("taskrabbit")) {
    const names = [has("fiverr") && "Fiverr", has("taskrabbit") && "TaskRabbit"].filter(Boolean).join(" and ");
    const carrier = has("agentmail") ? "AgentMail" : has("twilio") ? "a Twilio text" : has("slack") ? "Slack" : "its reply";
    out.push({
      title: "Hiring a person",
      uses: [has("fiverr") && "fiverr", has("taskrabbit") && "taskrabbit"].filter(Boolean),
      ready: false,
      text: `${names} cannot be booked from a key you can sign up for. Make it a human step: the agent writes the brief and the budget, sends it to you through ${carrier}, and you place the order. TaskRabbit's Partner API changes that if a partnership manager gives you a key.`,
    });
  }
  const tutoring = ["varsitytutors", "preply", "brighterly", "outschool"].filter(has);
  if (tutoring.length) {
    const names = tutoring.map((id) => serviceById(id).name).join(", ");
    const carrier = has("twilio") ? "a Twilio text" : has("agentmail") ? "AgentMail" : has("slack") ? "Slack" : "its reply";
    out.push({
      title: "Finding a tutor",
      uses: [...tutoring, model?.id].filter(Boolean),
      ready: false,
      text: model
        ? `${names} ${tutoring.length === 1 ? "has" : "have"} no booking API, but the tutor pages are public. ${brain} can search them, shortlist five tutors with bios, ratings, reviews and rates, and send you the list through ${carrier}. Booking the first session stays with you.`
        : `${names} can be searched by an agent once there is a model in the network; the shortlist and the booking hand-off need something to read the pages.`,
    });
  }
  if (has("aws") && model) {
    out.push({
      title: "Files and archives in the cloud",
      uses: ["aws", model.id],
      ready: true,
      text: `${brain} with AWS's managed MCP server can move files into S3, archive to Glacier and run image services under an IAM user you scope down. n8n's S3 nodes do the same without code.`,
    });
  }
  if (has("stripe") && model) {
    out.push({
      title: "Invoices and payment links",
      uses: ["stripe", model.id],
      ready: true,
      text: "Stripe's official MCP server lets the model create customers, invoices and payment links. Start with a test key until the flow is right.",
    });
  }
  if (has("slack") && model) {
    out.push({
      title: "An agent in your team chat",
      uses: ["slack", model.id],
      ready: true,
      text: "A Slack bot token plus the model gives you an agent that answers in channels. n8n's Slack trigger or a small script with the Slack SDK both work.",
    });
  }
  if (has("github") && model) {
    out.push({
      title: "Repository chores",
      uses: ["github", model.id],
      ready: true,
      text: "GitHub's official MCP server covers issues, pull requests and files. A fine-grained token keeps it to the repositories you choose.",
    });
  }
  return out;
}

function rankOrchestrators(selected) {
  const ids = selected.map((s) => s.id);
  const drivable = selected.filter((s) => s.access !== "none");
  return ORCHESTRATORS.map((o, order) => {
    const covered = ids.filter((id) => o.covers.includes(id));
    const uncovered = drivable.map((s) => s.id).filter((id) => !o.covers.includes(id));
    const human = selected.filter((s) => s.access === "none").map((s) => s.id);
    return {
      id: o.id,
      name: o.name,
      kind: o.kind,
      url: o.url,
      summary: o.summary,
      needs: o.needs,
      covered,
      uncovered,
      human,
      order,
      score: drivable.length ? covered.length / drivable.length : 0,
    };
  }).sort((a, b) => b.score - a.score || a.order - b.order);
}

export function listServices() {
  return SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    access: s.access,
    summary: s.summary,
    keys: s.keys.map((k) => ({ env: k.env, label: k.label, hint: k.hint ?? "", secret: Boolean(k.secret) })),
    getKey: s.getKey ?? null,
    docs: s.docs,
    canVerify: Boolean(s.verify),
  }));
}
