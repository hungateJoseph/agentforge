import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateBridge, evaluateNetwork } from "../src/bridges.js";

const twilioKeys = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" };

test("twilio to agentmail is possible through an orchestrator and reports key state", () => {
  const b = evaluateBridge("twilio", "agentmail", twilioKeys);
  assert.equal(b.level, "orchestrator");
  assert.equal(b.ends.from.keySaved, true);
  assert.equal(b.ends.to.keySaved, false);
  assert.deepEqual(b.ends.to.keysMissing, ["AGENTMAIL_API_KEY"]);
  assert.match(b.text, /webhook/);
  assert.ok(b.hubs.some((h) => h.id === "mcp"));
});

test("twilio to aws names n8n as the hub", () => {
  const b = evaluateBridge("twilio", "aws");
  assert.equal(b.level, "orchestrator");
  assert.ok(b.hubs.some((h) => h.id === "n8n"));
  assert.ok(b.hubs.some((h) => h.id === "mcp"));
  assert.match(b.title, /through/);
});

test("a model can call a service with an API directly", () => {
  const b = evaluateBridge("anthropic", "stripe", { ANTHROPIC_API_KEY: "k" });
  assert.equal(b.level, "direct");
  assert.match(b.text, /stripe\/ai/);
});

test("a model can only drive part of instacart", () => {
  assert.equal(evaluateBridge("openai", "instacart").level, "partial");
});

test("taskrabbit needs a partner key", () => {
  assert.equal(evaluateBridge("anthropic", "taskrabbit").level, "partner");
});

test("into a service with no API is a human step; out of it is blocked", () => {
  const into = evaluateBridge("twilio", "fiverr");
  assert.equal(into.level, "human");
  const outOf = evaluateBridge("amazon", "twilio");
  assert.equal(outOf.level, "blocked");
});

test("service events reach a model directly, polled services need a schedule", () => {
  assert.equal(evaluateBridge("twilio", "anthropic").level, "direct");
  assert.equal(evaluateBridge("aws", "anthropic").level, "orchestrator");
});

test("two models and a self-bridge are blocked", () => {
  assert.equal(evaluateBridge("anthropic", "openai").level, "blocked");
  assert.equal(evaluateBridge("twilio", "twilio").level, "blocked");
});

test("a network evaluates every ordered pair", () => {
  const n = evaluateNetwork(["twilio", "aws", "anthropic"]);
  assert.equal(Object.keys(n.pairs).length, 6);
  assert.ok(n.pairs["twilio>aws"]);
  assert.ok(n.pairs["aws>twilio"]);
});
