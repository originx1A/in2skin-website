// Agent lookup/move/cancel tests — Retell tools on POST /api/book.
// Run: node scripts/test-agent-actions.js
// Uses an in-memory KV stub + stubbed email (no Stripe/KV/Resend needed).
// Also confirms the gift-balance read (GET /api/gift?code=...) still works.
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
// --- Email stub: capture sent mail ---
const sentEmails = [];
const emailPath = require.resolve("../lib/email");
require.cache[emailPath] = {
  exports: {
    sendEmail: async (args) => { sentEmails.push(args); return true; },
    FROM: "In2Skin <bookings@boltonfacials.com>",
  },
};
// --- Stripe stub: these paths never call Stripe, but api/book requires it ---
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: { getStripe: () => { throw new Error("stripe must not be called here"); } },
};

process.env.AGENT_API_KEY = "test-agent-key";

const book = require("../api/book");
const giftApi = require("../api/gift");
const { saveBooking, getGift } = require("../lib/bookings");
const { torontoDateKey } = require("../lib/transfer");
const { dateKey } = require("../lib/schedule");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
const agentReq = (body) => ({ method: "POST", headers: { "x-agent-key": "test-agent-key" }, body });
const noKeyReq = (body) => ({ method: "POST", headers: {}, body });
const wrongKeyReq = (body) => ({ method: "POST", headers: { "x-agent-key": "wrong" }, body });

function dayKey(offset) {
  const t = new Date(torontoDateKey() + "T00:00:00");
  t.setDate(t.getDate() + offset);
  return dateKey(t);
}

// Next open day at-or-after today+offset (Sundays are closed).
function openDay(offset) {
  const t = new Date(torontoDateKey() + "T00:00:00");
  t.setDate(t.getDate() + offset);
  while (t.getDay() === 0) t.setDate(t.getDate() + 1);
  return dateKey(t);
}

let n = 0;
async function seedBooking(overrides) {
  n += 1;
  const base = {
    id: `bk_test_${n}`,
    service: "classic-facial",
    serviceName: "Classic Facial",
    serviceLabel: "Classic Facial",
    format: null,
    addons: [],
    addonNames: [],
    date: dayKey(5),
    time: "1:00 PM",
    type: "regular",
    forWhom: "me",
    name: "Test Caller",
    phone: "416-555-0101",
    email: "caller@example.com",
    guestName: null,
    guestPhone: null,
    guestEmail: null,
    firstVisitDiscountCents: 0,
    giftCode: null,
    giftAppliedCents: 0,
    giftKind: null,
    giftDeducted: false,
    referralCode: null,
    referralAppliedCents: 0,
    referralDeducted: false,
    freeReflexologyApplied: false,
    freeReflexologyDeducted: false,
    referredBy: null,
    myReferralCode: "TEST-AB12",
    amountCents: 8500,
    payMode: "full",
    depositCents: 8500,
    amountPaidCents: 8500,
    status: "paid",
    via: "web",
    origin: "https://www.boltonfacials.com",
    emailSent: false,
    createdAt: new Date().toISOString(),
  };
  const booking = { ...base, ...overrides };
  await saveBooking(booking);
  return booking;
}

async function call(body, reqFn = agentReq) {
  const res = mockRes();
  await book(reqFn(body), res);
  return res;
}

async function run() {
  const D5 = openDay(5);
  const D6 = openDay(6);
  const D7 = openDay(7);

  // Seed: caller 1 has two upcoming bookings (D5 1:00 PM, D6 2:00 PM with
  // a gift applied), one cancelled booking and one past booking (both must
  // stay out of lookup). Caller 2 has one booking. A friend booked a
  // treatment FOR caller 1 (guest phone/email match).
  const bkA = await seedBooking({ date: D5, time: "1:00 PM" });
  const bkB = await seedBooking({ id: "bk_test_b", name: "Other Person", phone: "647-555-0202", email: "other@example.com", myReferralCode: "TEST-CD34", date: D5, time: "9:00 AM" });
  const bkGift = await seedBooking({
    id: "bk_test_gift", date: D6, time: "2:00 PM",
    giftCode: "IN2-ABCD", giftAppliedCents: 6500, giftKind: "gift", giftDeducted: true,
    amountCents: 2000, depositCents: 2000, amountPaidCents: 2000,
  });
  await seedBooking({ id: "bk_test_cancelled", date: D5, time: "3:00 PM", status: "cancelled" });
  await seedBooking({ id: "bk_test_past", date: dayKey(-2), time: "10:00 AM" });
  await seedBooking({
    id: "bk_test_friend", date: D7, time: "10:00 AM",
    name: "Friend Buyer", phone: "647-555-0202", email: "friend@example.com",
    forWhom: "friend", guestName: "Test Caller", guestPhone: "416-555-0101", guestEmail: "caller@example.com",
  });
  mem.set("gift:IN2-ABCD", {
    code: "IN2-ABCD", kind: "gift", balanceCents: 2000, originalCents: 8500,
    recipientName: "Test Caller", recipientEmail: "caller@example.com",
    holderName: "Test Caller", holderEmail: "caller@example.com",
    uses: [], status: "active", createdAt: new Date().toISOString(), expiresAt: null,
  });
  mem.set("gift:IN2-WXYZ", {
    code: "IN2-WXYZ", kind: "gift", balanceCents: 5000, originalCents: 8500,
    recipientName: "Test Caller", recipientEmail: "caller@example.com",
    holderName: "Test Caller", holderEmail: "caller@example.com",
    uses: [], status: "active", createdAt: new Date().toISOString(), expiresAt: null,
  });

  // --- Auth: key not set -> 503; wrong key -> 401, for every action ---
  delete process.env.AGENT_API_KEY;
  for (const action of ["lookup", "move", "cancel"]) {
    const res = await call({ via: "agent", action, bookingId: bkA.id }, noKeyReq);
    assert.equal(res.statusCode, 503, `${action} without key set -> 503, got ${res.statusCode}`);
  }
  process.env.AGENT_API_KEY = "test-agent-key";
  for (const action of ["lookup", "move", "cancel"]) {
    const res = await call({ via: "agent", action, bookingId: bkA.id }, wrongKeyReq);
    assert.equal(res.statusCode, 401, `${action} with wrong key -> 401, got ${res.statusCode}`);
  }

  // --- Lookup: no identifier -> 400 ---
  let res = await call({ via: "agent", action: "lookup" });
  assert.equal(res.statusCode, 400, "lookup without phone/email -> 400");

  // --- Lookup: unknown phone -> empty list ---
  res = await call({ via: "agent", action: "lookup", phone: "999-555-0000" });
  assert.equal(res.statusCode, 200, "unknown phone -> 200");
  assert.deepEqual(res.body.bookings, [], "unknown phone -> empty bookings");

  // --- Lookup by phone: only caller 1's upcoming bookings ---
  res = await call({ via: "agent", action: "lookup", phone: "(416) 555-0101" });
  assert.equal(res.statusCode, 200, "lookup by phone -> 200");
  const ids = res.body.bookings.map((x) => x.bookingId).sort();
  assert.deepEqual(ids, [bkA.id, bkGift.id, "bk_test_friend"].sort(),
    "lookup returns caller 1's upcoming bookings only (not caller 2's, not cancelled, not past), got " + JSON.stringify(ids));
  const first = res.body.bookings.find((x) => x.bookingId === bkA.id);
  assert.equal(first.serviceName, "Classic Facial");
  assert.equal(first.date, D5);
  assert.equal(first.time, "1:00 PM");
  assert.equal(first.status, "paid");
  assert.equal(first.amountPaidCents, 8500);
  assert.equal(first.myReferralCode, "TEST-AB12");
  assert.ok(!("phone" in first) && !("email" in first), "summary carries no contact details");
  assert.ok(!JSON.stringify(res.body).match(/Madsen|Bolton.*(St|Rd|Ave)|lawsuit/i), "summary carries no private details");

  // --- Lookup by email (case-insensitive) -> same set ---
  res = await call({ via: "agent", action: "lookup", email: "CALLER@EXAMPLE.COM" });
  assert.deepEqual(res.body.bookings.map((x) => x.bookingId).sort(), ids, "lookup by email matches lookup by phone");

  // --- Lookup by guest phone alone -> the friend booking only ---
  res = await call({ via: "agent", action: "lookup", phone: "416-555-0101", email: "nobody@example.com" });
  assert.ok(res.body.bookings.some((x) => x.bookingId === "bk_test_friend"), "guest phone matches the friend booking");

  // --- Move: to a taken slot -> 409 naming the time is taken ---
  res = await call({ via: "agent", action: "move", bookingId: bkA.id, date: D5, time: "10:30 AM" });
  assert.equal(res.statusCode, 409, "move onto 9:00 AM booking (occupied until 10:55) -> 409, got " + res.statusCode);
  assert.match(res.body.error, /just taken/, "409 names the time as taken");

  // --- Move: yesterday / beyond 60 days / Private Hours -> 400 ---
  res = await call({ via: "agent", action: "move", bookingId: bkA.id, date: dayKey(-1), time: "11:00 AM" });
  assert.equal(res.statusCode, 400, "move to yesterday -> 400");
  res = await call({ via: "agent", action: "move", bookingId: bkA.id, date: dayKey(61), time: "11:00 AM" });
  assert.equal(res.statusCode, 400, "move beyond 60 days -> 400");
  res = await call({ via: "agent", action: "move", bookingId: bkA.id, date: D5, time: "7:00 PM", type: "after" });
  assert.equal(res.statusCode, 400, "move to Private Hours -> 400");
  assert.match(res.body.error, /by request/, "Private Hours move says to take a message");

  // --- Move: unknown booking -> 404; cancelled booking -> 400 ---
  res = await call({ via: "agent", action: "move", bookingId: "bk_nope", date: D5, time: "11:00 AM" });
  assert.equal(res.statusCode, 404, "move unknown booking -> 404");
  res = await call({ via: "agent", action: "move", bookingId: "bk_test_cancelled", date: D5, time: "11:00 AM" });
  assert.equal(res.statusCode, 400, "move cancelled booking -> 400");

  // --- Move: to a free slot -> 200, and the old slot frees up ---
  res = await call({ via: "agent", action: "move", bookingId: bkA.id, date: D5, time: "11:00 AM" });
  assert.equal(res.statusCode, 200, "move to free slot -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.booking.date, D5);
  assert.equal(res.body.booking.time, "11:00 AM");
  assert.equal(res.body.booking.status, "paid");
  assert.equal(res.body.emailed, true, "move sends the move email");
  res = await call({ via: "agent", action: "move", bookingId: bkB.id, date: D5, time: "1:00 PM" });
  assert.equal(res.statusCode, 200, "the vacated 1:00 PM slot is free again -> 200");

  // --- Cancel: unknown -> 404; the gift booking cancels and restores ---
  res = await call({ via: "agent", action: "cancel", bookingId: "bk_nope" });
  assert.equal(res.statusCode, 404, "cancel unknown booking -> 404");
  res = await call({ via: "agent", action: "cancel", bookingId: bkGift.id, reason: "caller changed plans" });
  assert.equal(res.statusCode, 200, "cancel -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "cancelled");
  assert.equal(res.body.emailed, true, "cancel sends the cancellation email");
  const giftAfter = await getGift("IN2-ABCD");
  assert.equal(giftAfter.balanceCents, 8500, "cancel restores the gift balance (2000 + 6500), got " + giftAfter.balanceCents);
  res = await call({ via: "agent", action: "move", bookingId: bkB.id, date: D6, time: "2:00 PM" });
  assert.equal(res.statusCode, 200, "the cancelled booking's slot is free again -> 200");
  res = await call({ via: "agent", action: "cancel", bookingId: bkGift.id });
  assert.equal(res.statusCode, 400, "cancel an already-cancelled booking -> 400");

  // --- Gift balance (already existing, GET /api/gift?code=...) ---
  const giftRes = mockRes();
  await giftApi({ method: "GET", headers: {}, query: { code: "IN2-WXYZ" } }, giftRes);
  assert.equal(giftRes.statusCode, 200, "gift balance -> 200");
  assert.equal(giftRes.body.balanceCents, 5000, "gift balance is 5000");
  assert.equal(giftRes.body.originalCents, 8500, "gift original is 8500");
  assert.equal(giftRes.body.neverExpires, true, "gift value never expires");
  const giftRes2 = mockRes();
  await giftApi({ method: "GET", headers: {}, query: { code: "IN2-NOPE" } }, giftRes2);
  assert.equal(giftRes2.statusCode, 404, "unknown gift code -> 404");
  assert.equal(giftRes2.body.balanceCents, 0, "unknown code reports zero balance");

  console.log("agent-actions tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
