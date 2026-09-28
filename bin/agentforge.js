#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { envPath } from "../src/envfile.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`agentforge [--port 4177] [--env ./.env] [--browser] [--no-open]

Starts AgentForge in its own window, where you pick the accounts you have,
save their keys to an .env file on this machine, and see how they can work
together as an agent.

  --browser   open in the default browser instead of a window
  --no-open   just start the server and print the address`);
  process.exit(0);
}

const port = Number(flag("--port", process.env.PORT || 4177));
const envFile = path.resolve(flag("--env", envPath()));
const server = createServer({ envFile });

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`AgentForge is running at ${url}`);
  console.log(`Keys are saved to ${tildify(envFile)}`);
  if (args.includes("--no-open")) return;
  if (args.includes("--browser") || !openWindow(url)) openBrowser(url);
});

// A window of its own, like any other app, rather than a tab: Chromium-based
// browsers can run a page in "app" mode with no address bar or tabs.
function openWindow(url) {
  const flags = [`--app=${url}`, "--window-size=1120,860", "--no-first-run", "--no-default-browser-check"];
  if (process.platform === "darwin") {
    for (const app of ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"]) {
      if (!fs.existsSync(`/Applications/${app}.app`)) continue;
      return launch("open", ["-na", app, "--args", ...flags]);
    }
    return false;
  }
  if (process.platform === "win32") {
    const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    const candidates = roots.flatMap((r) => [
      path.join(r, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(r, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ]);
    const exe = candidates.find((c) => fs.existsSync(c));
    return exe ? launch(exe, flags) : false;
  }
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
    const found = dirs.map((d) => path.join(d, bin)).find((f) => fs.existsSync(f));
    if (found) return launch(found, flags);
  }
  return false;
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  launch(cmd, cmdArgs);
}

function launch(cmd, cmdArgs) {
  try {
    const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function tildify(p) {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
