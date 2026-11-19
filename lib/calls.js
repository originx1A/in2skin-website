// Recent calls log — every call Retell reports, newest first, for
// Sarah's dashboard. Key: calls:recent — JSON array (capped at 50).
// One callId = one row: call_started creates it, call_ended /
// call_analyzed fills in the outcome. Transcript and recording links
// come from Retell's call_analyzed payload and are shown ONLY to the
// signed-in studio (the admin calls view) — never in a public response.
const { kvGet, kvSet } = require("./kv");

const KEY = "calls:recent";
const MAX_CALLS = 50;
const OUTCOMES = ["started", "transferred", "message", "missed", "ended"];

function cleanOutcome(input) {
  return OUTCOMES.includes(input) ? input : "ended";
}

function cleanUrl(input) {
  const u = String(input || "").trim().slice(0, 500);
  return /^https:\/\//.test(u) ? u : "";
}

async function listCalls() {
  const saved = (await kvGet(KEY)) || [];
  return saved.slice().sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

async function getCall(callId) {
  const id = String(callId || "").trim();
  if (!id) return null;
  const all = await listCalls();
  return all.find((c) => c.callId === id) || null;
}

async function upsertCall(patch) {
  const callId = String(patch.callId || "").trim().slice(0, 100);
  if (!callId) return null;
  const all = await listCalls();
  const now = new Date().toISOString();
  let row = all.find((c) => c.callId === callId);
  if (!row) {
    row = {
      callId,
      startedAt: patch.startedAt || now,
      endedAt: null,
      durationSec: null,
      outcome: "started",
      from: String(patch.from || "").trim().slice(0, 40),
      name: String(patch.name || "").trim().slice(0, 100),
      summary: String(patch.summary || "").trim().slice(0, 200),
      transcriptUrl: "",
      recordingUrl: "",
    };
    all.unshift(row);
  }
  if (patch.startedAt) row.startedAt = patch.startedAt;
  if (patch.endedAt) row.endedAt = patch.endedAt;
  if (patch.durationSec != null) row.durationSec = Number(patch.durationSec) || null;
  if (patch.outcome) row.outcome = cleanOutcome(patch.outcome);
  if (patch.from) row.from = String(patch.from).trim().slice(0, 40);
  if (patch.name) row.name = String(patch.name).trim().slice(0, 100);
  if (patch.summary) row.summary = String(patch.summary).trim().slice(0, 200);
  if (patch.transcriptUrl) row.transcriptUrl = cleanUrl(patch.transcriptUrl);
  if (patch.recordingUrl) row.recordingUrl = cleanUrl(patch.recordingUrl);
  await kvSet(KEY, all.slice(0, MAX_CALLS));
  return row;
}

module.exports = { KEY, MAX_CALLS, OUTCOMES, cleanOutcome, listCalls, getCall, upsertCall };
