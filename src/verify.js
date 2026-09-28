import { serviceById } from "./catalog.js";

// Makes one harmless request with the saved key to see whether the service
// accepts it. Nothing is created or sent.

export async function verifyService(id, env) {
  const service = serviceById(id);
  if (!service?.verify) return { ok: false, message: "No check available for this service." };
  const missing = service.keys.filter((k) => !env[k.env]).map((k) => k.env);
  if (missing.length) return { ok: false, message: `Missing ${missing.join(", ")}.` };

  const { method, url, headers } = service.verify;
  const target = typeof url === "function" ? url(env) : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(target, { method, headers: headers(env), signal: controller.signal });
    if (res.ok) {
      if (id === "slack") {
        const body = await res.json();
        return body.ok ? { ok: true, message: `Accepted. Bot user ${body.user} in ${body.team}.` } : { ok: false, message: body.error };
      }
      return { ok: true, message: `Accepted (HTTP ${res.status}).` };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Rejected (HTTP ${res.status}). Check the key.` };
    return { ok: false, message: `Unexpected reply (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, message: err.name === "AbortError" ? "Timed out." : `Could not reach the service: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}
