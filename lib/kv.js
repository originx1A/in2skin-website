// Upstash Redis (Vercel KV) via its REST API.
// The KV database is NOT provisioned yet — every function fails gracefully
// with a clear message when KV_REST_API_URL / KV_REST_API_TOKEN are unset.
const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

function configured() {
  return Boolean(URL && TOKEN);
}

function notConfigured() {
  const e = new Error(
    "Storage is not configured yet: set KV_REST_API_URL and KV_REST_API_TOKEN " +
    "(Vercel KV / Upstash Redis) in the Vercel project settings, then redeploy."
  );
  e.code = "KV_NOT_CONFIGURED";
  e.status = 503;
  return e;
}

async function pipeline(commands) {
  if (!configured()) throw notConfigured();
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) throw new Error(`KV request failed (HTTP ${res.status})`);
  const data = await res.json();
  return data.map((r) => {
    if (r && r.error) throw new Error(`KV error: ${r.error}`);
    return r ? r.result : null;
  });
}

async function kvGet(key) {
  const [v] = await pipeline([["GET", key]]);
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}

async function kvSet(key, value) {
  await pipeline([["SET", key, JSON.stringify(value)]]);
}

async function kvDel(key) {
  await pipeline([["DEL", key]]);
}

module.exports = { configured, notConfigured, pipeline, kvGet, kvSet, kvDel };
