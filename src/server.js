import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdvice, listServices } from "./advice.js";
import { evaluateNetwork } from "./bridges.js";
import { CATEGORIES, ORCHESTRATORS, SERVICES } from "./catalog.js";
import { discover } from "./discover.js";
import { mask, readEnv, writeEnv } from "./envfile.js";
import { verifyService } from "./verify.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

// Only keys the catalogue knows about may be written, so a stray request
// cannot turn the .env into a dumping ground.
const KNOWN_KEYS = new Set(SERVICES.flatMap((s) => s.keys.map((k) => k.env)));

export function createServer({ envFile }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        // The page is served from this origin only; refuse other origins outright.
        const origin = req.headers.origin;
        if (origin && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.0.0.1")) {
          return send(res, 403, { error: "Forbidden" });
        }
        return await api(req, res, url, envFile);
      }
      return serveStatic(res, url.pathname);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

async function api(req, res, url, envFile) {
  const env = readEnv(envFile);

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    return send(res, 200, { categories: CATEGORIES, services: listServices(), orchestrators: ORCHESTRATORS, envFile });
  }
  if (req.method === "GET" && url.pathname === "/api/env") {
    const saved = {};
    for (const key of KNOWN_KEYS) if (env[key]) saved[key] = mask(env[key]);
    return send(res, 200, { saved });
  }
  if (req.method === "POST" && url.pathname === "/api/env") {
    const body = await json(req);
    const updates = {};
    for (const [key, value] of Object.entries(body.values ?? {})) {
      if (!KNOWN_KEYS.has(key)) return send(res, 400, { error: `Unknown key ${key}` });
      if (typeof value !== "string") return send(res, 400, { error: `Bad value for ${key}` });
      updates[key] = value.trim();
    }
    writeEnv(envFile, updates);
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/advice") {
    const body = await json(req);
    const ids = Array.isArray(body.selected) ? body.selected.filter((s) => typeof s === "string") : [];
    return send(res, 200, buildAdvice(ids, env));
  }
  if (req.method === "POST" && url.pathname === "/api/network") {
    const body = await json(req);
    const ids = Array.isArray(body.nodes) ? body.nodes.filter((s) => typeof s === "string") : [];
    return send(res, 200, evaluateNetwork(ids, env));
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/verify/")) {
    return send(res, 200, await verifyService(url.pathname.slice("/api/verify/".length), env));
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/discover/")) {
    return send(res, 200, await discover(url.pathname.slice("/api/discover/".length), env.GITHUB_TOKEN));
  }
  send(res, 404, { error: "Not found" });
}

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function json(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Bad JSON"));
      }
    });
    req.on("error", reject);
  });
}
