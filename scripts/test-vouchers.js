// Voucher tests — pricing, issue, use logging, holder rule, completion void,
// no-show restore, and the purchase validation.
// Run: node scripts/test-vouchers.js
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

const sched = require("../lib/schedule");
const bookingsLib = require("../lib/bookings");
const giftBuy = require("../api/gift-buy");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log("FAIL:", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); }
  return ok;
}
function checkThrows(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw, true);
}
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

function voucherSession(id, label, totalCents) {
  return {
    id,
    amount_total: totalCents,
    metadata: {
      type: "gift", kind: "voucher", amountCents: String(totalCents),
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
  // --- pricing (mirrors the booking math) ---
  let p = sched.priceVoucher("classic-facial", ["reflexology"], "regular");
  check("Classic + Reflexology regular = $120", p.totalCents, 12000);
  check("label names the treatment", p.label, "Classic Facial + Reflexology — $120");
  p = sched.priceVoucher("classic-facial", ["reflexology"], "after");
  check("Classic + Reflexology Private Hours = $135 (premium once)", p.totalCents, 13500);
  p = sched.priceVoucher("classic-facial", ["light-therapy", "reflexology"], "after");
  check("Classic + Light + Reflexology Private Hours = $190 (premium once per visit)", p.totalCents, 19000);
  p = sched.priceVoucher("anti-aging-facial", ["needling", "light-therapy"], "regular");
  check("Anti + Needling + Light = $245", p.totalCents, 24500);
  p = sched.priceVoucher("combo-anti", [], "regular");
  check("The Works Anti alone = $195", p.totalCents, 19500);
  p = sched.priceVoucher("classic-facial", ["reflexology", "reflexology"], "regular");
  check("duplicate add-on counted once", p.totalCents, 12000);
  checkThrows("chemical peel cannot be a voucher main", () => sched.priceVoucher("chemical-peels", [], "regular"));
  checkThrows("needling cannot be a voucher main", () => sched.priceVoucher("needling", [], "regular"));
  checkThrows("a facial cannot be an add-on", () => sched.priceVoucher("classic-facial", ["classic-facial"], "regular"));
  checkThrows("unknown add-on rejected", () => sched.priceVoucher("classic-facial", ["nope"], "regular"));

  // --- issue: voucher record carries the rules ---
  const gift = await bookingsLib.ensureGiftCode(voucherSession("cs_voucher1", "Classic Facial + Reflexology — $120", 12000));
  check("voucher kind", gift.kind, "voucher");
  check("voucher label", gift.voucherLabel, "Classic Facial + Reflexology — $120");
  check("voucherFor service", gift.voucherFor.service, "classic-facial");
  check("voucherFor add-on", gift.voucherFor.addons[0].id, "reflexology");
  check("voucher balance $120", gift.balanceCents, 12000);
  check("voucher uses[] starts empty", gift.uses.length, 0);
  check("voucher status active", gift.status, "active");
  const useBy = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  check("suggested use-by is +120 days", gift.suggestedUseBy, useBy);
  check("voucher never expires", gift.expiresAt, null);
  check("holder starts as the recipient", gift.holderEmail, "sam@example.com");
  const again = await bookingsLib.ensureGiftCode(voucherSession("cs_voucher1", "Classic Facial + Reflexology — $120", 12000));
  check("ensureGiftCode idempotent", again.code, gift.code);
  const all = await bookingsLib.listGifts();
  check("gift:all index lists the voucher", all.some((g) => g.code === gift.code), true);

  // --- plain gift issue is unchanged ---
  const plain = await bookingsLib.ensureGiftCode({
    id: "cs_gift1", amount_total: 6500,
    metadata: { type: "gift", amountCents: "6500", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "b@example.com" },
  });
  check("plain gift kind", plain.kind, "gift");
  check("plain gift no voucher label", plain.voucherLabel, "");
  check("plain gift no suggested use-by", plain.suggestedUseBy, null);

  // --- use: remainder stays with the USER, uses[] logged ---
  const booking = {
    id: "bk-v1", status: "paid", forWhom: "me", name: "Sam Friend", email: "sam@example.com", phone: "(905) 555-0505",
    giftCode: gift.code, giftAppliedCents: 6500, giftDeducted: false,
  };
  await bookingsLib.saveBooking(booking);
  const deducted = await bookingsLib.deductGift(booking);
  check("deductGift returns 6500", deducted, 6500);
  const afterUse = await bookingsLib.getGift(gift.code);
  check("voucher balance after $65 use", afterUse.balanceCents, 5500);
  check("uses[] has 1 entry", afterUse.uses.length, 1);
  check("use entry amount", afterUse.uses[0].amountCents, 6500);
  check("use entry booking", afterUse.uses[0].bookingId, "bk-v1");
  check("holder is the user", afterUse.holderEmail, "sam@example.com");
  check("display status partially used", bookingsLib.giftDisplayStatus(afterUse), "partially used");

  // --- completion: partial voucher stays alive; full voucher dies ---
  let b = await bookingsLib.getBooking("bk-v1");
  b = await bookingsLib.markBookingOutcome(b, "completed");
  check("completed booking status", b.status, "completed");
  const partial = await bookingsLib.getGift(gift.code);
  check("partial voucher NOT voided at completion", partial.status, "active");

  // Use the remaining $55 on a reflexology booking, then complete it.
  const booking2 = {
    id: "bk-v2", status: "paid", forWhom: "me", name: "Sam Friend", email: "sam@example.com", phone: "(905) 555-0505",
    giftCode: gift.code, giftAppliedCents: 5500, giftDeducted: false,
  };
  await bookingsLib.saveBooking(booking2);
  await bookingsLib.deductGift(booking2);
  const zeroed = await bookingsLib.getGift(gift.code);
  check("voucher balance $0 after full use", zeroed.balanceCents, 0);
  check("display status used up before completion", bookingsLib.giftDisplayStatus(zeroed), "used up");
  let b2 = await bookingsLib.getBooking("bk-v2");
  b2 = await bookingsLib.markBookingOutcome(b2, "completed");
  const voided = await bookingsLib.getGift(gift.code);
  check("full voucher voided at completion", voided.status, "void");
  check("display status used up — void", bookingsLib.giftDisplayStatus(voided), "used up — void");

  // --- no-show: the value goes back on the voucher ---
  const gift2 = await bookingsLib.ensureGiftCode(voucherSession("cs_voucher2", "Classic Facial — $65", 6500));
  const booking3 = {
    id: "bk-v3", status: "paid", forWhom: "me", name: "Sam Friend", email: "sam@example.com", phone: "(905) 555-0505",
    giftCode: gift2.code, giftAppliedCents: 6500, giftDeducted: false,
    referralCode: null, referralAppliedCents: 0, referralDeducted: false,
    freeReflexologyApplied: false, freeReflexologyDeducted: false,
  };
  await bookingsLib.saveBooking(booking3);
  await bookingsLib.deductGift(booking3);
  const spent = await bookingsLib.getGift(gift2.code);
  check("voucher $0 before no-show", spent.balanceCents, 0);
  let b3 = await bookingsLib.getBooking("bk-v3");
  b3 = await bookingsLib.markBookingOutcome(b3, "no-show");
  check("no-show booking status", b3.status, "no-show");
  check("no-show clears giftDeducted", b3.giftDeducted, false);
  const restored = await bookingsLib.getGift(gift2.code);
  check("no-show restores full balance", restored.balanceCents, 6500);
  check("no-show logs a negative use entry", restored.uses.some((u) => u.amountCents === -6500), true);
  check("restored voucher still active", bookingsLib.giftDisplayStatus(restored), "active");

  // --- no-show also restores referral credit + free reflexology ---
  const refs = require("../lib/referrals");
  const referrer = await refs.getOrCreateReferral({ name: "Riley Ref", email: "riley@example.com", phone: "(905) 555-0606" });
  referrer.creditCents = 0; // all $15 was used on the no-show booking
  referrer.creditUsedCents = 1500;
  referrer.freeReflexology = 0; // the free add-on was used too
  await mem.set(`ref:${referrer.code}`, referrer);
  const booking4 = {
    id: "bk-v4", status: "paid", forWhom: "me", name: "Riley Ref", email: "riley@example.com", phone: "(905) 555-0606",
    giftCode: null, giftAppliedCents: 0, giftDeducted: false,
    referralCode: referrer.code, referralAppliedCents: 1500, referralDeducted: true,
    freeReflexologyApplied: true, freeReflexologyDeducted: true,
  };
  await bookingsLib.saveBooking(booking4);
  let b4 = await bookingsLib.getBooking("bk-v4");
  b4 = await bookingsLib.markBookingOutcome(b4, "no-show");
  const refAfter = await refs.getReferralByCode(referrer.code);
  check("no-show restores referral credit", refAfter.creditCents, 1500);
  check("no-show restores credit used", refAfter.creditUsedCents, 0);
  check("no-show restores free reflexology", refAfter.freeReflexology, 1);

  // --- purchase validation (no Stripe call on bad input) ---
  let res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: { kind: "voucher", service: "chemical-peels", addons: [], type: "regular", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "b@example.com" } }, res);
  check("voucher with peel main -> 400", res.statusCode, 400);
  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: { kind: "voucher", service: "classic-facial", addons: ["classic-facial"], type: "regular", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "b@example.com" } }, res);
  check("voucher with bad add-on -> 400", res.statusCode, 400);
  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: { kind: "voucher", service: "classic-facial", addons: [], type: "regular", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "not-an-email" } }, res);
  check("voucher with bad recipient email -> 400", res.statusCode, 400);
  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: { kind: "voucher", addons: [], type: "regular", buyerName: "A", buyerEmail: "a@example.com", recipientName: "B", recipientEmail: "b@example.com" } }, res);
  check("voucher with no service -> 400", res.statusCode, 400);

  // --- voucher certificate wording ---
  const html = bookingsLib.voucherCertificateHtml(gift);
  check("certificate says Good for", html.includes("Good for Classic Facial + Reflexology"), true);
  check("certificate says no cash value", html.includes("No cash value"), true);
  check("certificate says 120 days", html.includes("120 days"), true);
  check("certificate says value never expires", html.includes("never expires"), true);

  console.log(`voucher tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error("FAIL:", err); process.exit(1); });
