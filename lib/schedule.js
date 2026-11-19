// Service catalog + weekly schedule, mirrored from the homepage (index.html).
// Prices are the exact approved prices — never invent a price here.
//   Classic Facial 55 min $85 · Anti-Aging Facial 80 min $125
//   NANO Needling add-on 20 min $65 · Microdermabrasion add-on 15 min $55
//   Light Therapy add-on 20 min $55 · Reflexology add-on 20 min $35
//   Chemical Peels 25 min $125–$475 (booked at the $125 starting price; the exact
//   price is confirmed at consultation and any balance is settled at the visit)
//   Microneedling: from $150 (booked at the $150 starting price; the exact
//   price is confirmed at consultation and any balance is settled at the visit)
//   Skin Tightening: Custom — priced per consultation
//   The Works $160 (with Classic) / $195 (with Anti-Aging)
//   Private Hours (Quiet Hours): early 7–9am, after 7pm, Sundays — +$15 per visit
//   First visit: $10 toward any service.

const TIMES = ["9:00 AM", "10:00 AM", "11:00 AM", "12:30 PM", "1:30 PM", "2:30 PM", "3:30 PM", "4:30 PM", "5:30 PM"];
const TIMES_MORNING = ["7:00 AM", "7:45 AM", "8:30 AM"];
const TIMES_EVENING = ["7:00 PM", "7:45 PM", "8:30 PM"];

const QUIET_PREMIUM_CENTS = 1500; // +$15 per visit for Private Hours
const FIRST_VISIT_CENTS = 1000;   // $10 toward any service, first visit
const CONSULT_HOLD_MINS = 60;     // studio time held for a custom consultation
const BUFFER_MINS = 30;            // cleanup + prep between appointments — Sarah's room reset (Tony Nov 17: at least 30 min, raised from 15)

const SERVICES = [
  { id: "classic-facial", name: "Classic Facial", mins: 55, priceNum: 85, priceLabel: "$85", cat: "Signature Facial" },
  { id: "anti-aging-facial", name: "Anti-Aging Facial", mins: 80, priceNum: 125, priceLabel: "$125", cat: "Signature Facial" },
  { id: "nano-needling", name: "NANO Needling", mins: 20, priceNum: 65, priceLabel: "$65", cat: "Enhancement · Add-On" },
  { id: "microdermabrasion", name: "Microdermabrasion", mins: 15, priceNum: 55, priceLabel: "$55", cat: "Enhancement · Add-On" },
  { id: "light-therapy", name: "Light Therapy", mins: 20, priceNum: 55, priceLabel: "$55", cat: "Enhancement · Add-On" },
  { id: "reflexology", name: "Reflexology", mins: 20, priceNum: 35, priceLabel: "$35", cat: "Enhancement · Add-On" },
  { id: "chemical-peels", name: "Chemical Peels", mins: 25, priceNum: 125, priceLabel: "$125–$475", cat: "Advanced Treatment" },
  { id: "microneedling", name: "Microneedling", mins: 0, priceNum: 150, priceLabel: "From $150", cat: "Advanced Treatment" },
  { id: "skin-tightening", name: "Skin Tightening", mins: 0, priceNum: 0, priceLabel: "Custom", cat: "Advanced Treatment" },
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
// consultation); add-ons are the four enhancements (NANO Needling, Light
// Therapy, and Reflexology are 20 minutes; Microdermabrasion is 15).
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
// (NANO, Light Therapy, and Reflexology are 20 minutes;
// Microdermabrasion is 15). Custom consultations hold
// CONSULT_HOLD_MINS and add-ons extend them too.
function durationForBooking(serviceId, addonIds) {
  const svc = findService(serviceId);
  const base = svc ? durationFor(svc) : 60;
  return base + normalizeAddons(addonIds).reduce((n, id) => {
    const a = addonById(id);
    return n + (a ? a.mins : 0);
  }, 0);
}

// Base price before first-visit offer / gift / referral credit: the
// treatment plus each add-on, with the $15 Private Hours premium ONCE per
// visit (one appointment, one premium — the same for vouchers).
function baseCentsFor(serviceId, addonIds, type) {
  const svc = findService(serviceId);
  if (!svc) throw new Error("Please choose a treatment.");
  let cents = svc.priceNum * 100;
  for (const id of normalizeAddons(addonIds)) cents += addonById(id).priceNum * 100;
  if (type === "after") cents += QUIET_PREMIUM_CENTS;
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
// regular hours 9:00 AM–5:30 PM; Private Hours weekday mornings 7–9 AM and
// evenings after 7 PM; Sundays run the full day (Private Hours all day).
function timesFor(dateStr, type) {
  const d = parseDateLocal(dateStr);
  if (!d) return [];
  if (type !== "after") return TIMES.slice();
  if (d.getDay() === 0) return TIMES_MORNING.concat(TIMES, TIMES_EVENING);
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
  return service.mins > 0 ? service.mins : CONSULT_HOLD_MINS;
}

// Pending bookings older than this stop holding their slot (abandoned checkout).
const PENDING_HOLD_MS = 30 * 60 * 1000;

// opts: { bufferMins, blocks }
//   bufferMins — gap after every appointment (default BUFFER_MINS, 30).
//     Sarah changes it in the admin panel; the API layer reads the live
//     setting and passes it in, so this stays a pure sync function.
//   blocks — studio-closed ranges for the day, [{ startMin, endMin }].
//     A block is closed time: an appointment may not overlap it, but the
//     buffer does NOT extend into or out of a block (the room can be reset
//     while the studio is closed).
function slotTaken(bookings, startMin, durationMin, opts) {
  const bufferMins = opts && Number.isFinite(opts.bufferMins) ? opts.bufferMins : BUFFER_MINS;
  const blocks = (opts && opts.blocks) || [];
  const now = Date.now();
  const end = startMin + durationMin;
  for (const b of blocks) {
    if (startMin < b.endMin && b.startMin < end) return true;
  }
  return (bookings || []).some((b) => {
    if (b.status === "cancelled") return false;
    if (b.status === "pending" && now - new Date(b.createdAt).getTime() > PENDING_HOLD_MS) return false;
    const s = parseTime(b.time);
    if (s == null) return false;
    // A stored booking occupies its full length — treatment PLUS any
    // add-ons — so the buffer wraps the whole appointment, both sides.
    const dur = durationForBooking(b.service, b.addons);
    // Buffer: the room needs cleanup + prep after every appointment, so a
    // booking occupies its service time PLUS the buffer on both sides —
    // the next client can't start until the room is reset, and a new
    // booking can't end so close before the next one that there's no
    // time to reset after it either.
    return startMin < s + dur + bufferMins && s < end + bufferMins;
  });
}

function freeTimes(dateStr, type, serviceId, bookings, opts, addonIds) {
  const dur = durationForBooking(serviceId, addonIds);
  return timesFor(dateStr, type).filter((t) => !slotTaken(bookings, parseTime(t), dur, opts));
}

function money(cents) {
  return "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");
}

module.exports = {
  TIMES, TIMES_MORNING, TIMES_EVENING,
  QUIET_PREMIUM_CENTS, FIRST_VISIT_CENTS, CONSULT_HOLD_MINS, BUFFER_MINS,
  SERVICES, COMBOS, GIFT_OPTIONS, VOUCHER_MAIN, VOUCHER_ADDONS, priceVoucher,
  ADDON_IDS, normalizeAddons, addonById, durationForBooking, baseCentsFor,
  findService, parseDateLocal, dateKey, timesFor, parseTime,
  durationFor, slotTaken, freeTimes, money, PENDING_HOLD_MS,
};
