// Admin dashboard tests — cancel / move / blocks / buffer / walk-in /
// payments / email / reports / agentMode / caller messages / webhook
// pay-link-to-booking / payspot GET fallback (settle without the webhook).
// Run: node scripts/test-admin.js
// Uses an in-memory KV stub + stubbed auth/Stripe (no Stripe/KV/Resend needed).
const assert = require("assert");

// --- in-memory KV, stubbed before any lib loads ---
const mem = new Map();
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
  check("buffer default is 30", await studio.getBufferMins(), 30);
  check("buffer set to 15", await studio.setBufferMins(15), 15);
  check("buffer reads back 15", await studio.getBufferMins(), 15);
  let threw = false;
  try { await studio.setBufferMins(999); } catch { threw = true; }
  check("buffer 999 rejected", threw, true);
  threw = false;
  try { await studio.setBufferMins("abc"); } catch { threw = true; }
  check("buffer non-number rejected", threw, true);
  const classic9 = [{ time: "9:00 AM", service: "classic-facial", status: "paid", createdAt: new Date().toISOString() }];
  check("30-min buffer blocks 10:15 add-on", sched.slotTaken(classic9, sched.parseTime("10:15 AM"), 15, { bufferMins: 30 }), true);
  check("15-min buffer frees 10:15 add-on", sched.slotTaken(classic9, sched.parseTime("10:15 AM"), 15, { bufferMins: 15 }), false);
  check("slotTaken defaults to 30 when no opts", sched.slotTaken(classic9, sched.parseTime("10:15 AM"), 15), true);
  await studio.setBufferMins(30);

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
  check("12:30 PM blocked", freeWithBlock.includes("12:30 PM"), false);
  check("11:00 AM still free", freeWithBlock.includes("11:00 AM"), true);
  check("1:30 PM free after block", freeWithBlock.includes("1:30 PM"), true);
  let res = mockRes();
  await availability(mockReq({ query: { date: d4, service: "classic-facial", type: "regular" } }), res);
  check("availability hides blocked 12:30", res.body.times.includes("12:30 PM"), false);
  check("availability keeps 11:00", res.body.times.includes("11:00 AM"), true);
  check("block removed", await studio.removeBlock(block.id), true);
  check("block gone", (await studio.blocksForDate(d4)).length, 0);
  res = mockRes();
  await availability(mockReq({ query: { date: d4, service: "classic-facial", type: "regular" } }), res);
  check("availability shows 12:30 after removal", res.body.times.includes("12:30 PM"), true);

  // ---------- 2b. availability range mode (date-grid statuses) ----------
  const d5 = addDays(today, 5);
  const d6 = addDays(today, 6);
  const d7 = addDays(today, 7);
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: d7, service: "classic-facial" } }), res);
  check("range -> 200", res.statusCode, 200);
  check("range covers 3 days", Object.keys(res.body.dates || {}).length, 3);
  check("range d5 regular total 9", res.body.dates[d5].regular.total, 9);
  check("range d5 regular free 9 (empty)", res.body.dates[d5].regular.free, 9);
  check("range d5 after total matches schedule", res.body.dates[d5].after.total, sched.timesFor(d5, "after").length);
  check("range d5 after free all (empty)", res.body.dates[d5].after.free, res.body.dates[d5].after.total);
  check("range d7 regular free 9 (empty)", res.body.dates[d7].regular.free, 9);
  const block2 = await studio.addBlock({ date: d6, start: "12:00", end: "13:00", reason: "Range test" });
  res = mockRes();
  await availability(mockReq({ query: { from: d5, to: d7, service: "classic-facial" } }), res);
  check("range d6 regular free 8 with block", res.body.dates[d6].regular.free, 8);
  check("range d6 regular total still 9", res.body.dates[d6].regular.total, 9);
  check("range d6 after free all (block misses private)", res.body.dates[d6].after.free, res.body.dates[d6].after.total);
  check("range d5 still free 9 with d6 blocked", res.body.dates[d5].regular.free, 9);
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
    service: "classic-facial", type: "regular", date: d1, time: "9:00 AM",
    name: "Walk In", phone: "(905) 555-0101", email: "walkin@example.com",
    first: "no", payment: "cash",
  });
  check("walk-in cash -> 200", res.statusCode, 200);
  const walkIn = res.body.booking;
  check("walk-in paid", walkIn.status, "paid");
  check("walk-in amount $65", walkIn.amountCents, 6500);
  check("walk-in paid in full", walkIn.amountPaidCents, 6500);
  check("walk-in balance $0", walkIn.balanceDueCents, 0);
  check("walk-in via admin", walkIn.via, "admin");
  check("walk-in got a referral code", !!walkIn.myReferralCode, true);

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "classic-facial", type: "regular", date: d1, time: "11:00 AM",
    name: "Pay Later", phone: "(905) 555-0102", email: "later@example.com",
    first: "no", payment: "later",
  });
  check("walk-in later -> 200", res.statusCode, 200);
  const laterBk = res.body.booking;
  check("walk-in later status unpaid", laterBk.status, "unpaid");
  check("walk-in later balance $65", laterBk.balanceDueCents, 6500);

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "anti-aging-facial", type: "regular", date: d1, time: "2:30 PM",
    name: "Pay Link", phone: "(905) 555-0103", email: "paylink@example.com",
    first: "no", payment: "pay-link",
  });
  check("walk-in pay-link -> 200", res.statusCode, 200);
  check("walk-in pay-link status pending", res.body.booking.status, "pending");
  check("walk-in pay-link has checkout url", res.body.checkoutUrl, "https://checkout.stripe.test/pay/cs_test_1");

  res = await callAdmin({
    view: "bookings", action: "walk-in",
    service: "classic-facial", type: "regular", date: d1, time: "9:00 AM",
    name: "Double", phone: "(905) 555-0104", email: "double@example.com",
    first: "no", payment: "cash",
  });
  check("walk-in double-booked slot -> 409", res.statusCode, 409);

  // ---------- 4. cancel (voucher + plain gift restore, slot frees) ----------
  const gift = await bookingsLib.ensureGiftCode(voucherSession("cs_admin_v1", "Classic Facial — $65", 6500));
  const bkV = {
    id: "bk-admin-v1", status: "paid", forWhom: "me", name: "Sam Friend",
    email: "sam@example.com", phone: "(905) 555-0505",
    service: "classic-facial", serviceName: "Classic Facial", date: d2, time: "9:00 AM",
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
  check("cancel frees the slot", sched.slotTaken(await bookingsLib.listBookingsForDate(d2), sched.parseTime("9:00 AM"), 55), false);
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
  // d1 now: walk-in Classic 9:00 (paid), later Classic 11:00 (unpaid), Anti 2:30 (pending).
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "10:00 AM", type: "regular" });
  check("move into a blocked slot -> 409", res.statusCode, 409);
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "4:30 PM", type: "regular" });
  check("move to a free slot -> 200", res.statusCode, 200);
  check("moved time", res.body.booking.time, "4:30 PM");
  const day1 = await bookingsLib.listBookingsForDate(d1);
  check("moved booking shows at new time", day1.some((b) => b.id === walkIn.id && b.time === "4:30 PM"), true);
  check("old slot free after move", sched.slotTaken(day1, sched.parseTime("9:00 AM"), 55), false);
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "7:00 PM", type: "after" });
  check("move regular -> Private Hours -> 200", res.statusCode, 200);
  check("Private Hours adds $15", res.body.booking.amountCents, 8000);
  check("balance due $15 after move", res.body.booking.balanceDueCents, 1500);
  // Blocked time blocks a move.
  const blk2 = await studio.addBlock({ date: d1, start: "12:00", end: "13:00", reason: "lunch" });
  res = await callAdmin({ view: "bookings", action: "move", bookingId: walkIn.id, date: d1, time: "12:30 PM", type: "regular" });
  check("move into a blocked time -> 409", res.statusCode, 409);
  await studio.removeBlock(blk2.id);
  res = await callAdmin({ view: "bookings", action: "move", bookingId: "bk-admin-v1", date: d1, time: "9:00 AM", type: "regular" });
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
  check("reports client paid total", walkClient ? walkClient.totalPaidCents : 0, 6500);

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
  check("webhook adds to amountPaid", afterPay.amountPaidCents, 8000);
  check("webhook flips to paid", afterPay.status, "paid");

  // ---------- 12. public booking still works through the shared path ----------
  res = mockRes();
  await book(mockReq({
    method: "POST", headers: {},
    body: { service: "classic-facial", type: "regular", date: d2, time: "9:00 AM", name: "Public Booker", phone: "(905) 555-0200", email: "public@example.com", first: "no" },
  }), res);
  check("public booking -> 200", res.statusCode, 200);
  check("public booking returns checkout url", res.body.url, "https://checkout.stripe.test/pay/cs_test_1");
  res = mockRes();
  await book(mockReq({
    method: "POST", headers: {},
    body: { service: "microneedling", type: "regular", date: d3, time: "9:00 AM", name: "Consult", phone: "(905) 555-0201", email: "consult@example.com", first: "no" },
  }), res);
  check("public consultation -> 200", res.statusCode, 200);
  check("consultation paid immediately", res.body.paid, true);
  check("consultation flagged", res.body.consultation, true);

  // ---------- 13. settings round-trip via the admin path ----------
  res = await callAdmin({ view: "settings", action: "buffer", bufferMins: 45 });
  check("admin buffer save -> 200", res.statusCode, 200);
  check("admin buffer saved 45", res.body.bufferMins, 45);
  res = await callAdmin(null, { view: "settings" });
  check("admin settings read buffer 45", res.body.bufferMins, 45);
  await studio.setBufferMins(30);
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
  check("booking amount adds once", (await bookingsLib.getBooking(payWalkIn.id)).amountPaidCents, 9500);
  const whEvent2 = { type: "checkout.session.completed", data: { object: { id: "cs_spot_bk", amount_total: 1500, payment_intent: "pi_spot2", metadata: { type: "payspot", paylinkId: spot2.id, giftCode: "", giftAppliedCents: "0" } } } };
  const whReq2 = mockReq({ method: "POST", headers: { "stripe-signature": "sig" } });
  whReq2[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(whEvent2)); };
  res = mockRes();
  await webhook(whReq2, res);
  check("webhook after GET -> 200", res.statusCode, 200);
  check("webhook replay adds nothing", (await bookingsLib.getBooking(payWalkIn.id)).amountPaidCents, 9500);
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

  console.log(`admin tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error("FAIL:", err); process.exit(1); });
