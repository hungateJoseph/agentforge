import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdvice, listServices } from "../src/advice.js";
import { ORCHESTRATORS, SERVICES } from "../src/catalog.js";

test("every orchestrator only covers services that exist", () => {
  const ids = new Set(SERVICES.map((s) => s.id));
  for (const o of ORCHESTRATORS) for (const id of o.covers) assert.ok(ids.has(id), `${o.id} covers unknown ${id}`);
});

test("every service with keys says where to get them", () => {
  for (const s of SERVICES) if (s.keys.length) assert.ok(s.getKey, `${s.id} has no getKey`);
});

test("no accounts gives a nudge, not a plan", () => {
  const a = buildAdvice([]);
  assert.equal(a.services.length, 0);
  assert.equal(a.warnings[0].level, "info");
  assert.equal(a.pairings.length, 0);
});

test("accounts without a model are blocked", () => {
  const a = buildAdvice(["twilio", "amazon"]);
  assert.equal(a.warnings[0].level, "block");
  const sms = a.pairings.find((p) => p.title === "Text-message agent");
  assert.equal(sms.ready, false);
});

test("twilio plus a model is a ready text-message agent", () => {
  const a = buildAdvice(["twilio", "anthropic"], { ANTHROPIC_API_KEY: "x", TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_FROM_NUMBER: "+1" });
  const sms = a.pairings.find((p) => p.title === "Text-message agent");
  assert.equal(sms.ready, true);
  assert.match(sms.text, /Anthropic/);
  assert.equal(a.services.find((s) => s.id === "twilio").keysSaved, true);
});

test("amazon is explained as a human step and routed through the account that can carry it", () => {
  const a = buildAdvice(["twilio", "amazon", "agentmail", "openai"]);
  const amazon = a.pairings.find((p) => p.title === "Ordering on Amazon");
  assert.equal(amazon.ready, false);
  assert.match(amazon.text, /AgentMail/);
  assert.ok(a.warnings.some((w) => w.level === "warn" && /Amazon/.test(w.text)));
});

test("orchestrators are ranked by coverage of drivable accounts", () => {
  const a = buildAdvice(["gmail", "twilio", "anthropic", "fiverr"]);
  const n8n = a.orchestrators.find((o) => o.id === "n8n");
  assert.deepEqual(n8n.covered.sort(), ["anthropic", "gmail", "twilio"]);
  assert.deepEqual(n8n.human, ["fiverr"]);
  assert.equal(a.orchestrators[0].score >= a.orchestrators[a.orchestrators.length - 1].score, true);
});

test("listed services never expose verify internals", () => {
  for (const s of listServices()) {
    assert.equal(typeof s.canVerify, "boolean");
    assert.equal("verify" in s, false);
  }
});
