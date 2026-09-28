import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "../src/server.js";

let server;
let base;
let envFile;

before(async () => {
  envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentforge-")), ".env");
  server = createServer({ envFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("serves the page and the catalogue", async () => {
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AgentForge/);
  const catalog = await (await fetch(base + "/api/catalog")).json();
  assert.ok(catalog.services.length > 5);
  assert.equal(catalog.envFile, envFile);
});

test("saves known keys, masks them on read, rejects unknown ones", async () => {
  assert.equal((await post("/api/env", { values: { ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnop" } })).status, 200);
  const saved = (await (await fetch(base + "/api/env")).json()).saved;
  assert.equal(saved.ANTHROPIC_API_KEY, "sk-a************mnop");
  assert.equal((await post("/api/env", { values: { NOT_A_KEY: "x" } })).status, 400);
  assert.doesNotMatch(fs.readFileSync(envFile, "utf8"), /NOT_A_KEY/);
});

test("advice reflects the saved keys", async () => {
  const advice = await (await post("/api/advice", { selected: ["anthropic", "twilio"] })).json();
  assert.equal(advice.services.find((s) => s.id === "anthropic").keysSaved, true);
  assert.equal(advice.services.find((s) => s.id === "twilio").keysSaved, false);
});

test("refuses API calls from another origin", async () => {
  const res = await post("/api/advice", { selected: [] }, { Origin: "https://example.com" });
  assert.equal(res.status, 403);
});

test("does not serve files outside public", async () => {
  const res = await fetch(base + "/../package.json");
  assert.equal(res.status, 404);
});
