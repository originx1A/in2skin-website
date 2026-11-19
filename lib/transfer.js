// Call-answering hours for the voice agent — Sarah's "time clock".
// The studio phone agent (Retell) transfers calls to Sarah ONLY when these
// settings say she is answering. Sarah controls it from the admin panel:
// a weekly on/off window per day, plus a one-tap pause ("a couple hours
// off" or sleeping) with a resume time. Defaults = regular studio hours.
// The agent checks GET /api/transfer-status live before every transfer.
//
// TRANSFER MODES (Tony Nov 19, 2026 — Grok Bot's call-forwarding build):
//   agent_then_transfer (default) — the AI assistant answers first and
//     puts the caller through only when it can't help.
//   message_only — the assistant never puts a call through; it always
//     takes a message instead.
//   ring_me_first — every caller goes straight through to Sarah's phone
//     while transfers are allowed.
// The old agentMode ("agent" | "direct") is kept as a derived field so
// the voice agent's prompt — which reads agentMode from the same check —
// keeps working: ring_me_first reads as "direct", the other two as "agent".
//
// FORWARDING (same build): "Forward my calls to" is Sarah's phone number,
// dashboard-editable. It is NEVER in the public GET /api/transfer-status
// response — the agent only learns it from the Retell webhook's
// dynamic_variables, and only while a transfer is allowed. "Send messages
// to" is the email list that gets every caller message (blank = the usual
// studio emails).
//
// PRIVATE HOURS (same build): the day is split — regular call hours, and
// early mornings / evenings (Private Hours, 7–10 AM and 5–9 PM). During
// Private Hours the transfer rule is separate: "message_only" (default —
// the assistant takes a message) or "same" (follow the transfer mode).
// A day switched off in the weekly table is off all day, Private Hours
// included. Sundays the studio is closed, so Sunday is off by default.
const { kvGet, kvSet } = require("./kv");

const KEY = "transfer:settings";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

const TRANSFER_MODES = ["agent_then_transfer", "message_only", "ring_me_first"];
const DEFAULT_TRANSFER_MODE = "agent_then_transfer";
// Sarah's phone — the number the agent puts callers through to. The
// Retell prompt carries the same number; the dashboard field edits this.
const DEFAULT_FORWARD_TO = "+14166596640";
const MAX_MESSAGE_EMAILS = 5;
// Private Hours windows (Toronto time): early mornings 7–10 AM, evenings
// 5–9 PM — the same windows the booking side uses for Private Hours.
const PH_MORNING = { start: 7 * 60, end: 10 * 60 };
const PH_EVENING = { start: 17 * 60, end: 21 * 60 };

// Default: every day 09:00–17:30, on — except Sunday, closed —
// the AI assistant answers the phone.
function defaultSettings() {
  const week = {};
  for (const d of DAYS) week[d] = { on: d !== "sun", start: "09:00", end: "17:30" };
  return {
    week,
    pausedUntil: null,
    transferMode: DEFAULT_TRANSFER_MODE,
    agentMode: "agent",
    forwardTo: DEFAULT_FORWARD_TO,
    messageEmails: [],
    privateHours: { mode: "message_only" },
  };
}

// Legacy agentMode ("agent" | "direct") → transfer mode. Old saved
// settings and old dashboard Talk commands still say "direct" / "agent".
function modeFromLegacy(input) {
  if (input === "direct") return "ring_me_first";
  return DEFAULT_TRANSFER_MODE;
}

// The transfer mode, cleaned: a real mode wins; a legacy agentMode is
// mapped; anything else falls back to the default.
function cleanTransferMode(input) {
  if (TRANSFER_MODES.includes(input)) return input;
  if (input === "direct" || input === "agent") return modeFromLegacy(input);
  return DEFAULT_TRANSFER_MODE;
}

// agentMode rides along for the voice agent's prompt (it reads agentMode
// from GET /api/transfer-status): "direct" only when calls ring Sarah
// first; the other two modes both answer through the assistant.
function agentModeFor(transferMode) {
  return transferMode === "ring_me_first" ? "direct" : "agent";
}

function validTime(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function cleanForwardTo(input) {
  const digits = String(input || "").replace(/[^0-9+]/g, "");
  let body = digits.replace(/^\+/, "");
  if (!body) return DEFAULT_FORWARD_TO;
  // A 10-digit North American number is missing its country code.
  if (body.length === 10) body = "1" + body;
  if (body.length < 7 || body.length > 15) {
    throw new Error("That phone number doesn't look right — it needs 7 to 15 digits.");
  }
  return "+" + body;
}

function cleanMessageEmails(input) {
  const list = (Array.isArray(input) ? input : String(input || "").split(","))
    .map((e) => String(e || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_MESSAGE_EMAILS);
  for (const e of list) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new Error(`"${e}" doesn't look like an email address.`);
    }
  }
  return [...new Set(list)];
}

function cleanPrivateHours(input) {
  const mode = (input && input.mode) || "message_only";
  return { mode: mode === "same" ? "same" : "message_only" };
}

function cleanSettings(input) {
  // Returns a validated copy, or throws with a plain message.
  const base = defaultSettings();
  if (!input || typeof input !== "object") return base;
  const week = {};
  for (const d of DAYS) {
    const row = (input.week || {})[d] || {};
    const start = validTime(row.start);
    const end = validTime(row.end);
    week[d] = {
      on: row.on === true,
      start: start != null ? row.start : base.week[d].start,
      end: end != null ? row.end : base.week[d].end,
    };
    if (week[d].on && validTime(week[d].start) >= validTime(week[d].end)) {
      throw new Error(`${DAY_NAMES[d]}: the start time must be before the end time.`);
    }
  }
  let pausedUntil = null;
  if (input.pausedUntil) {
    const t = new Date(input.pausedUntil).getTime();
    if (Number.isNaN(t)) throw new Error("That pause time is not valid.");
    if (t > Date.now()) pausedUntil = new Date(t).toISOString();
  }
  // transferMode wins; a lone legacy agentMode is mapped, never lost.
  const transferMode = input.transferMode
    ? cleanTransferMode(input.transferMode)
    : cleanTransferMode(input.agentMode);
  return {
    week,
    pausedUntil,
    transferMode,
    agentMode: agentModeFor(transferMode),
    forwardTo: cleanForwardTo(input.forwardTo),
    messageEmails: cleanMessageEmails(input.messageEmails),
    privateHours: cleanPrivateHours(input.privateHours),
  };
}

async function getSettings() {
  const saved = await kvGet(KEY);
  if (!saved) return defaultSettings();
  try { return cleanSettings(saved); } catch { return defaultSettings(); }
}

async function saveSettings(input) {
  const cleaned = cleanSettings(input);
  await kvSet(KEY, cleaned);
  return cleaned;
}

// The email list that gets caller messages: Sarah's list when she set
// one, otherwise null — the caller falls back to the studio admin emails.
function messageRecipients(settings) {
  const list = (settings && settings.messageEmails) || [];
  return list.length ? list : null;
}

// Toronto "now": weekday (sun..sat), minutes since midnight, readable clock.
function torontoNow(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const day = (get("weekday") || "Mon").slice(0, 3).toLowerCase();
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const label = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(now);
  return { day, mins, label };
}

// Toronto calendar date (YYYY-MM-DD) — the studio's clock, not the server's.
function torontoDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Is this minute inside a Private Hours window (7–10 AM or 5–9 PM)?
function inPrivateHours(mins) {
  return (mins >= PH_MORNING.start && mins < PH_MORNING.end)
    || (mins >= PH_EVENING.start && mins < PH_EVENING.end);
}

// What the mode means right now: does a call go through?
// agent_then_transfer / ring_me_first → yes; message_only → no.
function modeAllowsTransfer(transferMode) {
  return transferMode !== "message_only";
}

function transferStatus(settings, now = new Date()) {
  const { day, mins, label } = torontoNow(now);
  // transferMode rides along with every answer, so the voice agent and
  // the Retell webhook can read it from the same check. agentMode is
  // the legacy twin ("direct" = ring me first, else "agent").
  const transferMode = cleanTransferMode(settings.transferMode || settings.agentMode);
  const agentMode = agentModeFor(transferMode);
  const base = { day, now: label, agentMode, transferMode };
  if (settings.pausedUntil && new Date(settings.pausedUntil).getTime() > now.getTime()) {
    return { ...base, transferAllowed: false, reason: "paused", pausedUntil: settings.pausedUntil, period: "off" };
  }
  const row = settings.week[day];
  if (!row || !row.on) {
    return { ...base, transferAllowed: false, reason: "outside_hours", period: "off" };
  }
  const start = validTime(row.start);
  const end = validTime(row.end);
  if (mins >= start && mins < end) {
    if (modeAllowsTransfer(transferMode)) {
      return { ...base, transferAllowed: true, reason: "on", period: "regular", until: row.end };
    }
    return { ...base, transferAllowed: false, reason: "message_only", period: "regular" };
  }
  // Outside the regular window but inside a Private Hours window: the
  // Private Hours rule decides. "same" follows the transfer mode;
  // "message_only" (default) means the assistant takes a message.
  if (inPrivateHours(mins)) {
    const phMode = (settings.privateHours && settings.privateHours.mode) || "message_only";
    if (phMode === "same" && modeAllowsTransfer(transferMode)) {
      return { ...base, transferAllowed: true, reason: "private_hours", period: "private_hours" };
    }
    return { ...base, transferAllowed: false, reason: "private_hours", period: "private_hours" };
  }
  return { ...base, transferAllowed: false, reason: "outside_hours", period: "off", nextOn: row.start };
}

module.exports = {
  KEY, DAYS, DAY_NAMES, TRANSFER_MODES, DEFAULT_TRANSFER_MODE,
  DEFAULT_FORWARD_TO, PH_MORNING, PH_EVENING,
  defaultSettings, validTime, cleanSettings, cleanTransferMode, cleanForwardTo,
  cleanMessageEmails, cleanPrivateHours, agentModeFor, modeFromLegacy,
  getSettings, saveSettings, messageRecipients,
  torontoNow, torontoDateKey, inPrivateHours, modeAllowsTransfer, transferStatus,
};
