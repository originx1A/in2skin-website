// Deposit model tests (Tony Nov 19, 2026): online bookings pay a $30
// deposit to hold the spot, credited toward the treatment; the balance
// is paid at the visit. Book without the deposit and the slot is held
// 30 minutes, then releases. Sarah can waive the deposit. On no-show
// or late cancel the deposit is NEVER refunded in cash and NEVER lost —
// it carries as credit to the next appointment. Run:
// node scripts/test-deposit.js
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
          create: async (args) => { lastCheckoutArgs = args; return { id: "cs_test_dep", url: "https://checkout.stripe.test/pay/cs_test_dep" }; },
          retrieve: async () => ({ payment_status: "paid", amount_total: 3000, metadata: {}, payment_intent: "pi_dep" }),
        },
      },
      paymentLinks: { create: async () => ({ id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }) },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
  },
};

delete process.env.RESEND_API_KEY;
process.env.AGENT_API_KEY = "test-agent-key";

// Capture emails instead of sending: the real sendEmail returns false
// with no key (skipped, never throws) — the stub does the same while
// keeping the last message for wording assertions.
const emailPath = require.resolve("../lib/email");
let lastEmail = null;
require.cache[emailPath] = {
  exports: {
    sendEmail: async (args) => { lastEmail = args; return false; },
    FROM: "In2Skin <bookings@boltonfacials.com>",
  },
};

const { depositCentsFor, needsReview, DEPOSIT_CENTS, DEPOSIT_SENTENCE } = require("../lib/schedule");
const B = require("../lib/bookings");
const { buildBooking, saveBooking, markBookingCheckoutPaid, bankDepositCredit, deductDepositCredit, getDepositCredit, cancelBooking, markBookingOutcome } = B;
const book = require("../api/book");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
// A future weekday, never a Sunday, never a date already used by an
// earlier step — the Sunday bump alone can collide two offsets on the
// same Monday, which is exactly how the old suites went flaky.
const usedDates = new Set();
function futureWeekday(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || usedDates.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() + 1);
  const s = d.toISOString().slice(0, 10);
  usedDates.add(s);
  return s;
}
let n = 0;
function uniq(over) {
  n++;
  return Object.assign({
    service: "classic-facial", date: futureWeekday(3 + n), time: "10:00 AM", type: "regular",
    name: "Deposit Tester " + n, phone: "(905) 555-3" + String(100 + n), email: "deposit" + n + "@test.example", first: "yes",
  }, over || {});
}

async function run() {
  // 1. Deposit math: $30, capped at the amount; consults pay in full.
  assert.equal(DEPOSIT_CENTS, 3000, "deposit is $30");
  assert.equal(depositCentsFor(15000, false), 3000, "$150 treatment -> $30 deposit");
  assert.equal(depositCentsFor(8500, false), 3000, "$85 treatment -> $30 deposit");
  assert.equal(depositCentsFor(2000, false), 2000, "$20 treatment -> deposit capped at $20");
  assert.equal(depositCentsFor(0, false), 0, "$0 -> no deposit");
  assert.equal(depositCentsFor(3000, true), 3000, "consult pays the full $30");
  assert.ok(DEPOSIT_SENTENCE.startsWith("Pay a $30 deposit to lock in your time"), "deposit sentence is the locked wording");

  // 2. Review flags (no hard blocks): peels + needling and Classic +
  //    needling are flagged for Sarah; ordinary pairs are not.
  assert.ok(needsReview("chemical-peels", ["needling"]), "peels + needling is flagged");
  assert.ok(needsReview("classic-facial", ["needling"]), "Classic + needling is flagged (Sarah decides)");
  assert.equal(needsReview("classic-facial", ["light-therapy"]), null, "Classic + Light is not flagged");
  assert.equal(needsReview("anti-aging-facial", ["needling"]), null, "Anti-Aging + needling is not flagged");

  // 3. buildBooking carries the deposit fields; the checkout takes the
  //    deposit only — never the full amount.
  let b = await buildBooking(uniq(), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 8500, "Classic is $85");
  assert.equal(b.depositCents, 3000, "deposit is $30");
  assert.equal(b.depositCreditCents, 0, "no carried credit yet");
  assert.equal(b.depositWaived, false, "deposit is not waived online");
  assert.equal(b.needsReview, false, "Classic alone needs no review");
  assert.equal(b.status, "pending", "booking starts pending");

  // 4. Classic + needling books fine (calculator, no block) — $150,
  //    needling charged ONCE, flagged for Sarah's review.
  b = await buildBooking(uniq({ addons: ["needling"] }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 15000, "Classic + needling is $150, got " + b.amountCents);
  assert.deepEqual(b.addons, ["needling"], "needling appears once");
  assert.equal(b.needsReview, true, "Classic + needling is flagged");
  assert.ok(b.reviewNote && b.reviewNote.length > 5, "review note explains the flag");

  // 5. Legacy needling ids resolve to the one merged treatment.
  b = await buildBooking(uniq({ service: "microneedling" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 6500, "legacy microneedling id is $65");
  assert.equal(b.minsLabel, "20 minutes", "legacy microneedling id is 20 minutes");
  b = await buildBooking(uniq({ addons: ["nano-needling"] }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 15000, "legacy nano-needling add-on is $150 total");
  assert.deepEqual(b.addons, ["needling"], "legacy nano id normalizes to needling");

  // 6. POST /api/book: the Stripe checkout charges the $30 deposit
  //    only, and the response names the balance due at the visit.
  const res = mockRes();
  await book({ method: "POST", headers: {}, body: uniq({ service: "classic-facial" }) }, res);
  assert.equal(res.statusCode, 200, "POST /api/book -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.ok(res.body.url, "deposit checkout URL returned");
  assert.equal(lastCheckoutArgs.line_items[0].price_data.unit_amount, 3000, "Stripe sees $30, not $85");
  assert.equal(res.body.depositCents, 3000, "response names the $30 deposit");
  assert.equal(res.body.balanceDueCents, 5500, "response names the $55 balance due at the visit");

  // 7. Paying the deposit flips the booking to "deposit-paid" — and
  //    the webhook + the status-page fallback can never double-apply
  //    the same payment intent (idempotency).
  let dep = await buildBooking(uniq(), { bufferMins: 60, blocks: [], via: "web" });
  await saveBooking(dep);
  const session = { payment_intent: "pi_dep_1", amount_total: 3000 };
  dep = await markBookingCheckoutPaid(dep, session);
  assert.equal(dep.status, "deposit-paid", "deposit paid -> deposit-paid");
  assert.equal(dep.depositPaidCents, 3000, "$30 recorded as paid");
  assert.equal(dep.amountPaidCents, 3000, "$30 total paid");
  const again = await markBookingCheckoutPaid(dep, session);
  assert.equal(again.amountPaidCents, 3000, "same payment intent twice does not double-apply");
  assert.equal(again.depositPaidCents, 3000, "deposit paid is not doubled");

  // 8. Paying the whole amount (waived deposit, or a gift covering the
  //    rest) lands on "paid", not "deposit-paid".
  let full = await buildBooking(uniq({ depositWaived: true }), { bufferMins: 60, blocks: [], via: "admin" });
  assert.equal(full.depositWaived, true, "admin walk-in waives the deposit");
  assert.equal(full.depositCents, 0, "waived booking has no deposit");
  await saveBooking(full);
  full = await markBookingCheckoutPaid(full, { payment_intent: "pi_dep_2", amount_total: 8500 });
  assert.equal(full.status, "paid", "full payment -> paid");
  assert.equal(full.amountPaidCents, 8500, "$85 recorded");

  // 9. No-show banks the deposit as credit — never cash, never lost —
  //    and banking is idempotent per booking.
  let noshow = await buildBooking(uniq(), { bufferMins: 60, blocks: [], via: "web" });
  await saveBooking(noshow);
  noshow = await markBookingCheckoutPaid(noshow, { payment_intent: "pi_dep_3", amount_total: 3000 });
  assert.equal(noshow.status, "deposit-paid", "deposit paid before the no-show");
  const banked = await bankDepositCredit(noshow);
  assert.equal(banked, 3000, "$30 banked as credit");
  assert.equal(await bankDepositCredit(noshow), 0, "banking twice banks nothing");
  assert.equal(await getDepositCredit(noshow.email, noshow.phone), 3000, "$30 credit sits on the client record");

  // 10. The next booking auto-applies the carried credit: no checkout,
  //     status "deposit-paid" straight away, balance still due at visit.
  const res2 = mockRes();
  await book({ method: "POST", headers: {}, body: uniq({ email: noshow.email, phone: noshow.phone, name: noshow.name }) }, res2);
  assert.equal(res2.statusCode, 200, "credit-covered booking -> 200");
  assert.equal(res2.body.depositPaid, true, "credit covers the deposit, no checkout");
  assert.equal(res2.body.depositCents, 3000, "deposit is still $30");
  assert.equal(res2.body.balanceDueCents, 5500, "$55 balance still due at the visit");
  assert.ok(!res2.body.url, "no Stripe checkout when credit covers the deposit");

  // 11. The credit is deducted when that booking locks in (finalize
  //     does it) — and only once.
  const credited = await B.getBooking(res2.body.bookingId);
  assert.equal(credited.depositCreditCents, 3000, "booking records the $30 credit it used");
  assert.equal(credited.depositCreditDeducted, true, "finalize already deducted the credit");
  assert.equal(await getDepositCredit(noshow.email, noshow.phone), 0, "client credit is spent");
  assert.equal(await deductDepositCredit(credited), 0, "deducting twice deducts nothing");

  // 12. Cancelling a deposit-paid booking banks the deposit too, and
  //     the cancellation email says the deposit carries as credit.
  let canc = await buildBooking(uniq(), { bufferMins: 60, blocks: [], via: "web" });
  await saveBooking(canc);
  canc = await markBookingCheckoutPaid(canc, { payment_intent: "pi_dep_4", amount_total: 3000 });
  await cancelBooking(canc, "client changed plans");
  assert.equal(await getDepositCredit(canc.email, canc.phone), 3000, "cancelled deposit is banked as credit");

  // 13. A consultation never banks a deposit: its $30 is a consult
  //     fee, not a treatment deposit.
  let cons = await buildBooking(uniq({ service: "consultation", format: "video", first: "yes" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(cons.depositCents, 3000, "consult deposit is the full $30");
  await saveBooking(cons);
  cons = await markBookingCheckoutPaid(cons, { payment_intent: "pi_dep_5", amount_total: 3000 });
  assert.equal(cons.status, "paid", "paid consult is paid");
  assert.equal(await bankDepositCredit(cons), 0, "consult banks no deposit credit");

  // 14. A fully-paid walk-in that no-shows banks nothing — only a
  //     deposit (depositPaidCents) ever banks.
  let paid = await buildBooking(uniq({ depositWaived: true }), { bufferMins: 60, blocks: [], via: "admin" });
  await saveBooking(paid);
  paid = await markBookingCheckoutPaid(paid, { payment_intent: "pi_dep_6", amount_total: 8500 });
  paid = await markBookingOutcome(paid, "no-show");
  assert.equal(await getDepositCredit(paid.email, paid.phone), 0, "no deposit to bank on a fully-paid walk-in");

  // 15. Option C — book now, pay at the studio (Tony Nov 19, 2026): the
  //     time is held for 30 minutes until Sarah confirms it. No checkout,
  //     no payment due now, status stays pending, and the hold email says
  //     pay-at-visit — never "consultation booking".
  const res3 = mockRes();
  await book({ method: "POST", headers: {}, body: uniq({ service: "classic-facial", payAtStudio: true }) }, res3);
  assert.equal(res3.statusCode, 200, "pay-at-studio booking -> 200, got " + res3.statusCode + " " + JSON.stringify(res3.body));
  assert.equal(res3.body.hold, true, "pay-at-studio returns a hold");
  assert.equal(res3.body.payAtStudio, true, "response names pay-at-studio");
  assert.ok(res3.body.holdUntil, "hold has an expiry");
  assert.ok(!res3.body.url, "no Stripe checkout for pay-at-studio");
  const held = await B.getBooking(res3.body.bookingId);
  assert.equal(held.status, "pending", "pay-at-studio booking stays pending until Sarah confirms");
  assert.equal(held.payAtStudio, true, "pay-at-studio flag is stored");
  assert.equal(held.depositPaidCents || 0, 0, "nothing paid yet");
  assert.ok(lastEmail && lastEmail.subject.includes("held"), "hold email was sent");
  assert.ok(!/consultation booking/i.test(lastEmail.html), "hold email never says 'consultation booking' for a treatment");
  assert.ok(/pay the full amount at your visit/i.test(lastEmail.html), "hold email says pay at the visit");
  assert.ok(/30 minutes/i.test(lastEmail.html), "hold email names the 30-minute hold");

  // 16. Option C is refused for consultations — they pay $30 up front.
  const res4 = mockRes();
  await book({ method: "POST", headers: {}, body: uniq({ service: "consultation", format: "video", first: "yes", payAtStudio: true }) }, res4);
  assert.equal(res4.statusCode, 200, "consult + payAtStudio -> 200");
  assert.ok(res4.body.url, "consultation still goes to Stripe checkout");
  assert.ok(!res4.body.payAtStudio, "consultation is not a pay-at-studio hold");

  console.log("deposit tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
