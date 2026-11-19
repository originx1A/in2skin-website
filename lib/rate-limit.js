// Rate limiting on Vercel KV (fixed window, INCR + expiry).
// Fail OPEN by design: if KV is not configured, the client IP cannot be
// determined, or any KV call errors, the request is allowed — a limiter
// must never block a real booking or payment because the store hiccuped.
// Requests carrying a valid x-agent-key (the Retell voice agent, which
// calls from shared IPs) are exempt.
const { configured, pipeline } = require("./kv");

function clientIp(req) {
  const headers = req.headers || {};
  const fwd = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || String(headers["x-real-ip"] || "").trim();
  if (!ip) return null;
  const clean = ip.replace(/[^A-Za-z0-9.:]/g, "").slice(0, 64);
  return clean || null;
}

function agentExempt(req) {
  const key = process.env.AGENT_API_KEY;
  if (!key) return false;
  const h = (req.headers || {})["x-agent-key"];
  return typeof h === "string" && h.length > 0 && h === key;
}

// Check one fixed-window bucket. Returns true when the request may
// proceed; when the limit is hit it sends 429 (with Retry-After) and
// returns false. opts: { scope, limit, windowSecs, bucket? } — bucket
// overrides the client-IP key (e.g. a per-email bucket).
async function checkLimit(req, res, opts) {
  try {
    if (agentExempt(req)) return true;
    const bucket = opts.bucket || clientIp(req);
    if (!bucket) return true;
    if (!configured()) return true;
    const key = `rl:${opts.scope}:${bucket}`;
    const windowSecs = opts.windowSecs || 60;
    const results = await pipeline([["INCR", key], ["TTL", key]]);
    const count = Number(results[0]) || 0;
    const ttl = Number(results[1]);
    // First hit in the window has no expiry yet — set it (TTL -1).
    if (ttl === -1) {
      try { await pipeline([["EXPIRE", key, windowSecs]]); } catch { /* already counted; expiry is best-effort */ }
    }
    if (count > opts.limit) {
      const retry = ttl > 0 ? ttl : windowSecs;
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: "Too many requests — please wait a moment and try again.", retryAfterSecs: retry });
      return false;
    }
    return true;
  } catch {
    // Any KV failure fails open — never block legit traffic on an error.
    return true;
  }
}

module.exports = { clientIp, agentExempt, checkLimit };
