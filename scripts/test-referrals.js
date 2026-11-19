// Referral tests — code gen, milestone rewards, anti-gaming, redemption,
// and the booking integration (myReferralCode issued, credit at paid-marking).
// Run: node scripts/test-referrals.js
// Uses an in-memory KV stub (no Stripe/KV/Resend needed).
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

const refs = require("../lib/referrals");
const bookingsLib = require("../lib/bookings");
const book = require("../api/book");
const giftApi = require("../api/gift");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log("FAIL:", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); }
  return ok;
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

function tomorrowKey() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paidBooking(id, friend, referredBy, amounts) {
  const a = amounts || { amountCents: 8500, firstVisitDiscountCents: 0, giftAppliedCents: 0 };
  return {
    id, status: "paid", forWhom: "me", name: friend.name, email: friend.email,
    phone: friend.phone, guestName: null, guestEmail: null, guestPhone: null,
    date: tomorrowKey(), referredBy: referredBy || null,
    amountCents: a.amountCents, firstVisitDiscountCents: a.firstVisitDiscountCents,
    giftAppliedCents: a.giftAppliedCents,
  };
}

async function run() {
  // --- code gen ---
  check("new code format ALEX-XXXX", /^ALEX-\d{4}$/.test(refs.newReferralCode("Alex")), true);
  check("normalize lower + no dash", refs.normalizeReferralCode("alex4821"), "ALEX-4821");
  check("normalize keeps dash", refs.normalizeReferralCode("ALEX-4821"), "ALEX-4821");

  // --- get-or-create: one code per client, forever ---
  const alex = await refs.getOrCreateReferral({ name: "Alex Taylor", email: "alex@example.com", phone: "(905) 555-0101" });
  check("code starts with first name", alex.code.startsWith("ALEX-"), true);
  check("credit starts 0", alex.creditCents, 0);
  check("free reflexology starts 0", alex.freeReflexology, 0);
  const alexAgain = await refs.getOrCreateReferral({ name: "Alex Taylor", email: "alex@example.com", phone: "(905) 555-0101" });
  check("same email -> same code", alexAgain.code, alex.code);
  const alexByPhone = await refs.getOrCreateReferral({ name: "A. Taylor", email: "alex2@example.com", phone: "9055550101" });
  check("same phone -> same code", alexByPhone.code, alex.code);
  const blair = await refs.getOrCreateReferral({ name: "Blair Jones", email: "blair@example.com", phone: "(905) 555-0202" });
  check("different client -> different code", blair.code !== alex.code, true);

  // --- milestone rewards: $15 + free reflexology every 3 paid referrals ---
  const friends = [1, 2, 3, 4, 5, 6].map((n) => ({
    name: `Friend ${n}`, email: `friend${n}@example.com`, phone: `(905) 555-100${n}`,
  }));
  for (let i = 0; i < 6; i++) {
    const r = await refs.issueReferralCredit(paidBooking(`bk-f${i + 1}`, friends[i], alex.code));
    check(`friend ${i + 1} issued`, r.issued, true);
    check(`friend ${i + 1} paidCount`, r.paidCount, i + 1);
    check(`friend ${i + 1} awarded`, r.awarded, (i + 1) % 3 === 0);
  }
  const alexAfter = await refs.getReferralByCode(alex.code);
  check("6 paid referrals -> $30 credit", alexAfter.creditCents, 3000);
  check("6 paid referrals -> 2 free reflexology", alexAfter.freeReflexology, 2);
  check("6 paid referrals -> paidCount 6", alexAfter.paidCount, 6);
  check("referred list has 6 entries", alexAfter.referred.length, 6);
  check("referred entries marked paid", alexAfter.referred.every((f) => f.paid), true);

  // --- idempotency: same booking twice -> no double credit ---
  const dup = await refs.issueReferralCredit(paidBooking("bk-f3", friends[2], alex.code));
  check("re-issue same booking -> not issued", dup.issued, false);
  check("re-issue reason already", dup.reason, "already");
  const alexDup = await refs.getReferralByCode(alex.code);
  check("credit unchanged after duplicate", alexDup.creditCents, 3000);

  // --- anti-gaming: self-referral ---
  const self = await refs.issueReferralCredit(paidBooking("bk-self", { name: "Alex Taylor", email: "alex@example.com", phone: "(905) 555-0101" }, alex.code));
  check("self-referral not issued", self.issued, false);
  check("self-referral reason", self.reason, "self");

  // --- anti-gaming: not a new client ---
  const repeat = await refs.issueReferralCredit(paidBooking("bk-repeat", friends[0], alex.code));
  check("repeat client not issued", repeat.issued, false);
  check("repeat client reason", repeat.reason, "not-new");

  // --- consultation bookings earn nothing ---
  const consult = paidBooking("bk-consult", { name: "New Person", email: "new@example.com", phone: "(905) 555-9999" }, alex.code);
  consult.status = "consultation";
  const consultRes = await refs.issueReferralCredit(consult);
  check("consultation not issued", consultRes.issued, false);
  check("consultation reason", consultRes.reason, "not-paid");

  // --- $85 floor: a $35 add-on alone does not count, and does not burn the friend's new status ---
  const small = await refs.issueReferralCredit(paidBooking("bk-small", { name: "Sam Small", email: "sam@example.com", phone: "(905) 555-0404" }, alex.code, { amountCents: 3500, firstVisitDiscountCents: 0, giftAppliedCents: 0 }));
  check("below-floor not issued", small.issued, false);
  check("below-floor reason", small.reason, "below-minimum");
  const alexSmall = await refs.getReferralByCode(alex.code);
  check("paidCount unchanged after below-floor", alexSmall.paidCount, 6);
  const smallLater = await refs.issueReferralCredit(paidBooking("bk-small2", { name: "Sam Small", email: "sam@example.com", phone: "(905) 555-0404" }, alex.code));
  check("same friend later full facial counts", smallLater.issued, true);
  check("paidCount 7 after later full facial", smallLater.paidCount, 7);

  // --- $85 floor: first-visit Classic ($75 charged on an $85 value) still counts ---
  const firstVisit = await refs.issueReferralCredit(paidBooking("bk-first", { name: "Fay First", email: "fay@example.com", phone: "(905) 555-0505" }, alex.code, { amountCents: 7500, firstVisitDiscountCents: 1000, giftAppliedCents: 0 }));
  check("first-visit Classic counts", firstVisit.issued, true);
  check("paidCount 8 after first-visit Classic", firstVisit.paidCount, 8);

  // --- redemption: credit + free reflexology deduct once ---
  const redBooking = {
    id: "bk-redeem", status: "paid", referralCode: alex.code, referralAppliedCents: 1500,
    referralDeducted: false, freeReflexologyApplied: true, freeReflexologyDeducted: false,
  };
  const deducted = await refs.deductReferral(redBooking);
  check("deductReferral returns 1500", deducted, 1500);
  const alexRed = await refs.getReferralByCode(alex.code);
  check("credit after redeem", alexRed.creditCents, 1500);
  check("credit used after redeem", alexRed.creditUsedCents, 1500);
  check("free reflexology after redeem", alexRed.freeReflexology, 1);
  const deducted2 = await refs.deductReferral(redBooking);
  check("deductReferral twice -> 0", deducted2, 0);

  // --- booking integration: gift-covered $0 booking, referred friend ---
  // Seed an $85 gift code in the stub KV.
  await mem.set("gift:IN2SKIN-TEST01", {
    code: "IN2SKIN-TEST01", kind: "gift", balanceCents: 8500, originalCents: 8500,
    buyerName: "Buyer", buyerEmail: "buyer@example.com",
    recipientName: "Casey Friend", recipientEmail: "casey@example.com",
    holderName: "Casey Friend", holderEmail: "casey@example.com",
    uses: [], status: "active", createdAt: new Date().toISOString(), expiresAt: null,
  });
  const caseyRef = await refs.getOrCreateReferral({ name: "Casey Friend", email: "casey@example.com", phone: "(905) 555-0303" });
  const date = tomorrowKey();
  let res = mockRes();
  await book({
    method: "POST", headers: {}, body: {
      service: "classic-facial", date, time: "9:00 AM", type: "regular", forWhom: "me",
      name: "Casey Friend", phone: "(905) 555-0303", email: "casey@example.com",
      first: "no", giftCode: "IN2SKIN-TEST01", referredBy: alex.code,
    },
  }, res);
  check("$0 gift-covered booking -> 200", res.statusCode, 200);
  check("$0 booking paid", res.body.paid, true);
  check("myReferralCode issued to Casey", res.body.myReferralCode, caseyRef.code);
  const bkId = res.body.bookingId;
  const saved = await bookingsLib.getBooking(bkId);
  check("booking status paid", saved.status, "paid");
  check("booking stamped referredBy", saved.referredBy, alex.code);
  check("booking gift deducted", saved.giftDeducted, true);
  const giftAfter = await bookingsLib.getGift("IN2SKIN-TEST01");
  check("gift balance 0 after use", giftAfter.balanceCents, 0);
  check("gift uses[] has 1 entry", giftAfter.uses.length, 1);
  check("gift use amount 8500", giftAfter.uses[0].amountCents, 8500);
  const alexPaid = await refs.getReferralByCode(alex.code);
  check("Casey paid -> Alex paidCount 9", alexPaid.paidCount, 9);

  // --- booking validation: unknown referral code / not-owned code ---
  res = mockRes();
  await book({
    method: "POST", headers: {}, body: {
      service: "classic-facial", date, time: "11:00 AM", type: "regular", forWhom: "me",
      name: "Dana New", phone: "(905) 555-0404", email: "dana@example.com",
      first: "no", giftCode: "", referredBy: "NOPE-9999",
    },
  }, res);
  check("unknown referredBy -> 400", res.statusCode, 400);
  res = mockRes();
  await book({
    method: "POST", headers: {}, body: {
      service: "classic-facial", date, time: "11:00 AM", type: "regular", forWhom: "me",
      name: "Dana New", phone: "(905) 555-0404", email: "dana@example.com",
      first: "no", giftCode: alex.code, referredBy: "",
    },
  }, res);
  check("redeeming someone else's code -> 400", res.statusCode, 400);

  // --- gift-balance endpoint returns referral info ---
  res = mockRes();
  await giftApi({ method: "GET", query: { code: alex.code } }, res);
  check("gift-balance referral -> 200", res.statusCode, 200);
  check("gift-balance referral flag", res.body.referral, true);
  check("gift-balance referral credit", res.body.creditCents, 3000);
  check("gift-balance free reflexology", res.body.freeReflexology, 2);

  // --- admin list ---
  const all = await refs.listReferrals();
  check("listReferrals has Alex + Blair + Casey", all.length, 3);
  check("listReferrals includes Alex", all.some((r) => r.code === alex.code), true);

  console.log(`referral tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error("FAIL:", err); process.exit(1); });
