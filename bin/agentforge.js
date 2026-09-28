#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "../src/server.js";
import { envPath } from "../src/envfile.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`agentforge [--port 4177] [--env ./.env] [--no-open]

Starts a local page where you pick the accounts you have, save their keys to
an .env file on this machine, and see how they can work together as an agent.`);
  process.exit(0);
}

const port = Number(flag("--port", process.env.PORT || 4177));
const envFile = path.resolve(flag("--env", envPath()));
const server = createServer({ envFile });

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`AgentForge is running at ${url}`);
  console.log(`Keys are saved to ${envFile}`);
  if (!args.includes("--no-open")) open(url);
});

function open(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    // If the browser cannot be opened, the URL is already printed.
  }
}
