import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "../src/server.js";
import { SERVICES } from "../src/catalog.js";
import { evaluateBridge, evaluateNetwork } from "../src/bridges.js";

let server;
let base;
let envFile;

before(async () => {
  envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentforge-")), ".env");
  fs.writeFileSync(envFile, "TWILIO_ACCOUNT_SID=AC1\nTWILIO_AUTH_TOKEN=t\nTWILIO_FROM_NUMBER=+1\n");
  server = createServer({ envFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("the network endpoint returns every ordered pair with key state from the env file", async () => {
  const res = await post("/api/network", { nodes: ["twilio", "aws", "anthropic"] });
  assert.equal(res.status, 200);
  const { pairs } = await res.json();
  assert.equal(Object.keys(pairs).length, 6);
  assert.equal(pairs["twilio>aws"].ends.from.keySaved, true);
  assert.equal(pairs["twilio>aws"].ends.to.keySaved, false);
  assert.deepEqual(pairs["twilio>aws"].ends.to.keysMissing, ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"]);
});

test("the network endpoint ignores junk in the node list", async () => {
  const { pairs } = await (await post("/api/network", { nodes: ["twilio", 42, null, "nope", "aws"] })).json();
  assert.ok(pairs["twilio>aws"]);
  assert.equal(pairs["twilio>nope"].level, "blocked");
  assert.equal(Object.keys(pairs).some((k) => k.includes("42")), false);
});

test("an empty or missing node list gives an empty network", async () => {
  assert.deepEqual(await (await post("/api/network", { nodes: [] })).json(), { pairs: {} });
  assert.deepEqual(await (await post("/api/network", {})).json(), { pairs: {} });
});

test("every bridge between catalogue services has a level, title, text and both ends", () => {
  const levels = new Set(["direct", "orchestrator", "partial", "partner", "human", "blocked"]);
  for (const a of SERVICES) {
    for (const b of SERVICES) {
      if (a.id === b.id) continue;
      const r = evaluateBridge(a.id, b.id);
      assert.ok(levels.has(r.level), `${a.id}>${b.id} has level ${r.level}`);
      assert.ok(r.title && r.text, `${a.id}>${b.id} lacks text`);
      assert.equal(r.ends.from.id, a.id);
      assert.equal(r.ends.to.id, b.id);
      assert.ok(Array.isArray(r.hubs));
    }
  }
});

test("hubs only ever list orchestrators that cover both ends", () => {
  const n = evaluateNetwork(SERVICES.map((s) => s.id));
  for (const [key, r] of Object.entries(n.pairs)) {
    const [from, to] = key.split(">");
    for (const h of r.hubs) assert.notEqual(h.id, "code", `${key} lists code as a hub`);
    if (from === "gmail" || to === "gmail") assert.ok(!r.hubs.some((h) => h.id === "mcp"), `${key} claims MCP covers Gmail`);
  }
});

test("a bridge into a service with no API never claims a key is needed there", () => {
  for (const s of SERVICES.filter((x) => x.access === "none")) {
    const r = evaluateBridge("anthropic", s.id);
    assert.equal(r.level, "human");
    assert.equal(r.ends.to.needsKey, false);
    assert.equal(r.ends.to.keySaved, false);
  }
});

test("key state follows the env exactly: partial keys do not count as saved", () => {
  const r = evaluateBridge("anthropic", "twilio", { ANTHROPIC_API_KEY: "k", TWILIO_ACCOUNT_SID: "AC1" });
  assert.equal(r.ends.from.keySaved, true);
  assert.equal(r.ends.to.keySaved, false);
  assert.deepEqual(r.ends.to.keysMissing, ["TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
});

test("gmail through a model points at an orchestrator because of OAuth", () => {
  const r = evaluateBridge("openai", "gmail");
  assert.equal(r.level, "direct");
  assert.match(r.text, /OAuth/);
  assert.match(r.text, /n8n|Composio/);
});

test("the reverse of a human step is blocked, so arrows are directional", () => {
  assert.equal(evaluateBridge("agentmail", "fiverr").level, "human");
  assert.equal(evaluateBridge("fiverr", "agentmail").level, "blocked");
});
