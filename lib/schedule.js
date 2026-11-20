// Service catalog + weekly schedule, mirrored from the homepage (index.html).
// Prices are the exact approved prices — never invent a price here.
//   Classic Facial 55 min $85 · Anti-Aging Facial 80 min $125
//   NANO Needling add-on 20 min $65 · Microdermabrasion add-on 20 min $55
//   Light Therapy add-on 20 min $55 · Reflexology add-on 20 min $35
//   Chemical Peels 55 min $125–$475 (booked at the $125 starting price; the exact
//   price is confirmed at consultation and any balance is settled at the visit —
//   the 55 minutes includes the consultation)
//   Microneedling: $65, 20 min — the same treatment as NANO Needling, just
//   the needle size; a booking picks one or the other, never both, and
//   Sarah picks the size that's best for the client's face at the visit
//   The Works $160 (with Classic) / $195 (with Anti-Aging)
//   Consultation (Tony Nov 19, 2026): TWO formats, one service — a video
//   call on Google Meet, or a walk-in face consultation at the studio.
//   20 min with Sarah, $30 — paid up front by card, credited in full
//   toward any treatment once the consultation is done. FLAT $30 whenever
//   it happens (no $15 Private Hours premium after hours — the $30
//   consultation credit is the one first-visit offer), and it does
//   NOT count toward the 4-a-day cap: it fits in the gaps between
//   treatments. First-time clients only, one per client ever. The $30 is
//   earned once the consultation happens and cannot be clawed back; the
//   credit is issued when Sarah marks the consultation Completed, and
//   once the credit is used on a treatment it stays used — cancelling
//   that treatment refunds only the cash paid for it. A consultation
//   cancelled 24+ hours ahead is refundable (or free to reschedule);
//   a no-show forfeits the $30. NOTE: the consultation is in this server
//   catalog but NOT in the homepage SERVICES array in index.html — it
//   has no photo or service page (a call or a visit, not a treatment),
//   and the page builder would break on a service without one. The wizard
//   renders it from its own CONSULT object instead.
//   Private Hours (early mornings, evenings — by request through Sarah,
//   never bookable online): +$15 per visit
////
// SCHEDULE (Tony Nov 19, 2026 — Sarah's rules):
//   Days: Monday–Saturday. Sundays the studio is closed.
//   Starts: 10:00 AM–4:00 PM (last start 4:00 PM; a booking runs 1–1.5 h,
//   so the day ends 5–6 PM). At most MAX_BOOKINGS_PER_DAY bookings a day,
//   whatever they are.
//   Gap: at least MIN_GAP_MINS (60) between bookings, timed from when the
//   appointment ACTUALLY finishes — Sarah taps "Done" on the dashboard
//   finish check and the reset clock starts from the real finish time.
//   Overrun: she runs over (a 60-min service takes ~1 h 25), so a booking
//   blocks its listed length + OVERRUN_MINS until she marks it done.

const TIMES = ["10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
const TIMES_MORNING = ["7:00 AM", "7:45 AM", "8:30 AM"];
const TIMES_EVENING = ["7:00 PM", "7:45 PM", "8:30 PM"];
// Consultation request times (Tony Nov 19, 2026): evenings and early
// mornings BY REQUEST are a different set from Private Hours treatment
// times above — a consultation request offers 8:00/9:00 AM and 5:00–
// 8:00 PM. The wizard's AFTER_TIMES mirrors this list exactly; a
// request at one of these times must validate AND book (see timesFor).
const CONSULT_REQUEST_TIMES = ["8:00 AM", "9:00 AM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM"];

const QUIET_PREMIUM_CENTS = 1500; // +$15 per visit for Private Hours
const BUFFER_MINS = 60;            // gap between appointments (Tony Nov 19: at least 60 min — Sarah's room reset + break)
const MIN_GAP_MINS = 60;          // the gap is never less than this, whatever the admin setting says
const OVERRUN_MINS = 25;          // she runs ~25 min over a listed hour — a booking blocks its length + this until she marks it done
const MAX_BOOKINGS_PER_DAY = 4;   // four bookings a day, whatever they are (Tony Nov 19)

const SERVICES = [
  { id: "classic-facial", name: "Classic Facial", mins: 55, priceNum: 85, priceLabel: "$85", cat: "Signature Facial" },
  { id: "anti-aging-facial", name: "Anti-Aging Facial", mins: 80, priceNum: 125, priceLabel: "$125", cat: "Signature Facial" },
  { id: "nano-needling", name: "NANO Needling", mins: 20, priceNum: 65, priceLabel: "$65", cat: "Enhancement · Add-On" },
  { id: "microdermabrasion", name: "Microdermabrasion", mins: 20, priceNum: 55, priceLabel: "$55", cat: "Enhancement · Add-On" },
  { id: "light-therapy", name: "Light Therapy", mins: 20, priceNum: 55, priceLabel: "$55", cat: "Enhancement · Add-On" },
  { id: "reflexology", name: "Reflexology", mins: 20, priceNum: 35, priceLabel: "$35", cat: "Enhancement · Add-On" },
  { id: "chemical-peels", name: "Chemical Peels", mins: 55, priceNum: 125, priceLabel: "$125–$475", cat: "Advanced Treatment" },
  { id: "microneedling", name: "Microneedling", mins: 20, priceNum: 65, priceLabel: "$65", cat: "Advanced Treatment" },
  // Consultation (Tony Nov 19, 2026): countsTowardCap false — it
  // fits in the gaps, never uses one of the four daily treatment slots.
  // flatPrice — $30 whenever it happens, no Private Hours premium.
  { id: "consultation", name: "Consultation", mins: 20, priceNum: 30, priceLabel: "$30", cat: "Consultation", countsTowardCap: false, flatPrice: true },
];

const COMBOS = [
  { id: "combo-classic", name: "The Works — with Classic Facial", mins: 55, priceNum: 160, priceLabel: "$160", cat: "Signature Combo" },
  { id: "combo-anti", name: "The Works — with Anti-Aging Facial", mins: 80, priceNum: 195, priceLabel: "$195", cat: "Signature Combo" },
];

const GIFT_OPTIONS = {
  "gift-classic": { name: "Classic Facial Gift Certificate", amountCents: 8500 },
  "gift-anti": { name: "Anti-Aging Facial Gift Certificate", amountCents: 12500 },
  "gift-works": { name: "The Works Gift Certificate", amountCents: 16000 },
};

// Treatment vouchers (Tony Nov 17, 2026): a named facial + add-ons, paid
// ahead. Main must be a fixed-price facial (never a custom-priced
// consultation); add-ons are the four enhancements (all 20 minutes).
// Private Hours adds a $15 fee once per visit, however many treatments
// the voucher covers.
const VOUCHER_MAIN = ["classic-facial", "anti-aging-facial", "combo-classic", "combo-anti"];
const VOUCHER_ADDONS = ["nano-needling", "microdermabrasion", "light-therapy", "reflexology"];

// Booking add-ons (Tony Nov 17, 2026; lengths per Sarah Nov 19, 2026):
// the same four enhancements attach to ANY treatment in the booking
// wizard — pick the treatment first, then tick add-ons. Never standalone
// on the website.
const ADDON_IDS = VOUCHER_ADDONS.slice();

function normalizeAddons(addonIds) {
  const out = [];
  const seen = new Set();
  for (const id of addonIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!ADDON_IDS.includes(id)) throw new Error("That add-on is not available with a booking.");
    out.push(id);
  }
  return out;
}

function addonById(id) { return SERVICES.find((s) => s.id === id) || null; }

// Full appointment length: the treatment plus each add-on's own length
// (all four add-ons are 20 minutes).
function durationForBooking(serviceId, addonIds) {
  const svc = findService(serviceId);
  const base = svc ? durationFor(svc) : 60;
  return base + normalizeAddons(addonIds).reduce((n, id) => {
    const a = addonById(id);
    return n + (a ? a.mins : 0);
  }, 0);
}

// Does a booking of this service count toward the 4-a-day cap? Video
// consultations don't — they fit in the gaps between treatments.
function countsTowardCap(serviceId) {
  const svc = findService(serviceId);
  return !svc || svc.countsTowardCap !== false;
}

// Base price before gift / referral credit: the
// treatment plus each add-on, with the $15 Private Hours premium ONCE per
// visit (one appointment, one premium — the same for vouchers). Flat-price
// services (the video consultation) never take the premium — $30 whenever.
function baseCentsFor(serviceId, addonIds, type) {
  const svc = findService(serviceId);
  if (!svc) throw new Error("Please choose a treatment.");
  let cents = svc.priceNum * 100;
  for (const id of normalizeAddons(addonIds)) cents += addonById(id).priceNum * 100;
  if (type === "after" && !svc.flatPrice) cents += QUIET_PREMIUM_CENTS;
  return cents;
}

function priceVoucher(mainId, addonIds, type) {
  const main = findService(mainId);
  if (!main || !VOUCHER_MAIN.includes(mainId)) {
    throw new Error("Please choose a facial for the voucher — Classic, Anti-Aging, or The Works.");
  }
  const addons = [];
  const seen = new Set();
  for (const id of addonIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = findService(id);
    if (!a || !VOUCHER_ADDONS.includes(id)) {
      throw new Error("That add-on cannot be added to a voucher.");
    }
    addons.push(a);
  }
  const premium = type === "after" ? QUIET_PREMIUM_CENTS : 0;
  const items = [main, ...addons];
  const totalCents = items.reduce((n, s) => n + s.priceNum * 100, 0) + premium;
  const label = [main.name, ...addons.map((a) => a.name)].join(" + ") + " — " + money(totalCents);
  return { totalCents, label, main, addons, type: type === "after" ? "after" : "regular" };
}

function findService(id) {
  return SERVICES.find((s) => s.id === id) || COMBOS.find((c) => c.id === id) || null;
}

function parseDateLocal(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

function dateKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The studio's weekly schedule, exactly as on the homepage:
// regular hours Monday–Saturday, starts 10:00 AM–4:00 PM. Sundays the
// studio is closed — no times at all, either mode. "after" (early morning
// 7–9 AM / evening 7–8:30 PM) exists only for Sarah herself in the admin
// panel — the public site and the voice agent never offer it.
function timesFor(dateStr, type, serviceId) {
  const d = parseDateLocal(dateStr);
  if (!d) return [];
  if (d.getDay() === 0) return []; // Sundays: closed
  if (type !== "after") return TIMES.slice();
  // A consultation request uses the request times, not the Private Hours
  // treatment times — the wizard offers these, so the server must accept
  // them (a request at 6:00 PM is valid; a treatment at 6:00 PM is not).
  if (serviceId === "consultation") return CONSULT_REQUEST_TIMES.slice();
  return TIMES_MORNING.concat(TIMES_EVENING);
}

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t || "");
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

function durationFor(service) {
  return service.mins;
}

// Pending bookings older than this stop holding their slot (abandoned checkout).
const PENDING_HOLD_MS = 30 * 60 * 1000;

// opts: { bufferMins, blocks }
//   bufferMins — gap after every appointment (default BUFFER_MINS, 60).
//     Sarah changes it in the admin panel; the API layer reads the live
//     setting and passes it in, so this stays a pure sync function.
//   blocks — studio-closed ranges for the day, [{ startMin, endMin }].
//     A block is closed time: an appointment may not overlap it, but the
//     buffer does NOT extend into or out of a block (the room can be reset
//     while the studio is closed).
// A booking occupies its listed length PLUS the overrun (she runs ~25 min
// over) — until Sarah taps "Done" on the finish check, when the room is
// free from the real finish time (booking.actualEndMin) instead.
function slotTaken(bookings, startMin, durationMin, opts) {
  const bufferMins = opts && Number.isFinite(opts.bufferMins) ? opts.bufferMins : BUFFER_MINS;
  const blocks = (opts && opts.blocks) || [];
  const now = Date.now();
  const end = startMin + durationMin + OVERRUN_MINS;
  for (const b of blocks) {
    if (startMin < b.endMin && b.startMin < end) return true;
  }
  return (bookings || []).some((b) => {
    if (b.status === "cancelled") return false;
    if (b.status === "pending" && now - new Date(b.createdAt).getTime() > PENDING_HOLD_MS) return false;
    const s = parseTime(b.time);
    if (s == null) return false;
    // A stored booking occupies its full length — treatment PLUS any
    // add-ons — plus the overrun, so the buffer wraps the whole
    // appointment, both sides. Once Sarah marks it done, the room is
    // free from the real finish time instead.
    const dur = durationForBooking(b.service, b.addons);
    const occupiedEnd = (b.finishedAt && Number.isFinite(b.actualEndMin))
      ? b.actualEndMin
      : s + dur + OVERRUN_MINS;
    // Buffer: the room needs cleanup + prep after every appointment, so a
    // booking occupies its service time PLUS the buffer on both sides —
    // the next client can't start until the room is reset, and a new
    // booking can't end so close before the next one that there's no
    // time to reset after it either.
    return startMin < occupiedEnd + bufferMins && s < end + bufferMins;
  });
}

// How many of the day's bookings count toward the 4-a-day cap: every
// booking that is still real — cancelled ones don't count, and a pending
// booking whose 30-minute hold has expired has already released its slot.
// Video consultations never count (countsTowardCap) — they fit in the gaps.
function countActiveBookings(bookings, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return (bookings || []).filter((b) => {
    if (!b || b.status === "cancelled") return false;
    if (!countsTowardCap(b.service)) return false;
    if (b.status === "pending" && now - new Date(b.createdAt).getTime() > PENDING_HOLD_MS) return false;
    return true;
  }).length;
}

function dayIsFull(bookings, nowMs) {
  return countActiveBookings(bookings, nowMs) >= MAX_BOOKINGS_PER_DAY;
}

// The finish check (Tony Nov 19, 2026): about an hour into an appointment
// Sarah gets asked "are you done yet?" — due when the appointment has run
// an hour, she hasn't marked it done, and a snooze (if any) has expired.
// todayKey is the Toronto date (YYYY-MM-DD); nowMins is Toronto minutes
// since midnight; nowMs is the epoch time for the pending-hold check.
function finishCheckDue(booking, todayKey, nowMins, nowMs) {
  if (!booking || booking.date !== todayKey) return false;
  if (booking.finishedAt) return false;
  if (!["paid", "consultation", "pending"].includes(booking.status)) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (booking.status === "pending" && now - new Date(booking.createdAt).getTime() > PENDING_HOLD_MS) return false;
  if (booking.finishSnoozedUntil && new Date(booking.finishSnoozedUntil).getTime() > now) return false;
  const s = parseTime(booking.time);
  if (s == null) return false;
  return nowMins >= s + 60;
}

function freeTimes(dateStr, type, serviceId, bookings, opts, addonIds) {
  const dur = durationForBooking(serviceId, addonIds);
  return timesFor(dateStr, type, serviceId).filter((t) => !slotTaken(bookings, parseTime(t), dur, opts));
}

function money(cents) {
  return "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");
}

module.exports = {
  TIMES, TIMES_MORNING, TIMES_EVENING, CONSULT_REQUEST_TIMES,
  QUIET_PREMIUM_CENTS, BUFFER_MINS,
  MIN_GAP_MINS, OVERRUN_MINS, MAX_BOOKINGS_PER_DAY,
  SERVICES, COMBOS, GIFT_OPTIONS, VOUCHER_MAIN, VOUCHER_ADDONS, priceVoucher,
  ADDON_IDS, normalizeAddons, addonById, durationForBooking, baseCentsFor,
  findService, countsTowardCap, parseDateLocal, dateKey, timesFor, parseTime,
  durationFor, slotTaken, freeTimes, money, PENDING_HOLD_MS,
  countActiveBookings, dayIsFull, finishCheckDue,
};
