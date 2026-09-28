import { serviceById } from "./catalog.js";

// Looks on GitHub for community integrations for a service: MCP servers and
// n8n community nodes. Unauthenticated searches are rate limited to a
// handful a minute, so results are cached for the life of the process.

const cache = new Map();

const QUERIES = {
  mcp: (name) => `${name} mcp server in:name,description`,
  n8n: (name) => `n8n-nodes ${name} in:name,description`,
};

export async function discover(id, token) {
  const service = serviceById(id);
  if (!service) return { error: "Unknown service." };
  if (cache.has(id)) return cache.get(id);

  const short = service.name.split(" ")[0];
  const result = { service: id, official: service.official ?? [], mcp: [], n8n: [], error: null };
  for (const kind of ["mcp", "n8n"]) {
    try {
      result[kind] = await search(QUERIES[kind](short), token);
    } catch (err) {
      result.error = err.message;
    }
  }
  cache.set(id, result);
  return result;
}

async function search(q, token) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=5`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "agentforge" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub search limit reached; try again in a minute.");
  if (!res.ok) throw new Error(`GitHub replied HTTP ${res.status}.`);
  const body = await res.json();
  return body.items.map((r) => ({
    name: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    description: r.description ?? "",
    updated: r.pushed_at?.slice(0, 10) ?? "",
  }));
}
