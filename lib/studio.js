// Studio settings the studio controls from the admin panel:
//   - the gap between appointments (buffer, default 60 min — Tony Nov 19:
//     at least one hour between bookings, so the setting never goes below
//     MIN_GAP_MINS; she can raise it)
//   - blocked-off time (part of a day, or a whole day, the studio is closed)
//   - the video call link for video consultations (studio:meetLink):
//     the studio pastes her own Google Meet link here. Until she does, the
//     confirmation email says the link is coming — a fake link is never
//     shown anywhere.
const crypto = require("crypto");
const { kvGet, kvSet } = require("./kv");
const { BUFFER_MINS, MIN_GAP_MINS, parseDateLocal, parseTime } = require("./schedule");

// Studio address — BOOKED CLIENTS ONLY (Tony, Nov 20, 2026).
// The street address is NEVER on any public page: it reaches clients only
// inside confirmation emails for booked clients (see lib/bookings.js
// addressBlock). A code constant in this private repo is the only
// self-contained option — Vercel env vars cannot be set from here, and
// the address must not live in any client-served file. No parking note
// was provided, so none is ever given.
const STUDIO_ADDRESS = "92 Willow Street, Bolton, Ontario L7E 3G3";
const STUDIO_DIRECTIONS_URL = "https://www.google.com/maps/search/?api=1&query=92+Willow+Street+Bolton+ON+L7E+3G3";

const BUFFER_KEY = "studio:buffer";
const BLOCKS_KEY = "studio:blocks";
const MEET_KEY = "studio:meetLink";
const MAX_BUFFER_MINS = 120;

function cleanMeetLink(raw) {
  const link = String(raw || "").trim();
  if (!link) return "";
  if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]{3,}(\?[^\s]*)?$/i.test(link)) {
    throw new Error("That doesn't look like a Google Meet link — paste the full link from Google Meet (it starts with https://meet.google.com/).");
  }
  return link;
}

async function getMeetLink() {
  const saved = await kvGet(MEET_KEY);
  if (!saved) return "";
  try { return cleanMeetLink(saved); } catch { return ""; }
}

async function setMeetLink(raw) {
  const link = cleanMeetLink(raw);
  await kvSet(MEET_KEY, link);
  return link;
}

function cleanBufferMins(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < MIN_GAP_MINS || v > MAX_BUFFER_MINS) {
    throw new Error(`The gap between appointments must be a whole number of minutes, ${MIN_GAP_MINS} to ${MAX_BUFFER_MINS}.`);
  }
  return v;
}

async function getBufferMins() {
  const saved = await kvGet(BUFFER_KEY);
  if (saved == null) return BUFFER_MINS;
  // A gap saved before the 60-minute rule still counts as 60 — the rule
  // is a floor, not a preference.
  try { return Math.max(cleanBufferMins(saved), MIN_GAP_MINS); } catch { return BUFFER_MINS; }
}

async function setBufferMins(n) {
  const v = cleanBufferMins(n);
  await kvSet(BUFFER_KEY, v);
  return v;
}

function parseClock(s) {
  // "HH:MM" 24-hour (from <input type="time">) or "9:00 AM".
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "").trim())) {
    const [h, m] = String(s).trim().split(":").map(Number);
    return h * 60 + m;
  }
  return parseTime(s);
}

function fmtClock(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

async function listBlocks() {
  const saved = (await kvGet(BLOCKS_KEY)) || [];
  return saved.slice().sort((a, b) => (a.date + String(a.startMin).padStart(4, "0")).localeCompare(b.date + String(b.startMin).padStart(4, "0")));
}

async function blocksForDate(dateStr) {
  const all = await listBlocks();
  return all.filter((b) => b.date === dateStr);
}

async function addBlock({ date, start, end, reason }) {
  if (!parseDateLocal(date)) throw new Error("Pick a valid day to block off.");
  const startMin = parseClock(start);
  const endMin = parseClock(end);
  if (startMin == null || endMin == null) throw new Error("Pick a start and end time for the block.");
  if (startMin >= endMin) throw new Error("The block has to end after it starts.");
  const existing = await listBlocks();
  const clash = existing.find((b) => b.date === date && startMin < b.endMin && b.startMin < endMin);
  if (clash) {
    throw new Error(`That overlaps a block you already have (${fmtClock(clash.startMin)}–${fmtClock(clash.endMin)}). Remove it first, or pick a different time.`);
  }
  const block = {
    id: "blk_" + crypto.randomBytes(8).toString("hex"),
    date,
    startMin,
    endMin,
    startLabel: fmtClock(startMin),
    endLabel: fmtClock(endMin),
    reason: String(reason || "").trim().slice(0, 120),
    createdAt: new Date().toISOString(),
  };
  existing.push(block);
  await kvSet(BLOCKS_KEY, existing);
  return block;
}

async function removeBlock(id) {
  const existing = await listBlocks();
  const next = existing.filter((b) => b.id !== id);
  if (next.length === existing.length) return false;
  await kvSet(BLOCKS_KEY, next);
  return true;
}

// One call for the API layer: the live buffer + blocks for a day, so every
// slot check (public booking, agent hold, admin move/walk-in, availability)
// uses the same live setting.
async function studioForDate(dateStr) {
  const [bufferMins, blocks] = await Promise.all([getBufferMins(), blocksForDate(dateStr)]);
  return { bufferMins, blocks };
}

module.exports = {
  STUDIO_ADDRESS, STUDIO_DIRECTIONS_URL,
  BUFFER_KEY, BLOCKS_KEY, MEET_KEY, MAX_BUFFER_MINS,
  cleanBufferMins, getBufferMins, setBufferMins,
  cleanMeetLink, getMeetLink, setMeetLink,
  parseClock, fmtClock,
  listBlocks, blocksForDate, addBlock, removeBlock, studioForDate,
};
