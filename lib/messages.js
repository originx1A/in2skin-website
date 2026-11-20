// Caller messages taken by the voice agent — stored in KV, newest first,
// listed in the admin panel, emailed to the studio + Tony on arrival.
// Key: messages:all — JSON array of message records (capped at 200).
const crypto = require("crypto");
const { kvGet, kvSet } = require("./kv");

const KEY = "messages:all";
const MAX_MESSAGES = 200;

async function listMessages() {
  const saved = (await kvGet(KEY)) || [];
  return saved.slice().sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
}

async function saveMessage({ name, phone, reason, callId }) {
  const now = new Date().toISOString();
  const record = {
    id: "msg_" + crypto.randomBytes(8).toString("hex"),
    name: String(name || "").trim().slice(0, 100),
    phone: String(phone || "").trim().slice(0, 40),
    reason: String(reason || "").trim().slice(0, 1000),
    callId: String(callId || "").trim().slice(0, 100),
    receivedAt: now,
    read: false,
  };
  const all = await listMessages();
  all.unshift(record);
  await kvSet(KEY, all.slice(0, MAX_MESSAGES));
  return record;
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

module.exports = { KEY, MAX_MESSAGES, listMessages, saveMessage, markMessageRead, deleteMessage };
