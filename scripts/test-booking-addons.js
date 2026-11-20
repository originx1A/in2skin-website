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
let lastCheckoutArgs = null;
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async (args) => { lastCheckoutArgs = args; return { id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" }; },
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
const { buildBooking, saveBooking, sendBookingConfirmation } = require("../lib/bookings");
const book = require("../api/book");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
// A date safely in the future (bookings start tomorrow, open 60 days).
// Sundays roll forward — the studio is closed, so a Sunday target can
// never be booked.
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const base = (over) => Object.assign({
  service: "classic-facial", date: futureDate(5), time: "10:00 AM", type: "regular",
  name: "Test Booker", phone: "(905) 555-0100", email: "booker@test.example", first: "yes",
}, over || {});

async function run() {
  // 1. Classic + Light Therapy: $85 + $55 = $140. 75 minutes.
  let b = await buildBooking(base({ addons: ["light-therapy"] }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 14000, "Classic + Light is $140, got " + b.amountCents);
  assert.equal(b.serviceLabel, "Classic Facial + Light Therapy", "serviceLabel joins add-ons");
  assert.equal(b.minsLabel, "75 minutes", "minsLabel is the full appointment");
  assert.deepEqual(b.addons, ["light-therapy"]);

  // 2. Classic + Light + Reflexology, Private Hours: 85+55+35+15 premium = $190. 95 minutes.
  //    Only Sarah (admin) books early mornings and evenings — the web
  //    wizard never offers them (Tony Nov 19, 2026).
  b = await buildBooking(base({ addons: ["light-therapy", "reflexology"], type: "after", date: futureDate(6), time: "7:00 PM" }), { bufferMins: 60, blocks: [], via: "admin" });
  assert.equal(b.amountCents, 19000, "Classic + 2 add-ons Private Hours is $190, got " + b.amountCents);
  assert.equal(b.minsLabel, "95 minutes");
  await assert.rejects(
    buildBooking(base({ addons: ["light-therapy"], type: "after", date: futureDate(6), time: "7:00 PM" }), { bufferMins: 60, blocks: [], via: "web" }),
    /by request/,
  );

  // 3. An add-on on its own IS a booking (Tony Nov 17, 2026: some people
  //    just come for the reflexology). $35. 20 min.
  b = await buildBooking(base({ service: "reflexology" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 3500, "Reflexology alone is $35, got " + b.amountCents);
  assert.equal(b.serviceLabel, "Reflexology", "standalone label is just the treatment");
  assert.equal(b.minsLabel, "20 minutes", "standalone reflexology is 20 minutes");

  // 4. Unknown add-on id is refused.
  await assert.rejects(
    buildBooking(base({ addons: ["not-a-treatment"] }), { bufferMins: 60, blocks: [], via: "web" }),
    /not available/,
  );

  // 5. Duplicate add-ons collapse to one.
  b = await buildBooking(base({ addons: ["light-therapy", "light-therapy"], date: futureDate(7) }), { bufferMins: 60, blocks: [], via: "web" });
  assert.deepEqual(b.addons, ["light-therapy"]);
  assert.equal(b.amountCents, 14000, "duplicated add-on charged once");

  // 6. The reset wraps the whole appointment: a 75-min booking at
  //    10:00 blocks to 12:15 (75 + 60-min reset), so 11:00 is taken
  //    and 12:30 is the next free start; 1:00 PM is clear too.
  const day = futureDate(8);
  const first = await buildBooking(base({ date: day, time: "10:00 AM", addons: ["light-therapy"] }), { bufferMins: 60, blocks: [], via: "web" });
  await saveBooking(first);
  await assert.rejects(
    buildBooking(base({ date: day, time: "11:00 AM" }), { bufferMins: 60, blocks: [], via: "web" }),
    /just taken/,
  );
  const later = await buildBooking(base({ date: day, time: "1:00 PM" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(later.time, "1:00 PM", "1:00 PM is clear of the 75-min booking + gap");

  // 7. A banked free reflexology makes the reflexology ADD-ON free.
  const ref = await buildBooking(base({ date: futureDate(9), email: "ref@test.example", phone: "(905) 555-0200" }), { bufferMins: 60, blocks: [], via: "web" });
  const rec = await kvGet(`ref:${ref.myReferralCode}`);
  assert.ok(rec, "referral record created");
  await kvSet(`ref:${ref.myReferralCode}`, Object.assign({}, rec, { freeReflexology: 1, creditCents: 0 }));
  b = await buildBooking(base({
    date: futureDate(19), email: "ref@test.example", phone: "(905) 555-0200",
    addons: ["reflexology"], giftCode: ref.myReferralCode,
  }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.freeReflexologyApplied, true, "free reflexology applied to the add-on");
  assert.equal(b.amountCents, 8500, "Classic $85 + free reflexology = $85, got " + b.amountCents);

  // 8. Voice-agent hold with add-ons: same price math, hold created.
  const res = mockRes();
  await book({ method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { via: "agent", service: "classic-facial", addons: ["light-therapy"], date: futureDate(11), time: "10:00 AM", type: "regular", name: "Agent Caller", phone: "(905) 555-0300", email: "caller@test.example", first: "yes" } }, res);
  assert.equal(res.statusCode, 200, "agent hold with add-ons -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.amountCents, 14000, "agent hold total is $140");
  assert.equal(res.body.serviceLabel, "Classic Facial + Light Therapy");

  // 9. Voice-agent hold for a standalone add-on.
  const res2 = mockRes();
  await book({ method: "POST", headers: { "x-agent-key": "test-agent-key" },
    body: { via: "agent", service: "reflexology", date: futureDate(12), time: "10:00 AM", type: "regular", name: "Reflex Only", phone: "(905) 555-0400", email: "reflex@test.example", first: "yes" } }, res2);
  assert.equal(res2.statusCode, 200, "agent hold for standalone reflexology -> 200, got " + res2.statusCode + " " + JSON.stringify(res2.body));
  assert.equal(res2.body.amountCents, 3500, "agent standalone reflexology total is $35");
  assert.equal(res2.body.serviceLabel, "Reflexology");

  // 10. Email is optional (Tony Nov 17, 2026): a booking with no email
  //     succeeds, stores "", and still gets a referral code.
  b = await buildBooking(base({ email: "", phone: "(905) 555-0600", date: futureDate(13) }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.email, "", "no-email booking stores an empty email");
  assert.equal(b.amountCents, 8500, "Classic, no email, is $85, got " + b.amountCents);
  assert.ok(b.myReferralCode, "no-email booking still gets a referral code");

  // 11. An email that IS given must still look like an email.
  await assert.rejects(
    buildBooking(base({ email: "not-an-email", date: futureDate(14) }), { bufferMins: 60, blocks: [], via: "web" }),
    /doesn't look right/,
  );

  // 12. Booking for a friend with no emails at all: succeeds, guestEmail null.
  b = await buildBooking(base({ email: "", phone: "(905) 555-0700", date: futureDate(15),
    forWhom: "friend", guestName: "Alex Taylor", guestPhone: "(905) 555-0701", guestEmail: "" }),
    { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.email, "", "friend booking stores an empty booker email");
  assert.equal(b.guestEmail, null, "friend booking stores a null guest email");
  assert.equal(b.amountCents, 8500, "friend booking, no emails, is $85");

  // 13. POST /api/book with no email key at all: 200 + checkout URL, and
  //     Stripe never sees an empty customer_email.
  const res3 = mockRes();
  await book({ method: "POST", headers: {}, body: { service: "classic-facial", date: futureDate(16), time: "10:00 AM", type: "regular", name: "No Email Booker", phone: "(905) 555-0800", first: "yes" } }, res3);
  assert.equal(res3.statusCode, 200, "POST /api/book with no email -> 200, got " + res3.statusCode + " " + JSON.stringify(res3.body));
  assert.ok(res3.body.url, "no-email booking returns a checkout URL");
  assert.equal(lastCheckoutArgs.customer_email, undefined, "no customer_email sent to Stripe for a no-email booking");

  // 14. The confirmation email with no recipient never sends, never throws.
  const noEmailBooking = await buildBooking(base({ email: "", phone: "(905) 555-0900", date: futureDate(18) }), { bufferMins: 60, blocks: [], via: "web" });
  await saveBooking(noEmailBooking);
  noEmailBooking.status = "paid";
  noEmailBooking.amountPaidCents = noEmailBooking.amountCents;
  const sent = await sendBookingConfirmation(noEmailBooking);
  assert.equal(sent, false, "no confirmation email without an address");

  // 15. sendEmail with no recipient never calls the email provider, even
  //     when the key is set (production) — a missing email must never
  //     break a booking or payment.
  const { sendEmail } = require("../lib/email");
  const realFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true }; };
  process.env.RESEND_API_KEY = "test-key";
  try {
    assert.equal(await sendEmail({ to: [""], subject: "t", html: "<p>t</p>" }), false, "empty recipient list sends nothing");
    assert.equal(fetchCalls, 0, "provider never called without a recipient");
    assert.equal(await sendEmail({ to: ["a@test.example"], subject: "t", html: "<p>t</p>" }), true, "a real recipient still sends");
    assert.equal(fetchCalls, 1, "provider called once for a real recipient");
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }

  // 16. Needling is one treatment (Tony Nov 19, 2026): microneedling and
  //     NANO needling are the same thing, just the needle size — a booking
  //     picks one or the other, never both.
  await assert.rejects(
    buildBooking(base({ service: "microneedling", addons: ["nano-needling"], date: futureDate(20) }), { bufferMins: 60, blocks: [], via: "web" }),
    /one treatment/,
  );
  //     ...and microneedling on its own is now a plain $65 / 20-minute booking.
  b = await buildBooking(base({ service: "microneedling", date: futureDate(21) }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 6500, "Microneedling alone is $65, got " + b.amountCents);
  assert.equal(b.minsLabel, "20 minutes", "microneedling alone is 20 minutes");

  console.log("booking-addons tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
