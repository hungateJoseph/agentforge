// Drives the page in a real Chrome: ticks accounts, drags bridges, moves a
// node, saves a key, reloads. Run with `npm run test:browser` after
// `npm install`; it uses the Chrome already on the machine when there is one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "../../src/server.js";

const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentforge-browser-")), ".env");
const server = createServer({ envFile });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err.message.split("\n")[0]}`);
  }
}

const node = (name) => page.locator("#canvas .node", { hasText: name });

async function drag(fromName, toName) {
  const port = await node(fromName).locator(".port").boundingBox();
  const target = await node(toName).boundingBox();
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(port.x + 40, port.y + 10, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.waitForTimeout(80);
  const hint = (await page.locator("#hint").isVisible()) ? await page.locator("#hint").innerText() : "";
  const lit = await node(toName).evaluate((n) => n.classList.contains("over"));
  await page.mouse.up();
  await page.waitForTimeout(80);
  return { hint, lit };
}

await page.goto(base);
await page.waitForSelector(".service");

await step("ticking accounts adds nodes to the canvas", async () => {
  for (const name of ["Twilio", "Amazon (shopping)", "AgentMail", "Anthropic (Claude API)"]) {
    await page.locator(".service", { hasText: name }).locator("input[type=checkbox]").check();
  }
  await page.locator("#canvas").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll("#canvas .node").length === 4);
  const statuses = await page.$$eval("#canvas .node-status", (els) => els.map((e) => e.textContent));
  assert.ok(statuses.includes("no key") && statuses.includes("no API"));
});

await step("dragging Twilio onto AgentMail answers while hovering", async () => {
  const { hint, lit } = await drag("Twilio", "AgentMail");
  assert.equal(lit, true);
  assert.match(hint, /Possible with an orchestrator/);
  assert.match(hint, /Twilio: no key/);
  assert.match(hint, /AgentMail: no key/);
});

await step("into Amazon is a human step, out of Amazon is not possible", async () => {
  assert.match((await drag("Twilio", "Amazon (shopping)")).hint, /human step/);
  assert.match((await drag("Amazon (shopping)", "Twilio")).hint, /Not possible/);
});

await step("a model onto Twilio is direct", async () => {
  assert.match((await drag("Anthropic (Claude API)", "Twilio")).hint, /Possible, direct/);
});

await step("dropped bridges become coloured arrows, cards and a summary", async () => {
  const strokes = await page.$$eval("#arrows path.arrow", (els) => els.map((e) => e.getAttribute("stroke")));
  assert.deepEqual(strokes, ["#1d4ed8", "#c2410c", "#b91c1c", "#15803d"]);
  assert.equal(await page.locator("#bridges .bridge").count(), 4);
  assert.match(await page.locator("#network-summary").innerText(), /4 bridges/);
});

await step("dropping the same bridge twice does not duplicate it", async () => {
  await drag("Twilio", "AgentMail");
  assert.equal(await page.locator("#bridges .bridge").count(), 4);
});

await step("moving a node redraws its arrows", async () => {
  await page.locator("#canvas").scrollIntoViewIfNeeded();
  const box = await node("AgentMail").boundingBox();
  const before = await page.$eval("#arrows path.arrow", (e) => e.getAttribute("d"));
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(await page.$eval("#arrows path.arrow", (e) => e.getAttribute("d")), before);
});

await step("saving a key from a bridge card updates the node and the file", async () => {
  await page.locator("#bridges .bridge", { hasText: "AgentMail" }).first().locator(".end", { hasText: "AgentMail" }).locator("button").click();
  await page.waitForSelector("#modal:not([hidden])");
  await page.fill("#f-AGENTMAIL_API_KEY", "am_test_key_1234567890");
  await page.click("#modal-save");
  await page.waitForFunction(() => document.querySelector("#modal").hidden);
  await page.waitForFunction(() => [...document.querySelectorAll("#canvas .node")].some((n) => n.textContent.includes("AgentMail") && n.textContent.includes("key saved")));
  assert.match(fs.readFileSync(envFile, "utf8"), /AGENTMAIL_API_KEY=am_test_key_1234567890/);
});

await step("nodes and bridges survive a reload; clear removes the bridges", async () => {
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#arrows path.arrow").length === 4);
  assert.equal(await page.locator("#canvas .node").count(), 4);
  await page.click("#clear-network");
  assert.equal(await page.locator("#arrows path.arrow").count(), 0);
});

await step("no errors were logged by the page", () => assert.deepEqual(errors, []));

await browser.close();
server.close();
process.exit(failed ? 1 : 0);

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}
