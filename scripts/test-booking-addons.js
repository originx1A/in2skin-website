// Booking add-on tests — wizard add-ons attach to any treatment (Tony Nov 17, 2026).
// Run: node scripts/test-booking-addons.js
// Uses an in-memory KV stub + stubbed Stripe (no Stripe/KV/Resend needed).
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
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" }),
          retrieve: async () => ({ payment_status: "paid", amount_total: 10000, metadata: {}, payment_intent: "pi_test" }),
        },
      },
      paymentLinks: { create: async () => ({ id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }) },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
  },
};

delete process.env.RESEND_API_KEY;
process.env.AGENT_API_KEY = "test-agent-key";

const { kvGet, kvSet } = require("../lib/kv");
const { buildBooking, saveBooking } = require("../lib/bookings");
const book = require("../api/book");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
// A date safely in the future (bookings start tomorrow, open 60 days).
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
const base = (over) => Object.assign({
  service: "classic-facial", date: futureDate(5), time: "9:00 AM", type: "regular",
  name: "Test Booker", phone: "(905) 555-0100", email: "booker@test.example", first: "yes",
}, over || {});

async function run() {
  // 1. Classic + Light Therapy: $65 + $45, first visit -$10 -> $100. 70 minutes.
  let b = await buildBooking(base({ addons: ["light-therapy"] }), { bufferMins: 30, blocks: [], via: "web" });
  assert.equal(b.amountCents, 10000, "Classic + Light first visit is $100, got " + b.amountCents);
  assert.equal(b.serviceLabel, "Classic Facial + Light Therapy", "serviceLabel joins add-ons");
  assert.equal(b.minsLabel, "70 minutes", "minsLabel is the full appointment");
  assert.deepEqual(b.addons, ["light-therapy"]);

  // 2. Classic + Light + Reflexology, Private Hours: 65+45+25+15 premium -10 -> $140. 85 minutes.
  b = await buildBooking(base({ addons: ["light-therapy", "reflexology"], type: "after", date: futureDate(6), time: "7:00 PM" }), { bufferMins: 30, blocks: [], via: "web" });
  assert.equal(b.amountCents, 14000, "Classic + 2 add-ons Private Hours is $140, got " + b.amountCents);
  assert.equal(b.minsLabel, "85 minutes");

  // 3. An add-on on its own is not a booking.
  await assert.rejects(
    buildBooking(base({ service: "reflexology" }), { bufferMins: 30, blocks: [], via: "web" }),
    /go with a treatment/,
  );

  // 4. Unknown add-on id is refused.
  await assert.rejects(
    buildBooking(base({ addons: ["not-a-treatment"] }), { bufferMins: 30, blocks: [], via: "web" }),
    /not available/,
  );

  // 5. Duplicate add-ons collapse to one.
  b = await buildBooking(base({ addons: ["light-therapy", "light-therapy"], date: futureDate(7) }), { bufferMins: 30, blocks: [], via: "web" });
  assert.deepEqual(b.addons, ["light-therapy"]);
  assert.equal(b.amountCents, 10000, "duplicated add-on charged once");

  // 6. The buffer wraps the whole appointment: a 70-min booking at 9:00
  //    blocks the 10:00 slot for the next client (ends 10:10 + 30-min buffer).
  const day = futureDate(8);
  const first = await buildBooking(base({ date: day, time: "9:00 AM", addons: ["light-therapy"] }), { bufferMins: 30, blocks: [], via: "web" });
  await saveBooking(first);
  await assert.rejects(
    buildBooking(base({ date: day, time: "10:00 AM" }), { bufferMins: 30, blocks: [], via: "web" }),
    /just taken/,
  );
  const later = await buildBooking(base({ date: day, time: "11:00 AM" }), { bufferMins: 30, blocks: [], via: "web" });
  assert.equal(later.time, "11:00 AM", "11:00 is clear of the 70-min booking + buffer");

  // 7. A banked free reflexology makes the reflexology ADD-ON free.
  const ref = await buildBooking(base({ date: futureDate(9), email: "ref@test.example", phone: "(905) 555-0200" }), { bufferMins: 30, blocks: [], via: "web" });
  const rec = await kvGet(`ref:${ref.myReferralCode}`);
  assert.ok(rec, "referral record created");
  await kvSet(`ref:${ref.myReferralCode}`, Object.assign({}, rec, { freeReflexology: 1, creditCents: 0 }));
  b = await buildBooking(base({
    date: futureDate(10), email: "ref@test.example", phone: "(905) 555-0200",
    addons: ["reflexology"], giftCode: ref.myReferralCode,
  }), { bufferMins: 30, blocks: [], via: "web" });
  assert.equal(b.freeReflexologyApplied, true, "free reflexology applied to the add-on");
  assert.equal(b.amountCents, 5500, "Classic $65 + free reflexology - $10 first visit = $55, got " + b.amountCents);

  // 8. Voice-agent hold with add-ons: same price math, hold created.
  const res = mockRes();
  await book({ method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { via: "agent", service: "classic-facial", addons: ["light-therapy"], date: futureDate(11), time: "9:00 AM", type: "regular", name: "Agent Caller", phone: "(905) 555-0300", email: "caller@test.example", first: "yes" } }, res);
  assert.equal(res.statusCode, 200, "agent hold with add-ons -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.amountCents, 10000, "agent hold total is $100");
  assert.equal(res.body.serviceLabel, "Classic Facial + Light Therapy");

  console.log("booking-addons tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
