// Admin dashboard tests — cancel / move / blocks / buffer / walk-in /
// payments / email / reports / agentMode / caller messages / webhook
// pay-link-to-booking / payspot GET fallback (settle without the webhook).
// Run: node scripts/test-admin.js
// Uses an in-memory KV stub + stubbed auth/Stripe (no Stripe/KV/Resend needed).
const assert = require("assert");

// --- in-memory KV, stubbed before any lib loads ---
const mem = new Map();
// The monthly backup is active in tests (Tony Nov 19, 2026 — the delete
// gate needs it); section 19 tests the gate itself by removing this flag.
mem.set("backup:lastMonthly", new Date().toISOString());
const kvPath = require.resolve("../lib/kv");
require.cache[kvPath] = {
  exports: {
    configured: () => true,
    kvGet: async (k) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : null),
    kvSet: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); },
    kvDel: async (k) => { mem.delete(k); },
    pipeline: async () => { throw new Error("pipeline not available in tests"); },
  },
};
// --- admin auth stub: every data.js call is signed in as the studio ---
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = {
  exports: {
    requireAdmin: async () => ({ email: "sarah@test.example" }),
    adminEmails: () => ["sarah@test.example", "tony@test.example"],
  },
};
// --- Stripe stub: checkout sessions + payment links + webhook verify ---
// retrieveOverride lets a test pose as one specific checkout session
// (the payspot fallback reads the session back from Stripe); otherwise
// retrieve returns the generic paid session. lastPaymentLinkArgs captures
// the payment-link creation call (the pay-paid redirect lives in it).
let retrieveOverride = null;
let lastPaymentLinkArgs = null;
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" }),
          retrieve: async (id) => (
            retrieveOverride && retrieveOverride.id === id ? retrieveOverride
            : { payment_status: "paid", amount_total: 6500, metadata: {}, payment_intent: "pi_test" }
          ),
        },
      },
      paymentLinks: {
        create: async (args) => { lastPaymentLinkArgs = args; return { id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }; },
      },
      webhooks: {
        constructEvent: (raw) => JSON.parse(raw.toString()),
      },
    }),
  },
};

delete process.env.RESEND_API_KEY;
process.env.AGENT_API_KEY = "test-agent-key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

const sched = require("../lib/schedule");
const studio = require("../lib/studio");
const transfer = require("../lib/transfer");
const bookingsLib = require("../lib/bookings");
const referralsLib = require("../lib/referrals");
const messagesLib = require("../lib/messages");
const dataHandler = require("../api/admin/data");
const availability = require("../api/availability");
const transferStatusHandler = require("../api/transfer-status");
const webhook = require("../api/stripe-webhook");
const book = require("../api/book");
const payHandler = require("../api/pay");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log("FAIL:", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); }
  return ok;
}
function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
function mockReq({ method = "GET", headers = {}, body = null, query = {} } = {}) {
  return { method, headers, body, query };
}
async function callAdmin(body, query = {}) {
  const res = mockRes();
  await dataHandler(mockReq({ method: body ? "POST" : "GET", body, query }), res);
  return res;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return sched.dateKey(d);
}
// First start day at least minDays out whose 3-day window holds no Sunday
// (Nov 23, 2026): Sundays have no slots, so a range test expecting 15
// free slots breaks whenever the window contains one. A window starting
// Fri, Sat or Sun always does — start Mon–Thu instead.
function weekdayRangeStart(baseStr, minDays) {
  let n = minDays;
  for (;;) {
    const d = new Date(baseStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    const day = d.getDay();
    if (day >= 1 && day <= 4) return addDays(baseStr, n);
    n++;
  }
}
function torontoToday() {
  return transfer.torontoDateKey();
}
function voucherSession(id, label, totalCents, kind) {
  return {
    id,
    amount_total: totalCents,
    metadata: {
      type: "gift", kind: kind || "voucher", amountCents: String(totalCents),
      buyerName: "Jordan Smith", buyerEmail: "jordan@example.com",
      recipientName: "Sam Friend", recipientEmail: "sam@example.com",
      message: "Happy birthday!",
      voucherLabel: label,
      voucherFor: JSON.stringify({
        service: "classic-facial", serviceName: "Classic Facial",
        addons: [{ id: "reflexology", name: "Reflexology" }], type: "regular",
      }),
    },
  };
}

async function run() {
  const today = torontoToday();
  const d1 = addDays(today, 1);
  const d2 = addDays(today, 2);
  const d3 = addDays(today, 3);
  const d4 = addDays(today, 4);

  // ---------- 1. buffer setting ----------
  check("buffer default is 60", await studio.getBufferMins(), 60);
  let threw = false;
  try { await studio.setBufferMins(15); } catch { threw = true; }
  check("buffer 15 rejected (60-min floor)", threw, true);
  check("buffer set to 60", await studio.setBufferMins(60), 60);
  check("buffer reads back 60", await studio.getBufferMins(), 60);
  check("buffer set to 90", await studio.setBufferMins(90), 90);
  threw = false;
  try { await studio.setBufferMins(999); } catch { threw = true; }
  check("buffer 999 rejected", threw, true);
  threw = false;
  try { await studio.setBufferMins("abc"); } catch { threw = true; }
  check("buffer non-number rejected", threw, true);
  // A gap saved before the 60-minute rule still counts as 60 — the rule
  // is a floor, not a preference.
  mem.set("studio:buffer", 30);
  check("legacy 30-min gap reads as 60", await studio.getBufferMins(), 60);
  const classic9 = [{ time: "9:00 AM", service: "classic-facial", status: "paid", createdAt: new Date().toISOString() }];
  // A3: a 9:00 Classic blocks to 10:55 (55 + 60 reset), so 10:30 is
  // blocked and 11:00 is the next free start.
  check("60-min reset blocks 10:30 add-on", sched.slotTaken(classic9, sched.parseTime("10:30 AM"), 15, { bufferMins: 60 }), true);
  check("11:00 add-on free after 9:00 Classic (reset ends 10:55)", sched.slotTaken(classic9, sched.parseTime("11:00 AM"), 15, { bufferMins: 60 }), false);
  check("30-min buffer is clamped to the 60-min floor", sched.slotTaken(classic9, sched.parseTime("10:30 AM"), 15, { bufferMins: 30 }), true);
  check("slotTaken defaults to 60 when no opts", sched.slotTaken(classic9, sched.parseTime("10:30 AM"), 15), true);
  await studio.setBufferMins(60);

  // ---------- 2. blocks ----------
  const block = await studio.addBlock({ date: d4, start: "12:00", end: "13:00", reason: "Day off" });
  check("block has an id", !!block.id, true);
  check("block start label", block.startLabel, "12:00 PM");
  threw = false;
  try { await studio.addBlock({ date: d4, start: "12:30", end: "13:30", reason: "overlap" }); } catch { threw = true; }
  check("overlapping block rejected", threw, true);
  threw = false;
  try { await studio.addBlock({ date: d4, start: "14:00", end: "13:00", reason: "backwards" }); } catch { threw = true; }
  check("end-before-start rejected", threw, true);
  const blocks = await studio.blocksForDate(d4);
  check("blocksForDate finds it", blocks.length, 1);
  const freeWithBlock = sched.freeTimes(d4, "regular", "classic-facial", [], { bufferMins: 30, blocks });
  check("10:00 AM still free", freeWithBlock.includes("10:00 AM"), true);
  check("11:00 AM blocked by the noon block", freeWithBlock.includes("11:00 AM"), false);
  check("12:00 PM blocked", freeWithBlock.includes("12:00 PM"), false);
  check("1:00 PM free after block", freeWithBlock.includes("1:00 PM"), true);
  let res = mockRes();
  await availability(mockReq({ query: { date: d4, service: "classic-facial", type: "regular" } }), res);
  check("availability hides blocked 12:00", res.body.times.includes("12:00 PM"), false);
  check("availability keeps 10:00", res.body.times.includes("10:00 AM"), true);
  check("block removed", await studio.removeBlock(block.id), true);
  check("block gone", (await studio.blocksForDate(d4)).length, 0);
  res = mockRes();
  await availability(mockReq({ query: { date: d4, service: "classic-facial", type: "regular" } }), res);
  check("availability shows 12:00 after removal", res.body.times.includes("12:00 PM"), true);

  // ---------- 2b. availability range mode (date-grid statuses) ----------
  const d5 = weekdayRangeStart(today, 5);
  const d6 = addDays(d5, 1);
  const d7 = addDays(d5, 2);
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: d7, service: "classic-facial" } }), res);
  check("range -> 200", res.statusCode, 200);
  check("range covers 3 days", Object.keys(res.body.dates || {}).length, 3);
  check("range d5 regular total 15", res.body.dates[d5].regular.total, 15);
  check("range d5 regular free 15 (empty)", res.body.dates[d5].regular.free, 15);
  check("range d5 after total matches schedule", res.body.dates[d5].after.total, sched.timesFor(d5, "after").length);
  check("range d5 after free 0 (never bookable online)", res.body.dates[d5].after.free, 0);
  check("range d7 regular free 15 (empty)", res.body.dates[d7].regular.free, 15);
  const block2 = await studio.addBlock({ date: d6, start: "12:00", end: "13:00", reason: "Range test" });
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: d7, service: "classic-facial" } }), res);
  check("range d6 regular free 10 with block", res.body.dates[d6].regular.free, 10);
  check("range d6 regular total still 15", res.body.dates[d6].regular.total, 15);
  check("range d6 after free 0 (never bookable online)", res.body.dates[d6].after.free, 0);
  check("range d5 still free 15 with d6 blocked", res.body.dates[d5].regular.free, 15);
  check("range block removed", await studio.removeBlock(block2.id), true);
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: d7, service: "nope" } }), res);
  check("range bad service -> 400", res.statusCode, 400);
  res = mockRes();
  await availability(mockReq({ query: { from: "2026-13-40", to: d7, service: "classic-facial" } }), res);
  check("range bad from -> 400", res.statusCode, 400);
  res = mockRes();
  await availability(mockReq({ query: { from: d7, to: d5, service: "classic-facial" } }), res);
  check("range from after to -> 400", res.statusCode, 400);
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: addDays(d5, 31), service: "classic-facial" } }), res);
  check("range over 31 days -> 400", res.statusCode, 400);

  // ---------- 3. walk-in booking ----------
  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "classic-facial", type: "regular", date: d1, time: "10:00 AM",
    name: "Walk In", phone: "(905) 555-0101", email: "walkin@example.com",
    first: "no", payment: "cash",
  });
  check("walk-in cash -> 200", res.statusCode, 200);
  const walkIn = res.body.booking;
  check("walk-in paid", walkIn.status, "paid");
  check("walk-in amount $85", walkIn.amountCents, 8500);
  check("walk-in paid in full", walkIn.amountPaidCents, 8500);
  check("walk-in balance $0", walkIn.balanceDueCents, 0);
  check("walk-in via admin", walkIn.via, "admin");
  check("walk-in got a referral code", !!walkIn.myReferralCode, true);

  // Complete / no-show need the visit to have happened (Nov 23, 2026):
  // completing a future booking early would issue the $30 consultation
  // credit before the visit. The refusal mutates nothing.
  res = await callAdmin({ view: "bookings", action: "complete", bookingId: walkIn.id });
  check("complete on a future booking -> 400", res.statusCode, 400);
  res = await callAdmin({ view: "bookings", action: "no-show", bookingId: walkIn.id });
  check("no-show on a future booking -> 400", res.statusCode, 400);

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "classic-facial", type: "regular", date: d1, time: "1:00 PM",
    name: "Pay Later", phone: "(905) 555-0102", email: "later@example.com",
    first: "no", payment: "later",
  });
  check("walk-in later -> 200", res.statusCode, 200);
  const laterBk = res.body.booking;
  check("walk-in later status unpaid", laterBk.status, "unpaid");
  check("walk-in later balance $85", laterBk.balanceDueCents, 8500);

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "anti-aging-facial", type: "regular", date: d1, time: "4:00 PM",
    name: "Pay Link", phone: "(905) 555-0103", email: "paylink@example.com",
    first: "no", payment: "pay-link",
  });
  check("walk-in pay-link -> 200", res.statusCode, 200);
  check("walk-in pay-link status pending", res.body.booking.status, "pending");
  check("walk-in pay-link has checkout url", res.body.checkoutUrl, "https://checkout.stripe.test/pay/cs_test_1");

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "classic-facial", type: "regular", date: d1, time: "10:00 AM",
    name: "Double", phone: "(905) 555-0104", email: "double@example.com",
    first: "no", payment: "cash",
  });
  check("walk-in double-booked slot -> 409", res.statusCode, 409);

  // ---------- 4. cancel (voucher + plain gift restore, slot frees) ----------
  const gift = await bookingsLib.ensureGiftCode(voucherSession("cs_admin_v1", "Classic Facial — $65", 6500));
  const bkV = {
    id: "bk-admin-v1", status: "paid", forWhom: "me", name: "Sam Friend",
    email: "sam@example.com", phone: "(905) 555-0505",
    service: "classic-facial", serviceName: "Classic Facial", date: d2, time: "10:00 AM",
    giftCode: gift.code, giftAppliedCents: 6500, giftDeducted: false,
    amountCents: 0, amountPaidCents: 0, createdAt: new Date().toISOString(),
  };
  await bookingsLib.saveBooking(bkV);
  await bookingsLib.deductGift(bkV);
  check("voucher $0 after use", (await bookingsLib.getGift(gift.code)).balanceCents, 0);
  res = await callAdmin({ view: "bookings", action: "cancel", bookingId: "bk-admin-v1", reason: "Studio closed" });
  check("cancel voucher booking -> 200", res.statusCode, 200);
  check("cancelled status", res.body.booking.status, "cancelled");
  check("cancel restores voucher balance", (await bookingsLib.getGift(gift.code)).balanceCents, 6500);
  check("cancel frees the slot", sched.slotTaken(await bookingsLib.listBookingsForDate(d2), sched.parseTime("10:00 AM"), 55), false);
  res = await callAdmin({ view: "bookings", action: "cancel", bookingId: "bk-admin-v1" });
  check("cancel twice -> 400", res.statusCode, 400);

  const plain = await bookingsLib.ensureGiftCode({
    id: "cs_admin_g1", amount_total: 6500,
    metadata: { type: "gift", amountCents: "6500", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "b@example.com" },
  });
  const bkG = {
    id: "bk-admin-g1", status: "paid", forWhom: "me", name: "B", email: "b@example.com", phone: "(905) 555-0506",
    service: "classic-facial", serviceName: "Classic Facial", date: d2, time: "11:00 AM",
    giftCode: plain.code, giftAppliedCents: 6500, giftDeducted: false,
    amountCents: 0, amountPaidCents: 0, createdAt: new Date().toISOString(),
  };
  await bookingsLib.saveBooking(bkG);
  await bookingsLib.deductGift(bkG);
  check("plain gift $0 after use", (await bookingsLib.getGift(plain.code)).balanceCents, 0);
  res = await callAdmin({ view: "bookings", action: "cancel", bookingId: "bk-admin-g1" });
  check("cancel restores plain gift balance", (await bookingsLib.getGift(plain.code)).balanceCents, 6500);

  // ---------- 5. move ----------
  // d1 now: walk-in Classic 10:00 (paid), later Classic 1:00 PM (unpaid), Anti 4:00 PM (pending).
  // A3: a Classic at 12:00 blocks into the 1:00 PM booking (12:00 + 55 + 60 reset runs to 1:55).
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "12:00 PM", type: "regular" });
  check("move into a blocked slot -> 409", res.statusCode, 409);
  // d2 is a Sunday when the suite runs on a Friday — move to the next
  // weekday instead so the target day is always open.
  const moveDay = new Date(d2 + "T00:00:00").getDay() === 0 ? d3 : d2;
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: moveDay, time: "10:00 AM", type: "regular" });
  check("move to a free slot -> 200", res.statusCode, 200);
  check("moved time", res.body.booking.time, "10:00 AM");
  const day2 = await bookingsLib.listBookingsForDate(moveDay);
  check("moved booking shows at new time", day2.some((b) => b.id === walkIn.id && b.time === "10:00 AM"), true);
  const day1 = await bookingsLib.listBookingsForDate(d1);
  check("old slot free after move", sched.slotTaken(day1, sched.parseTime("10:00 AM"), 55), false);
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "7:00 PM", type: "after" });
  check("move regular -> Private Hours -> 200", res.statusCode, 200);
  check("Private Hours adds $15", res.body.booking.amountCents, 10000);
  check("balance due $15 after move", res.body.booking.balanceDueCents, 1500);
  // Blocked time blocks a move.
  const blk2 = await studio.addBlock({ date: d1, start: "12:00", end: "13:00", reason: "lunch" });
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "12:00 PM", type: "regular" });
  check("move into a blocked time -> 409", res.statusCode, 409);
  await studio.removeBlock(blk2.id);
  res = await callAdmin({ view: "bookings", action: "move", bookingId: "bk-admin-v1", date: d1, time: "10:00 AM", type: "regular" });
  check("move a cancelled booking -> 400", res.statusCode, 400);

  // ---------- 6. payments: set-amount + record-payment ----------
  res = await callAdmin({ view: "bookings", action: "set-amount", bookingId: laterBk.id, amountCents: 9500, note: "Exact peel price" });
  check("set-amount -> 200", res.statusCode, 200);
  check("set-amount persists", res.body.booking.amountCents, 9500);
  check("set-amount balance $95", res.body.booking.balanceDueCents, 9500);
  res = await callAdmin({ view: "bookings", action: "record-payment", bookingId: laterBk.id, amountCents: 5000, method: "cash", note: "At the visit" });
  check("record-payment partial -> 200", res.statusCode, 200);
  check("partial still unpaid", res.body.booking.status, "unpaid");
  check("partial balance $45", res.body.booking.balanceDueCents, 4500);
  res = await callAdmin({ view: "bookings", action: "record-payment", bookingId: laterBk.id, amountCents: 4500, method: "e-transfer" });
  check("record-payment rest -> 200", res.statusCode, 200);
  check("fully paid flips to paid", res.body.booking.status, "paid");
  check("fully paid balance $0", res.body.booking.balanceDueCents, 0);
  res = await callAdmin({ view: "bookings", action: "record-payment", bookingId: "bk-admin-v1", amountCents: 100, method: "cash" });
  check("record-payment on cancelled -> 400", res.statusCode, 400);
  res = await callAdmin({ view: "bookings", action: "set-amount", bookingId: res.body.booking ? "x" : "bk-admin-v1", amountCents: 100 });
  check("set-amount on cancelled -> 400", res.statusCode, 400);
  // Pending booking (pay-link walk-in) refuses a recorded payment.
  const pendingBk = (await bookingsLib.listBookingsForDate(d1)).find((b) => b.email === "paylink@example.com");
  res = await callAdmin({ view: "bookings", action: "record-payment", bookingId: pendingBk.id, amountCents: 100, method: "cash" });
  check("record-payment on pending -> 400", res.statusCode, 400);
  // Pay link for a balance due.
  res = await callAdmin({ view: "bookings", action: "pay-link", bookingId: walkIn.id });
  check("pay-link for $15 balance -> 200", res.statusCode, 200);
  check("pay-link url is the /pay page", String(res.body.url).startsWith("https://boltonfacials.com/pay?id="), true);
  res = await callAdmin({ view: "bookings", action: "pay-link", bookingId: pendingBk.id });
  check("pay-link on pending resends checkout", res.body.url, "https://checkout.stripe.test/pay/cs_test_1");
  check("pay-link on pending flags resent", res.body.resent, true);

  // ---------- 7. email the client ----------
  res = await callAdmin({ view: "bookings", action: "resend-confirmation", bookingId: walkIn.id });
  check("resend-confirmation -> 200", res.statusCode, 200);
  check("resend attempted (no Resend key -> false, no throw)", res.body.emailed, false);
  res = await callAdmin({ view: "bookings", action: "email-client", bookingId: walkIn.id, subject: "See you soon", message: "Looking forward to it!" });
  check("email-client -> 200", res.statusCode, 200);
  check("email-client attempted", res.body.emailed, false);
  res = await callAdmin({ view: "bookings", action: "email-client", bookingId: walkIn.id, subject: "", message: "x" });
  check("email-client missing subject -> 400", res.statusCode, 400);
  res = await callAdmin({ view: "bookings", action: "email-client", bookingId: "nope", subject: "Hi", message: "x" });
  check("email-client unknown booking -> 404", res.statusCode, 404);

  // ---------- 8. reports ----------
  const rep = await callAdmin(null, { view: "reports", from: today, to: addDays(today, 7) });
  check("reports -> 200", rep.statusCode, 200);
  check("reports counts the d1/d2 bookings", rep.body.totals.bookingsCount >= 5, true);
  check("reports has clients", rep.body.totals.clientsCount >= 3, true);
  check("reports revenue collected > 0", rep.body.totals.revenueCollectedCents > 0, true);
  const walkClient = rep.body.clients.find((c) => c.email === "walkin@example.com");
  check("reports groups by client email", !!walkClient, true);
  check("reports client paid total", walkClient ? walkClient.totalPaidCents : 0, 8500);

  // ---------- 9. agentMode ----------
  check("agentMode default is agent", transfer.defaultSettings().agentMode, "agent");
  check("cleanSettings keeps direct", transfer.cleanSettings({ agentMode: "direct" }).agentMode, "direct");
  check("cleanSettings rejects bogus mode", transfer.cleanSettings({ agentMode: "bogus" }).agentMode, "agent");
  check("cleanSettings defaults agent", transfer.cleanSettings({}).agentMode, "agent");
  const base = transfer.defaultSettings();
  base.agentMode = "direct";
  const saved = await transfer.saveSettings(base);
  check("saveSettings keeps direct", saved.agentMode, "direct");
  check("getSettings reads back direct", (await transfer.getSettings()).agentMode, "direct");
  check("transferStatus carries direct", transfer.transferStatus(await transfer.getSettings()).agentMode, "direct");
  res = mockRes();
  await transferStatusHandler(mockReq({ method: "GET" }), res);
  check("transfer-status GET returns agentMode", res.body.agentMode, "direct");
  // Save through the admin path, then read back.
  res = await callAdmin({ view: "transfer-hours", settings: { ...transfer.defaultSettings(), agentMode: "agent" } });
  check("admin save agentMode agent -> 200", res.statusCode, 200);
  check("admin save returns agent", res.body.settings.agentMode, "agent");
  res = await callAdmin(null, { view: "transfer-hours" });
  check("admin read returns agent", res.body.settings.agentMode, "agent");

  // ---------- 10. caller messages ----------
  delete process.env.AGENT_API_KEY;
  res = mockRes();
  await transferStatusHandler(mockReq({ method: "POST", headers: {}, body: { name: "A", phone: "9055550100", reason: "x" } }), res);
  check("message with no key -> 503", res.statusCode, 503);
  check("503 names AGENT_API_KEY", /AGENT_API_KEY/.test(res.body.error || ""), true);
  process.env.AGENT_API_KEY = "test-agent-key";
  res = mockRes();
  await transferStatusHandler(mockReq({ method: "POST", headers: { "x-agent-key": "wrong" }, body: { name: "A", phone: "9055550100", reason: "x" } }), res);
  check("message with wrong key -> 401", res.statusCode, 401);
  res = mockRes();
  await transferStatusHandler(mockReq({
    method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { name: "Caller One", phone: "(905) 555-0199", reason: "Wants a facial", callId: "call_1" },
  }), res);
  check("message with right key -> 200", res.statusCode, 200);
  check("message stored, id returned", !!res.body.id, true);
  check("message email attempted (no key -> false)", res.body.emailed, false);
  const stored = await messagesLib.listMessages();
  check("one message stored", stored.length, 1);
  check("message name", stored[0].name, "Caller One");
  check("message reason", stored[0].reason, "Wants a facial");
  check("message unread", stored[0].read, false);
  res = mockRes();
  await transferStatusHandler(mockReq({
    method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { name: "", phone: "(905) 555-0199", reason: "x" },
  }), res);
  check("message without name -> 400", res.statusCode, 400);
  res = mockRes();
  await transferStatusHandler(mockReq({
    method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { name: "A", phone: "123", reason: "x" },
  }), res);
  check("message with bad phone -> 400", res.statusCode, 400);
  res = await callAdmin(null, { view: "messages" });
  check("admin messages view -> 200", res.statusCode, 200);
  check("admin messages lists it", res.body.messages.length, 1);
  const msgId = stored[0].id;
  res = await callAdmin({ view: "messages", action: "read", id: msgId, read: true });
  check("mark read -> 200", res.statusCode, 200);
  check("message now read", (await messagesLib.listMessages())[0].read, true);
  res = await callAdmin({ view: "messages", action: "read", id: "msg_nope", read: true });
  check("mark read unknown -> 404", res.statusCode, 404);
  res = await callAdmin({ view: "messages", action: "delete", id: msgId });
  check("delete -> 200", res.statusCode, 200);
  check("messages empty after delete", (await messagesLib.listMessages()).length, 0);

  // ---------- 11. webhook: pay-spot link tied to a booking ----------
  const payWalkIn = (await bookingsLib.listBookingsForDate(d1)).find((b) => b.email === "walkin@example.com");
  const link = await bookingsLib.createPayLink({
    amountCents: 1500, clientName: "Walk In", contact: "walkin@example.com",
    method: "email", serviceLabel: "Classic Facial — balance", bookingId: payWalkIn.id,
  });
  check("booking pay-link created", !!link.url, true);
  const event = {
    type: "checkout.session.completed",
    data: { object: {
      id: "cs_test_1", amount_total: 1500, payment_intent: "pi_test",
      metadata: { type: "payspot", paylinkId: link.id, giftCode: "", giftAppliedCents: "0" },
    } },
  };
  const whReq = mockReq({ method: "POST", headers: { "stripe-signature": "sig" } });
  whReq[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(event)); };
  res = mockRes();
  await webhook(whReq, res);
  check("webhook -> 200", res.statusCode, 200);
  const afterPay = await bookingsLib.getBooking(payWalkIn.id);
  check("webhook adds to amountPaid", afterPay.amountPaidCents, 10000);
  check("webhook flips to paid", afterPay.status, "paid");

  // ---------- 12. public booking still works through the shared path ----------
  // (moveDay, not d2: d2 is a Sunday when the suite runs on a Friday.)
  res = mockRes();
  await book(mockReq({
    method: "POST", headers: {},
    body: { service: "classic-facial", type: "regular", date: moveDay, time: "1:00 PM", name: "Public Booker", phone: "(905) 555-0200", email: "public@example.com", first: "no" },
  }), res);
  check("public booking -> 200", res.statusCode, 200);
  check("public booking returns checkout url", res.body.url, "https://checkout.stripe.test/pay/cs_test_1");
  // The consultation books through the same shared path — $30 by card,
  // checkout link back, first-time client. (Skin Tightening, the old
  // custom-priced consultation, was removed Nov 19, 2026.)
  res = mockRes();
  await book(mockReq({
    method: "POST", headers: {},
    body: { service: "consultation", format: "video", type: "regular", date: d4, time: "10:00 AM", name: "Consult", phone: "(905) 555-0201", email: "consult@example.com", first: "no" },
  }), res);
  check("public consultation -> 200", res.statusCode, 200);
  check("public consultation returns checkout url", res.body.url, "https://checkout.stripe.test/pay/cs_test_1");

  // ---------- 13. settings round-trip via the admin path ----------
  res = await callAdmin({ view: "settings", action: "buffer", bufferMins: 75 });
  check("admin buffer save -> 200", res.statusCode, 200);
  check("admin buffer saved 75", res.body.bufferMins, 75);
  res = await callAdmin(null, { view: "settings" });
  check("admin settings read buffer 75", res.body.bufferMins, 75);
  await studio.setBufferMins(60);
  res = await callAdmin({ view: "settings", action: "block-add", date: d4, start: "09:00", end: "10:00", reason: "test" });
  check("admin block-add -> 200", res.statusCode, 200);
  check("admin block-add returns block", !!res.body.block.id, true);
  res = await callAdmin({ view: "settings", action: "block-remove", id: res.body.block.id });
  check("admin block-remove -> 200", res.statusCode, 200);
  res = await callAdmin({ view: "settings", action: "block-remove", id: "blk_nope" });
  check("admin block-remove unknown -> 404", res.statusCode, 404);

  // ---------- 14. pay-on-the-spot fallback: GET ?session_id= settles without the webhook ----------
  // The payment link Stripe creates points back at pay-paid.html with the
  // checkout session id, so the redirect page can settle the payment even
  // when the webhook never fires (Nov 17: zero webhook invocations).
  const spot = await bookingsLib.createPayLink({
    amountCents: 6500, clientName: "Spot Payer", contact: "spot@example.com",
    method: "email", serviceLabel: "Classic Facial",
  });
  check("payspot link created", !!spot.url, true);
  check("pay link redirects to pay-paid", /pay-paid\.html\?id=.+&session_id=\{CHECKOUT_SESSION_ID\}/.test(lastPaymentLinkArgs.after_completion.redirect.url), true);
  // Unpaid session -> not paid, nothing recorded.
  retrieveOverride = { id: "cs_spot_unpaid", payment_status: "unpaid", amount_total: 6500, payment_intent: "pi_spot", metadata: { type: "payspot", paylinkId: spot.id, giftCode: "", giftAppliedCents: "0" } };
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_spot_unpaid" } }), res);
  check("unpaid session -> paid false", res.body.paid, false);
  check("unpaid session -> record still unpaid", (await bookingsLib.listPayments()).filter((p) => p.paylinkId === spot.id).length, 0);
  // Paid session -> settles, records the payment once.
  retrieveOverride = { id: "cs_spot_paid", payment_status: "paid", amount_total: 6500, payment_intent: "pi_spot", metadata: { type: "payspot", paylinkId: spot.id, giftCode: "", giftAppliedCents: "0" } };
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_spot_paid" } }), res);
  check("paid session -> 200", res.statusCode, 200);
  check("paid session -> paid true", res.body.paid, true);
  check("paid session -> amount", res.body.amountCents, 6500);
  check("paid session -> service", res.body.serviceLabel, "Classic Facial");
  check("one payment recorded", (await bookingsLib.listPayments()).filter((p) => p.paylinkId === spot.id).length, 1);
  // Same session again -> idempotent: no second payment.
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_spot_paid" } }), res);
  check("replay -> still paid", res.body.paid, true);
  check("replay -> still one payment", (await bookingsLib.listPayments()).filter((p) => p.paylinkId === spot.id).length, 1);
  // Booking-linked link: the settle lands on the booking once, and a
  // webhook arriving afterwards for the same session adds nothing.
  const spot2 = await bookingsLib.createPayLink({
    amountCents: 1500, clientName: "Walk In", contact: "walkin@example.com",
    method: "email", serviceLabel: "Classic Facial — balance", bookingId: payWalkIn.id,
  });
  retrieveOverride = { id: "cs_spot_bk", payment_status: "paid", amount_total: 1500, payment_intent: "pi_spot2", metadata: { type: "payspot", paylinkId: spot2.id, giftCode: "", giftAppliedCents: "0" } };
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_spot_bk" } }), res);
  check("booking link settles -> paid", res.body.paid, true);
  check("booking amount adds once", (await bookingsLib.getBooking(payWalkIn.id)).amountPaidCents, 11500);
  const whEvent2 = { type: "checkout.session.completed", data: { object: { id: "cs_spot_bk", amount_total: 1500, payment_intent: "pi_spot2", metadata: { type: "payspot", paylinkId: spot2.id, giftCode: "", giftAppliedCents: "0" } } } };
  const whReq2 = mockReq({ method: "POST", headers: { "stripe-signature": "sig" } });
  whReq2[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(whEvent2)); };
  res = mockRes();
  await webhook(whReq2, res);
  check("webhook after GET -> 200", res.statusCode, 200);
  check("webhook replay adds nothing", (await bookingsLib.getBooking(payWalkIn.id)).amountPaidCents, 11500);
  // Wrong session type -> 400, unknown link -> 404.
  retrieveOverride = { id: "cs_wrong", payment_status: "paid", amount_total: 6500, payment_intent: "pi_x", metadata: { type: "booking", bookingId: "bk_x" } };
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_wrong" } }), res);
  check("non-payspot session -> 400", res.statusCode, 400);
  retrieveOverride = { id: "cs_ghost", payment_status: "paid", amount_total: 6500, payment_intent: "pi_x", metadata: { type: "payspot", paylinkId: "pl_nope" } };
  res = mockRes();
  await payHandler(mockReq({ method: "GET", query: { session_id: "cs_ghost" } }), res);
  check("unknown paylink -> 404", res.statusCode, 404);
  retrieveOverride = null;

  // ---------- 15. gift code delete ----------
  const delGift = await bookingsLib.ensureGiftCode(voucherSession("cs_admin_del", "Classic Facial — $65", 6500, "gift"));
  check("codes lists the new gift", (await bookingsLib.listGifts()).some((g) => g.code === delGift.code), true);
  res = await callAdmin({ view: "codes", action: "delete", code: delGift.code });
  check("delete code -> 200", res.statusCode, 200);
  check("gift gone after delete", await bookingsLib.getGift(delGift.code), null);
  check("gift off the index after delete", (await bookingsLib.listGifts()).some((g) => g.code === delGift.code), false);
  res = await callAdmin({ view: "codes", action: "delete", code: delGift.code });
  check("delete missing code -> 404", res.statusCode, 404);
  res = await callAdmin({ view: "codes", action: "delete", code: "NOPE-0000" });
  check("delete bad code -> 404", res.statusCode, 404);

  // ---------- 16. finish check (Tony Nov 19, 2026) ----------
  const fcBooking = {
    id: "bk_finish_test",
    date: torontoToday(),
    time: "10:00 AM",
    service: "classic-facial",
    serviceName: "Classic Facial",
    serviceLabel: "Classic Facial",
    status: "paid",
    name: "Finish Test",
    phone: "(905) 555-0999",
    email: "finish@test.example",
    addons: [],
    createdAt: new Date().toISOString(),
  };
  await bookingsLib.saveBooking(fcBooking);
  let fcRes = await callAdmin({ view: "finish-check", action: "notify", bookingId: "bk_finish_test" });
  check("finish-check notify -> 200", fcRes.statusCode, 200);
  check("finish-check notify fires once", fcRes.body.notified, true);
  fcRes = await callAdmin({ view: "finish-check", action: "notify", bookingId: "bk_finish_test" });
  check("finish-check notify twice -> not re-sent", fcRes.body.notified, false);
  fcRes = await callAdmin({ view: "finish-check", action: "snooze", bookingId: "bk_finish_test" });
  check("finish-check snooze -> 200", fcRes.statusCode, 200);
  const snoozed = await bookingsLib.getBooking("bk_finish_test");
  check("snooze sets a future time", Date.parse(snoozed.finishSnoozedUntil) > Date.now(), true);
  fcRes = await callAdmin({ view: "finish-check", action: "done", bookingId: "bk_finish_test" });
  check("finish-check done -> 200", fcRes.statusCode, 200);
  const doneFc = await bookingsLib.getBooking("bk_finish_test");
  check("done sets finishedAt", !!doneFc.finishedAt, true);
  check("done sets actualEndMin", Number.isFinite(doneFc.actualEndMin), true);
  fcRes = await callAdmin({ view: "finish-check", action: "done", bookingId: "bk_finish_test" });
  check("finish-check done twice -> 404", fcRes.statusCode, 404);
  fcRes = await callAdmin({ view: "finish-check", action: "notify", bookingId: "bk_nope" });
  check("finish-check notify unknown -> not sent", fcRes.body.notified, false);

  // ---------- 17. delete booking (Tony Nov 19, 2026) ----------
  const delBooking = {
    id: "bk_delete_test",
    date: d2,
    time: "1:00 PM",
    service: "classic-facial",
    serviceName: "Classic Facial",
    status: "cancelled",
    name: "Delete Test",
    phone: "(905) 555-0998",
    email: "delete@test.example",
    addons: [],
    createdAt: new Date().toISOString(),
  };
  await bookingsLib.saveBooking(delBooking);
  check("delete target saved", !!(await bookingsLib.getBooking("bk_delete_test")), true);
  check("delete target in day index", (await bookingsLib.listBookingsForDate(d2)).some((b) => b.id === "bk_delete_test"), true);
  let delRes = await callAdmin({ view: "bookings", action: "delete", bookingId: "bk_delete_test" });
  check("delete booking -> 200", delRes.statusCode, 200);
  check("deleted booking is gone", (await bookingsLib.getBooking("bk_delete_test")), null);
  check("deleted booking out of day index", (await bookingsLib.listBookingsForDate(d2)).some((b) => b.id === "bk_delete_test"), false);
  delRes = await callAdmin({ view: "bookings", action: "delete", bookingId: "bk_delete_test" });
  check("delete twice -> 404", delRes.statusCode, 404);
  delRes = await callAdmin({ view: "bookings", action: "delete", bookingId: "bk_nope" });
  check("delete unknown -> 404", delRes.statusCode, 404);

  // ---------- 18. backup-before-delete + payments delete (Tony Nov 19, 2026) ----------
  // Payments, gift codes, and referrals are archived BEFORE they are
  // deleted — the archive rides in every backup download + weekly email.
  // Bookings and caller messages delete with no archive.
  const backupBefore = await callAdmin(null, { view: "backup" });
  check("backup export -> 200", backupBefore.statusCode, 200);
  const archivedBefore = (backupBefore.body.counts || {}).deleted || 0;
  // A pay-on-the-spot payment (standalone) + a booking-linked one.
  const paySpotTest = { id: "pay_del_test", kind: "pay-spot", amountCents: 5000, clientName: "Pay Test", serviceLabel: "Classic Facial", method: "cash", createdAt: new Date().toISOString() };
  await bookingsLib.recordPayment(paySpotTest);
  const payLinkedTest = { id: "pay_linked_test", kind: "booking", bookingId: "bk_linked_test", amountCents: 8500, clientName: "Linked Test", serviceLabel: "Classic Facial", method: "cash", createdAt: new Date().toISOString() };
  await bookingsLib.recordPayment(payLinkedTest);
  const refRes = await callAdmin({ view: "referrals", action: "create", name: "Ref Del", email: "refdel@test.example", phone: "9055550123" });
  check("referral create -> 200", refRes.statusCode, 200);
  const refCode = refRes.body.referral.code;
  const delGift2 = await bookingsLib.ensureGiftCode(voucherSession("cs_admin_del2", "Classic Facial — $65", 6500, "gift"));
  const msgTest = await messagesLib.saveMessage({ name: "Msg Del", phone: "9055550111", reason: "test message", callId: "call_del" });
  let payRes = await callAdmin({ view: "payments", action: "delete", paymentId: "pay_del_test" });
  check("delete pay-spot payment -> 200", payRes.statusCode, 200);
  check("pay-spot payment gone", await bookingsLib.getPayment("pay_del_test"), null);
  payRes = await callAdmin({ view: "payments", action: "delete", paymentId: "pay_linked_test" });
  check("delete booking-linked payment -> 400", payRes.statusCode, 400);
  check("booking-linked payment kept", !!(await bookingsLib.getPayment("pay_linked_test")), true);
  payRes = await callAdmin({ view: "payments", action: "delete", paymentId: "pay_nope" });
  check("delete unknown payment -> 404", payRes.statusCode, 404);
  let arcRes = await callAdmin({ view: "referrals", action: "delete", code: refCode });
  check("delete referral -> 200", arcRes.statusCode, 200);
  check("referral gone after delete", await referralsLib.getReferralByCode(refCode), null);
  arcRes = await callAdmin({ view: "codes", action: "delete", code: delGift2.code });
  check("delete gift -> 200", arcRes.statusCode, 200);
  check("gift gone after delete", await bookingsLib.getGift(delGift2.code), null);
  arcRes = await callAdmin({ view: "messages", action: "delete", id: msgTest.id });
  check("delete message -> 200", arcRes.statusCode, 200);
  check("message gone after delete", (await messagesLib.listMessages()).some((m) => m.id === msgTest.id), false);
  const backupAfter = await callAdmin(null, { view: "backup" });
  const deleted = backupAfter.body.deleted || [];
  const types = deleted.map((d) => d.type);
  check("archive grew by exactly 3 (payment + referral + gift)", (backupAfter.body.counts || {}).deleted, archivedBefore + 3);
  check("archive has the payment", deleted.some((d) => d.type === "payment" && d.record && d.record.id === "pay_del_test"), true);
  check("archived payment keeps its amount", (deleted.find((d) => d.type === "payment" && d.record && d.record.id === "pay_del_test") || { record: {} }).record.amountCents, 5000);
  check("archive has the referral", deleted.some((d) => d.type === "referral" && d.record && d.record.code === refCode), true);
  check("archive has the gift", deleted.some((d) => d.type === "gift" && d.record && d.record.code === delGift2.code), true);
  check("archive has no booking entries", types.includes("booking"), false);
  check("archive has no message entries", types.includes("message"), false);

  // ---------- 19. monthly backup + delete gate (Tony Nov 19, 2026) ----------
  // Nothing can be deleted until the first monthly backup email has gone
  // out. Remove the flag: every delete is refused (503) and nothing is
  // removed. Send-monthly without an email key reports emailed:false and
  // leaves the flag unset. Set the flag: deletes open again.
  const gatePay = { id: "pay_gate_test", kind: "pay-spot", amountCents: 2500, clientName: "Gate Test", serviceLabel: "Classic Facial", method: "cash", createdAt: new Date().toISOString() };
  await bookingsLib.recordPayment(gatePay);
  const gateRefRes = await callAdmin({ view: "referrals", action: "create", name: "Gate Ref", email: "gateref@test.example", phone: "9055550133" });
  const gateRefCode = gateRefRes.body.referral.code;
  const gateGift = await bookingsLib.ensureGiftCode(voucherSession("cs_admin_gate", "Classic Facial — $65", 6500, "gift"));
  const gateMsg = await messagesLib.saveMessage({ name: "Gate Msg", phone: "9055550112", reason: "gate test", callId: "call_gate" });
  const gateBooking = { id: "bk_gate_test", date: d2, time: "2:00 PM", service: "classic-facial", serviceName: "Classic Facial", status: "cancelled", name: "Gate Test", phone: "(905) 555-0997", email: "gate@test.example", addons: [], createdAt: new Date().toISOString() };
  await bookingsLib.saveBooking(gateBooking);
  mem.delete("backup:lastMonthly");
  let gateRes = await callAdmin({ view: "payments", action: "delete", paymentId: "pay_gate_test" });
  check("gate: payment delete -> 503", gateRes.statusCode, 503);
  check("gate: payment delete names the monthly backup", /Monthly backup/.test(gateRes.body.error || ""), true);
  check("gate: payment kept", !!(await bookingsLib.getPayment("pay_gate_test")), true);
  gateRes = await callAdmin({ view: "referrals", action: "delete", code: gateRefCode });
  check("gate: referral delete -> 503", gateRes.statusCode, 503);
  check("gate: referral kept", !!(await referralsLib.getReferralByCode(gateRefCode)), true);
  gateRes = await callAdmin({ view: "codes", action: "delete", code: gateGift.code });
  check("gate: gift delete -> 503", gateRes.statusCode, 503);
  check("gate: gift kept", !!(await bookingsLib.getGift(gateGift.code)), true);
  gateRes = await callAdmin({ view: "messages", action: "delete", id: gateMsg.id });
  check("gate: message delete -> 503", gateRes.statusCode, 503);
  check("gate: message kept", (await messagesLib.listMessages()).some((m) => m.id === gateMsg.id), true);
  gateRes = await callAdmin({ view: "bookings", action: "delete", bookingId: "bk_gate_test" });
  check("gate: booking delete -> 503", gateRes.statusCode, 503);
  check("gate: booking kept", !!(await bookingsLib.getBooking("bk_gate_test")), true);
  const statusBefore = await callAdmin(null, { view: "backup", status: "1" });
  check("backup status -> monthlyActive false", statusBefore.body.monthlyActive, false);
  gateRes = await callAdmin({ view: "backup", action: "send-monthly" });
  check("send-monthly -> 200", gateRes.statusCode, 200);
  check("send-monthly without email key -> emailed false", gateRes.body.emailed, false);
  check("send-monthly without email -> flag still unset", mem.get("backup:lastMonthly"), undefined);
  mem.set("backup:lastMonthly", new Date().toISOString());
  const statusAfter = await callAdmin(null, { view: "backup", status: "1" });
  check("backup status -> monthlyActive true", statusAfter.body.monthlyActive, true);
  gateRes = await callAdmin({ view: "payments", action: "delete", paymentId: "pay_gate_test" });
  check("gate open: payment delete -> 200", gateRes.statusCode, 200);
  gateRes = await callAdmin({ view: "referrals", action: "delete", code: gateRefCode });
  check("gate open: referral delete -> 200", gateRes.statusCode, 200);
  gateRes = await callAdmin({ view: "codes", action: "delete", code: gateGift.code });
  check("gate open: gift delete -> 200", gateRes.statusCode, 200);
  gateRes = await callAdmin({ view: "messages", action: "delete", id: gateMsg.id });
  check("gate open: message delete -> 200", gateRes.statusCode, 200);
  gateRes = await callAdmin({ view: "bookings", action: "delete", bookingId: "bk_gate_test" });
  check("gate open: booking delete -> 200", gateRes.statusCode, 200);
  const vercel = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vercel.json"), "utf8"));
  check("vercel has a weekly backup cron", (vercel.crons || []).some((c) => c.schedule === "0 13 * * 1" && (c.path || "").includes("view=backup")), true);
  check("vercel has a monthly backup cron on the 1st", (vercel.crons || []).some((c) => c.schedule === "0 13 1 * *" && (c.path || "").includes("period=monthly")), true);

  console.log(`admin tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error("FAIL:", err); process.exit(1); });
