// Caller messages taken by the voice agent — stored in KV, newest first,
// listed in the admin panel, emailed to Sarah + Tony on arrival.
// Key: messages:all — JSON array of message records (capped at 200).
//
// A message carries a source ("agent" — the assistant took it,
// "missed-call" — the Retell safety net saved it after a failed transfer
// or a promised callback, "test" — Sarah's "Send test message" button)
// and a one-line summary for the dashboard list. Records are deduped by
// callId: one call makes at most one message, however many times Retell
// retries the webhook.
const crypto = require("crypto");
const { kvGet, kvSet } = require("./kv");
const { sendEmail } = require("./email");
const { notifyPush } = require("./push");

const KEY = "messages:all";
const MAX_MESSAGES = 200;
const SOURCES = ["agent", "missed-call", "test"];

function cleanSource(input) {
  return SOURCES.includes(input) ? input : "agent";
}

function makeSummary({ name, reason }) {
  const n = String(name || "").trim();
  const r = String(reason || "").trim();
  const s = n && r ? `${n} — ${r}` : r || n || "Caller message";
  return s.slice(0, 140);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function listMessages() {
  const saved = (await kvGet(KEY)) || [];
  return saved.slice().sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
}

async function findByCallId(callId) {
  const id = String(callId || "").trim();
  if (!id) return null;
  const all = await listMessages();
  return all.find((m) => m.callId === id) || null;
}

async function saveMessage({ name, phone, reason, callId, source, summary }) {
  // One call, one message: a retry or a second webhook for the same
  // call returns the record that is already there (duplicate: true),
  // so the caller can skip the email + pop-up the second time.
  const existing = await findByCallId(callId);
  if (existing) return { ...existing, duplicate: true };
  const now = new Date().toISOString();
  const record = {
    id: "msg_" + crypto.randomBytes(8).toString("hex"),
    name: String(name || "").trim().slice(0, 100),
    phone: String(phone || "").trim().slice(0, 40),
    reason: String(reason || "").trim().slice(0, 1000),
    callId: String(callId || "").trim().slice(0, 100),
    source: cleanSource(source),
    summary: String(summary || "").trim().slice(0, 140)
      || makeSummary({ name, reason }),
    receivedAt: now,
    read: false,
  };
  const all = await listMessages();
  all.unshift(record);
  await kvSet(KEY, all.slice(0, MAX_MESSAGES));
  return { ...record, duplicate: false };
}

async function markMessageRead(id, read) {
  const all = await listMessages();
  const m = all.find((x) => x.id === id);
  if (!m) return false;
  m.read = read !== false;
  await kvSet(KEY, all);
  return true;
}

async function deleteMessage(id) {
  const all = await listMessages();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  await kvSet(KEY, next);
  return true;
}

// Email + pop-up for a caller message, shared by the agent's take_message,
// the Retell missed-call safety net, and Sarah's test button. `to` is the
// resolved recipient list (Sarah's message list, or the studio emails).
// Never throws — a missing email key just means no email.
async function deliverCallerMessage(record, { to = [], missed = false } = {}) {
  const when = new Date(record.receivedAt).toLocaleString("en-CA", {
    timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const title = missed ? "Missed call — In2Skin" : "New message from a caller — In2Skin";
  const intro = missed
    ? `<strong>${escapeHtml(record.name)}</strong> called and the call didn't reach you — the assistant saved this so nobody slips through.`
    : `<strong>${escapeHtml(record.name)}</strong> called while the studio couldn't answer.`;
  let emailed = false;
  if (to.length) {
    emailed = await sendEmail({
      to,
      subject: title,
      html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">${escapeHtml(title)}</h2><p>${intro}</p><ul><li>Phone: <a href="tel:${String(record.phone || "").replace(/[^0-9+]/g, "")}">${escapeHtml(record.phone)}</a></li><li>Reason: ${escapeHtml(record.reason || "No reason given.")}</li><li>When: ${escapeHtml(when)} (Toronto time)</li></ul><p>Call them back at ${escapeHtml(record.phone)}, or see all messages on the studio dashboard.</p><p>— In2Skin, Bolton</p>`,
    });
  }
  // Same moment as the email: a pop-up on the studio phone +
  // a dashboard event (chime + banner while it is open).
  await notifyPush({
    type: "message",
    title: missed ? "Missed call" : "New message from a caller",
    body: `${record.name} — ${record.reason || "No reason given."}`,
  });
  return { emailed };
}

module.exports = {
  KEY, MAX_MESSAGES, SOURCES, cleanSource, makeSummary,
  listMessages, findByCallId, saveMessage, markMessageRead, deleteMessage,
  deliverCallerMessage,
};
