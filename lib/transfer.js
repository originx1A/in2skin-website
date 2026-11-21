// Call-answering hours for the voice agent — the studio's "time clock".
// The studio phone agent (Retell) transfers calls to the studio ONLY when these
// settings say the studio is answering. The studio controls it from the admin panel:
// a weekly on/off window per day, plus a one-tap pause ("a couple hours
// off" or sleeping) with a resume time. Defaults = regular studio hours.
// The agent checks GET /api/transfer-status live before every transfer.
const { kvGet, kvSet } = require("./kv");

const KEY = "transfer:settings";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

// Default: every day 09:00–17:30, on; the AI assistant answers the phone.
function defaultSettings() {
  const week = {};
  for (const d of DAYS) week[d] = { on: true, start: "09:00", end: "17:30" };
  return { week, pausedUntil: null, agentMode: "agent" };
}

// agentMode: "agent" (default — the AI assistant answers) or "direct"
// (calls go straight to the studio's phone). Saved from the dashboard's
// "Who answers the phone?" switch; the voice agent reads it live from
// GET /api/transfer-status before every transfer.
function cleanAgentMode(input) {
  return input === "direct" ? "direct" : "agent";
}

function validTime(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
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
  return { week, pausedUntil, agentMode: cleanAgentMode(input.agentMode) };
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

function transferStatus(settings, now = new Date()) {
  const { day, mins, label } = torontoNow(now);
  // agentMode rides along with every answer, so the voice agent can read
  // it from the same check: "direct" means put every caller straight
  // through (only while transfers are allowed); "agent" means answer first.
  const agentMode = cleanAgentMode(settings.agentMode);
  if (settings.pausedUntil && new Date(settings.pausedUntil).getTime() > now.getTime()) {
    return { transferAllowed: false, reason: "paused", pausedUntil: settings.pausedUntil, day, now: label, agentMode };
  }
  const row = settings.week[day];
  if (!row || !row.on) {
    return { transferAllowed: false, reason: "outside_hours", day, now: label, agentMode };
  }
  const start = validTime(row.start);
  const end = validTime(row.end);
  if (mins >= start && mins < end) {
    return { transferAllowed: true, reason: "on", day, now: label, until: row.end, agentMode };
  }
  return { transferAllowed: false, reason: "outside_hours", day, now: label, nextOn: row.start, agentMode };
}

module.exports = {
  KEY, DAYS, DAY_NAMES, defaultSettings, validTime, cleanSettings, cleanAgentMode,
  getSettings, saveSettings, torontoNow, torontoDateKey, transferStatus,
};
