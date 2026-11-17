// Service catalog + weekly schedule, mirrored from the homepage (index.html).
// Prices are the exact approved prices — never invent a price here.
//   Classic Facial 55 min $65 · Anti-Aging Facial 80 min $95
//   NANO Needling add-on 15 min $55 · Microdermabrasion add-on 15 min $45
//   Light Therapy add-on 15 min $45 · Reflexology add-on 15 min $25
//   Chemical Peels 25 min $95–$475 (booked at the $95 starting price; the exact
//   price is confirmed at consultation and any balance is settled at the visit)
//   Microneedling + Skin Tightening: Custom — priced per consultation
//   The Works $135 (with Classic) / $165 (with Anti-Aging)
//   Private Hours (Quiet Hours): early 7–9am, after 7pm, Sundays — +$15/service
//   First visit: $10 toward any service.

const TIMES = ["9:00 AM", "10:00 AM", "11:00 AM", "12:30 PM", "1:30 PM", "2:30 PM", "3:30 PM", "4:30 PM", "5:30 PM"];
const TIMES_MORNING = ["7:00 AM", "7:45 AM", "8:30 AM"];
const TIMES_EVENING = ["7:00 PM", "7:45 PM", "8:30 PM"];

const QUIET_PREMIUM_CENTS = 1500; // +$15/service for Private Hours
const FIRST_VISIT_CENTS = 1000;   // $10 toward any service, first visit
const CONSULT_HOLD_MINS = 60;     // studio time held for a custom consultation
const BUFFER_MINS = 30;            // cleanup + prep between appointments — Sarah's room reset (Tony Nov 17: at least 30 min, raised from 15)

const SERVICES = [
  { id: "classic-facial", name: "Classic Facial", mins: 55, priceNum: 65, priceLabel: "$65", cat: "Signature Facial" },
  { id: "anti-aging-facial", name: "Anti-Aging Facial", mins: 80, priceNum: 95, priceLabel: "$95", cat: "Signature Facial" },
  { id: "nano-needling", name: "NANO Needling", mins: 15, priceNum: 55, priceLabel: "$55", cat: "Enhancement · Add-On" },
  { id: "microdermabrasion", name: "Microdermabrasion", mins: 15, priceNum: 45, priceLabel: "$45", cat: "Enhancement · Add-On" },
  { id: "light-therapy", name: "Light Therapy", mins: 15, priceNum: 45, priceLabel: "$45", cat: "Enhancement · Add-On" },
  { id: "reflexology", name: "Reflexology", mins: 15, priceNum: 25, priceLabel: "$25", cat: "Enhancement · Add-On" },
  { id: "chemical-peels", name: "Chemical Peels", mins: 25, priceNum: 95, priceLabel: "$95–$475", cat: "Advanced Treatment" },
  { id: "microneedling", name: "Microneedling", mins: 0, priceNum: 0, priceLabel: "Custom", cat: "Advanced Treatment" },
  { id: "skin-tightening", name: "Skin Tightening", mins: 0, priceNum: 0, priceLabel: "Custom", cat: "Advanced Treatment" },
];

const COMBOS = [
  { id: "combo-classic", name: "The Works — with Classic Facial", mins: 55, priceNum: 135, priceLabel: "$135", cat: "Signature Combo" },
  { id: "combo-anti", name: "The Works — with Anti-Aging Facial", mins: 80, priceNum: 165, priceLabel: "$165", cat: "Signature Combo" },
];

const GIFT_OPTIONS = {
  "gift-classic": { name: "Classic Facial Gift Certificate", amountCents: 6500 },
  "gift-anti": { name: "Anti-Aging Facial Gift Certificate", amountCents: 9500 },
  "gift-works": { name: "The Works Gift Certificate", amountCents: 13500 },
};

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

function slotTaken(bookings, startMin, durationMin) {
  const now = Date.now();
  const end = startMin + durationMin;
  return (bookings || []).some((b) => {
    if (b.status === "cancelled") return false;
    if (b.status === "pending" && now - new Date(b.createdAt).getTime() > PENDING_HOLD_MS) return false;
    const s = parseTime(b.time);
    if (s == null) return false;
    const svc = findService(b.service);
    const dur = svc ? durationFor(svc) : 60;
    // Buffer: the room needs cleanup + prep after every appointment, so a
    // booking occupies its service time PLUS the buffer on both sides —
    // the next client can't start until the room is reset, and a new
    // booking can't end so close before the next one that there's no
    // time to reset after it either.
    return startMin < s + dur + BUFFER_MINS && s < end + BUFFER_MINS;
  });
}

function freeTimes(dateStr, type, serviceId, bookings) {
  const svc = findService(serviceId);
  const dur = svc ? durationFor(svc) : 60;
  return timesFor(dateStr, type).filter((t) => !slotTaken(bookings, parseTime(t), dur));
}

function money(cents) {
  return "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");
}

module.exports = {
  TIMES, TIMES_MORNING, TIMES_EVENING,
  QUIET_PREMIUM_CENTS, FIRST_VISIT_CENTS, CONSULT_HOLD_MINS, BUFFER_MINS,
  SERVICES, COMBOS, GIFT_OPTIONS,
  findService, parseDateLocal, dateKey, timesFor, parseTime,
  durationFor, slotTaken, freeTimes, money, PENDING_HOLD_MS,
};
