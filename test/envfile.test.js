import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mask, readEnv, writeEnv } from "../src/envfile.js";

function tmpEnv(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentforge-"));
  const file = path.join(dir, ".env");
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

test("reads plain, quoted and exported values", () => {
  const file = tmpEnv(`# comment\nA=1\nexport B="two words"\nC='x#y'\nD=val # trailing\n`);
  assert.deepEqual(readEnv(file), { A: "1", B: "two words", C: "x#y", D: "val" });
});

test("missing file reads as empty", () => {
  assert.deepEqual(readEnv(tmpEnv()), {});
});

test("writes new keys, updates existing ones and keeps the rest", () => {
  const file = tmpEnv(`# keep me\nOTHER=stay\nTWILIO_AUTH_TOKEN=old\n`);
  writeEnv(file, { TWILIO_AUTH_TOKEN: "new", ANTHROPIC_API_KEY: "sk-ant-1" });
  assert.equal(fs.readFileSync(file, "utf8"), `# keep me\nOTHER=stay\nTWILIO_AUTH_TOKEN=new\nANTHROPIC_API_KEY=sk-ant-1\n`);
});

test("empty value removes the key", () => {
  const file = tmpEnv(`A=1\nB=2\n`);
  writeEnv(file, { A: "" });
  assert.equal(fs.readFileSync(file, "utf8"), `B=2\n`);
});

test("values with spaces or hashes are quoted", () => {
  const file = tmpEnv();
  writeEnv(file, { A: "two words", B: "a#b" });
  assert.deepEqual(readEnv(file), { A: "two words", B: "a#b" });
});

test("mask shows only the ends", () => {
  assert.equal(mask("sk-ant-api03-abcdefghijklmnop"), "sk-a************mnop");
  assert.equal(mask("short"), "*****");
  assert.equal(mask(""), "");
});
