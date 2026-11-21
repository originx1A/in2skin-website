// Gift buy/redeem + friend booking + scheduled send + address rules
// (Tony Nov 20, 2026 — gifts, friend booking, booked-client emails).
// Run: node scripts/test-gift-friend.js
// Uses an in-memory KV stub + stubbed Stripe/email (no Stripe/KV/Resend needed).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
// --- Stripe stub: capture the checkout session creation ---
let lastSessionArgs = null;
const sessionsById = new Map();
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async (args) => {
            lastSessionArgs = args;
            const id = "cs_test_gift_" + Math.random().toString(36).slice(2, 8);
            sessionsById.set(id, { id, payment_status: "paid", amount_total: args.line_items[0].price_data.unit_amount, metadata: args.metadata || {}, payment_intent: "pi_test_1" });
            return { id, url: "https://checkout.stripe.test/pay/" + id };
          },
          retrieve: async (id) => sessionsById.get(id) || { payment_status: "paid", amount_total: 5000, metadata: {}, payment_intent: "pi_test_1" },
        },
      },
      paymentLinks: { create: async () => ({ id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }) },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
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

delete process.env.RESEND_API_KEY;
process.env.ADMIN_EMAIL = "studio@test.example";

const bookingsLib = require("../lib/bookings");
const giftBuy = require("../api/gift-buy");
const giftApi = require("../api/gift");

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
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function isoDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const base = (over) => Object.assign({
  service: "classic-facial", date: futureDate(5), time: "10:00 AM", type: "regular",
  name: "Jordan Lee", phone: "(905) 555-0100", email: "jordan@test.example",
}, over || {});

function giftSession(id, meta) {
  return { id, amount_total: Number(meta.amountCents || 0), metadata: Object.assign({ type: "gift" }, meta) };
}

async function run() {
  // ============ (1) IN2-XXXX format + old-format acceptance ============
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = bookingsLib.newGiftCode();
    assert.match(c, /^IN2-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/, "new code is IN2-XXXX, got " + c);
    if (i < 50) seen.add(c);
  }
  check("50 new codes are unique", seen.size, 50);

  // An OLD IN2SKIN-XXXXXX code already sold still validates + redeems.
  const oldRecord = {
    code: "IN2SKIN-ABC234", kind: "gift", balanceCents: 5000, originalCents: 5000,
    buyerName: "Old Buyer", buyerEmail: "old@test.example",
    recipientName: "Old Friend", recipientEmail: "oldfriend@test.example",
    holderName: "Old Friend", holderEmail: "oldfriend@test.example",
    delivery: "email", sendOn: null, message: "", uses: [], status: "active",
    createdAt: new Date().toISOString(), expiresAt: null, checkoutSessionId: "cs_old_1",
    certificateSent: true,
  };
  await mem.set("gift:IN2SKIN-ABC234", oldRecord);
  await mem.set("gift:all", ["IN2SKIN-ABC234"]);
  check("old code resolves lowercased", (await bookingsLib.getGift("in2skin-abc234") || {}).code, "IN2SKIN-ABC234");
  check("old code resolves with spaces", (await bookingsLib.getGift("IN2SKIN ABC234") || {}).code, "IN2SKIN-ABC234");
  check("normalize old keeps 6 chars", bookingsLib.normalizeGiftCode("in2skin-abc234"), "IN2SKIN-ABC234");
  check("normalize old tolerates a 7-char suffix", bookingsLib.normalizeGiftCode("in2skin-plain50"), "IN2SKIN-PLAIN50");
  check("normalize new keeps 4 chars", bookingsLib.normalizeGiftCode("in2 k7qf"), "IN2-K7QF");
  check("unknown code returns null", await bookingsLib.getGift("NOPE-1234"), null);

  const fresh = await bookingsLib.ensureGiftCode(giftSession("cs_fresh_1", {
    amountCents: "7500", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
  }));
  check("fresh code is IN2-XXXX", /^IN2-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(fresh.code), true);
  check("fresh code resolves any case", (await bookingsLib.getGift(fresh.code.toLowerCase()) || {}).code, fresh.code);
  check("fresh code resolves spaced", (await bookingsLib.getGift(fresh.code.replace("-", " ")) || {}).code, fresh.code);
  // Mark the fresh gift's certificate sent, so the sweep test below only
  // sees the scheduled gift as outstanding.
  await mem.set("gift:" + fresh.code, Object.assign({}, fresh, { certificateSent: true }));

  // ============ (2) gift-buy: the /gift/ page order shape ============
  let res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 75, treatment: null, toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "Happy birthday!", delivery: "email", toEmail: "taylor@test.example",
    sendOn: "now", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("page amount cert -> 200", res.statusCode, 200);
  check("page amount cert charges $75", lastSessionArgs.line_items[0].price_data.unit_amount, 7500);
  check("page amount cert metadata type gift", lastSessionArgs.metadata.type, "gift");
  check("page amount cert metadata delivery email", lastSessionArgs.metadata.delivery, "email");
  check("page amount cert metadata sendOn empty", lastSessionArgs.metadata.sendOn, "");
  check("page amount cert success goes to /gift/?paid=", String(lastSessionArgs.success_url).includes("/gift/?paid="), true);

  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 85, treatment: "Classic Facial", toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "email", toEmail: "taylor@test.example",
    sendOn: "now", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("page treatment -> 200", res.statusCode, 200);
  check("Classic Facial maps to $85 voucher", lastSessionArgs.line_items[0].price_data.unit_amount, 8500);
  check("treatment maps to voucher kind", lastSessionArgs.metadata.kind, "voucher");
  check("treatment maps to classic-facial", JSON.parse(lastSessionArgs.metadata.voucherFor).service, "classic-facial");

  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 160, treatment: "The Works", toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "email", toEmail: "taylor@test.example",
    sendOn: "now", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("The Works maps to $160 voucher", lastSessionArgs.line_items[0].price_data.unit_amount, 16000);
  check("The Works maps to combo-classic", JSON.parse(lastSessionArgs.metadata.voucherFor).service, "combo-classic");

  // Print delivery needs NO recipient email — the certificate goes to the buyer.
  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 50, treatment: null, toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "print", toEmail: "",
    sendOn: "", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("print without recipient email -> 200", res.statusCode, 200);
  check("print metadata delivery print", lastSessionArgs.metadata.delivery, "print");
  check("print metadata recipient email empty", lastSessionArgs.metadata.recipientEmail, "");

  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 5, treatment: null, toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "email", toEmail: "taylor@test.example",
    sendOn: "now", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("page amount $5 -> 400", res.statusCode, 400);

  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 85, treatment: "Not A Treatment", toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "email", toEmail: "taylor@test.example",
    sendOn: "now", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("unknown treatment -> 400", res.statusCode, 400);

  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    amount: 75, treatment: null, toName: "Taylor Reid", toPhone: "(416) 555-0103",
    message: "", delivery: "email", toEmail: "taylor@test.example",
    sendOn: isoDays(-1), buyerName: "Jordan Lee", buyerEmail: "jordan@test.example", buyerPhone: "(905) 555-0100",
  } }, res);
  check("sendOn in the past -> 400", res.statusCode, 400);

  // Legacy option shape still works (no phones required there).
  res = mockRes();
  await giftBuy({ method: "POST", headers: {}, body: {
    option: "gift-classic",
    buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
  } }, res);
  check("legacy option shape -> 200", res.statusCode, 200);
  check("legacy option charges $85", lastSessionArgs.line_items[0].price_data.unit_amount, 8500);

  // ============ (3) scheduled send gating ============
  const futureSendOn = isoDays(30);
  const schedGift = await bookingsLib.ensureGiftCode(giftSession("cs_sched_1", {
    amountCents: "5000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
    delivery: "email", sendOn: futureSendOn,
  }));
  check("scheduled gift stores sendOn", schedGift.sendOn, futureSendOn);
  check("future sendOn is not due", bookingsLib.giftCertificateDue(schedGift), false);
  sentEmails.length = 0;
  check("future sendOn does not send at payment", await bookingsLib.sendGiftCertificate(schedGift), false);
  check("no certificate email for future sendOn", sentEmails.length, 0);
  await bookingsLib.sendDueGiftCertificates();
  check("sweep does not send a future gift", sentEmails.length, 0);
  check("receipt still goes out at payment", await bookingsLib.sendGiftReceipt(schedGift), true);
  check("receipt says it will be emailed on the date", sentEmails.some((e) => e.to === "jordan@test.example" && /will be emailed to them/.test(e.html)), true);

  // Print delivery: the certificate goes to the BUYER at payment.
  const printGift = await bookingsLib.ensureGiftCode(giftSession("cs_print_1", {
    amountCents: "5000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "",
    delivery: "print",
  }));
  check("print gift delivery stored", printGift.delivery, "print");
  check("print certificate recipient is the buyer", bookingsLib.certificateRecipient(printGift), "jordan@test.example");
  sentEmails.length = 0;
  check("print certificate sends at payment", await bookingsLib.sendGiftCertificate(printGift), true);
  check("print certificate goes to buyer", sentEmails.some((e) => e.to === "jordan@test.example" && /to print/.test(e.subject)), true);

  // A gift due today sends through the sweep.
  const dueGift = await bookingsLib.ensureGiftCode(giftSession("cs_due_1", {
    amountCents: "5000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
    delivery: "email", sendOn: isoDays(0),
  }));
  check("sendOn today is due", bookingsLib.giftCertificateDue(dueGift), true);
  sentEmails.length = 0;
  await bookingsLib.sendDueGiftCertificates();
  check("sweep sends a due gift to the recipient", sentEmails.some((e) => e.to === "taylor@test.example" && /gift certificate/.test(e.subject)), true);

  // GET /api/gift?session_id= gates the certificate the same way.
  const schedSession = giftSession("cs_sched_2", {
    amountCents: "5000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
    delivery: "email", sendOn: futureSendOn,
  });
  sessionsById.set("cs_sched_2", { id: "cs_sched_2", payment_status: "paid", amount_total: 5000, metadata: schedSession.metadata, payment_intent: "pi_test_2" });
  sentEmails.length = 0;
  res = mockRes();
  await giftApi({ method: "GET", query: { session_id: "cs_sched_2" }, headers: {} }, res);
  check("session endpoint pays out the code", res.body.paid, true);
  check("session endpoint reports sendOn", res.body.sendOn, futureSendOn);
  check("session endpoint does not send the certificate early", sentEmails.some((e) => e.to === "taylor@test.example"), false);
  check("session endpoint still sends the receipt", sentEmails.some((e) => e.to === "jordan@test.example" && /receipt/.test(e.subject)), true);

  // ============ (4) gift redeem at booking: partial, full, reuse refused ============
  const partialGift = await bookingsLib.ensureGiftCode(giftSession("cs_partial_1", {
    amountCents: "5000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
  }));
  let b = await bookingsLib.buildBooking(base({ giftCode: partialGift.code, date: futureDate(6) }), { bufferMins: 60, blocks: [], via: "web" });
  check("partial gift applies its $50", b.giftAppliedCents, 5000);
  check("partial gift leaves $35 owing", b.amountCents, 3500);
  check("partial gift booking is a $30 deposit", b.depositCents, 3000);
  await bookingsLib.saveBooking(b);
  check("deductGift takes $50 once", await bookingsLib.deductGift(b), 5000);
  check("deductGift twice takes $0", await bookingsLib.deductGift(b), 0);
  check("gift balance $0 after full use", (await bookingsLib.getGift(partialGift.code)).balanceCents, 0);
  await assert.rejects(
    bookingsLib.buildBooking(base({ giftCode: partialGift.code, date: futureDate(7) }), { bufferMins: 60, blocks: [], via: "web" }),
    /no balance left/,
    "a fully-used code is refused server-side",
  );
  pass++;

  // The OLD code redeems too (partial use on it).
  b = await bookingsLib.buildBooking(base({ giftCode: "IN2SKIN-ABC234", date: futureDate(8) }), { bufferMins: 60, blocks: [], via: "web" });
  check("old code applies its $50", b.giftAppliedCents, 5000);

  // Full cover by a gift code: $0 owing.
  const fullGift = await bookingsLib.ensureGiftCode(giftSession("cs_full_1", {
    amountCents: "10000", buyerName: "Jordan Lee", buyerEmail: "jordan@test.example",
    recipientName: "Taylor Reid", recipientEmail: "taylor@test.example",
  }));
  b = await bookingsLib.buildBooking(base({ giftCode: fullGift.code, date: futureDate(9) }), { bufferMins: 60, blocks: [], via: "web" });
  check("full gift covers the $85", b.giftAppliedCents, 8500);
  check("full gift leaves $0 owing", b.amountCents, 0);

  // ============ (5) friend booking: with + without guest email ============
  const friendBase = (over) => base(Object.assign({
    forWhom: "friend",
    guestName: "Taylor Reid", guestPhone: "(416) 555-0103", guestEmail: "taylor@test.example",
    friendMessage: "Enjoy some quiet time. Love, Jordan.",
  }, over || {}));
  b = await bookingsLib.buildBooking(friendBase({ date: futureDate(10) }), { bufferMins: 60, blocks: [], via: "web" });
  check("friend booking pays in full", b.payMode, "full");
  check("friend booking stores guest name", b.guestName, "Taylor Reid");
  check("friend booking stores guest email", b.guestEmail, "taylor@test.example");
  check("friend booking stores the note", b.friendMessage, "Enjoy some quiet time. Love, Jordan.");
  check("friend booking stores booker as payer", b.name, "Jordan Lee");
  b.status = "paid";
  b.amountPaidCents = b.amountCents;
  b.stripePaymentIntentId = "pi_test_friend";
  await bookingsLib.saveBooking(b);
  sentEmails.length = 0;
  await bookingsLib.finalizePaidBooking(b);
  const friendMail = sentEmails.find((e) => e.to === "taylor@test.example");
  const receiptMail = sentEmails.find((e) => e.to === "jordan@test.example" && /receipt/.test(e.subject));
  const genericMail = sentEmails.find((e) => /Your In2Skin booking is confirmed/.test(e.subject));
  check("friend gets the booked/paid email", !!friendMail, true);
  check("friend email subject names the payer", friendMail && friendMail.subject, "You're booked at In2Skin, a gift from Jordan Lee, all paid");
  check("friend email says it is all paid", friendMail && /all paid/.test(friendMail.html), true);
  check("friend email quotes the note", friendMail && /Enjoy some quiet time/.test(friendMail.html), true);
  check("friend email carries the studio address", friendMail && /92 Willow Street/.test(friendMail.html), true);
  check("friend email has the Maps link", friendMail && /google\.com\/maps\/search/.test(friendMail.html), true);
  check("friend email says arrive early", friendMail && /5 to 10 minutes early/.test(friendMail.html), true);
  check("friend email has NO parking note", friendMail && !/parking/i.test(friendMail.html), true);
  check("payer gets the receipt", !!receiptMail, true);
  check("receipt subject names the friend", receiptMail && receiptMail.subject, "Your receipt: a booking for Taylor Reid at In2Skin");
  check("receipt carries the receipt number", receiptMail && /pi_test_friend/.test(receiptMail.html), true);
  check("receipt says the friend was emailed too", receiptMail && /emailed them the details too/.test(receiptMail.html), true);
  check("generic confirmation is NOT sent to the friend", genericMail, undefined);
  const studioMail = sentEmails.find((e) => Array.isArray(e.to) && e.to.includes("studio@test.example"));
  check("studio is notified", !!studioMail, true);
  check("studio subject says Paid by X for Y", studioMail && /Jordan Lee paid for Taylor Reid/.test(studioMail.subject), true);

  // No guest email: no friend email, receipt still goes out, flag set.
  b = await bookingsLib.buildBooking(friendBase({ date: futureDate(11), guestEmail: "" }), { bufferMins: 60, blocks: [], via: "web" });
  check("friend booking without guest email builds", b.guestEmail, null);
  b.status = "paid";
  b.amountPaidCents = b.amountCents;
  b.stripePaymentIntentId = "pi_test_friend2";
  await bookingsLib.saveBooking(b);
  sentEmails.length = 0;
  await bookingsLib.finalizePaidBooking(b);
  check("no friend email without a guest email", sentEmails.some((e) => e.to === "taylor@test.example"), false);
  check("receipt still goes to the payer", sentEmails.some((e) => e.to === "jordan@test.example" && /receipt/.test(e.subject)), true);
  check("receipt says the studio will phone them", sentEmails.some((e) => /studio will phone them/.test(e.html)), true);
  const savedNoEmail = await bookingsLib.getBooking(b.id);
  check("friendNoEmail flag is set on the record", savedNoEmail.friendNoEmail, true);
  const studioMail2 = sentEmails.find((e) => Array.isArray(e.to) && e.to.includes("studio@test.example"));
  check("studio is told there is no email for the friend", studioMail2 && /No email for Taylor Reid/.test(studioMail2.html), true);

  // A friend booking without the payer's email still builds (locked-in
  // behaviour — the studio phones them); the receipt is skipped, the
  // friend email still goes out.
  b = await bookingsLib.buildBooking(friendBase({ date: futureDate(12), email: "" }), { bufferMins: 60, blocks: [], via: "web" });
  check("friend booking without payer email builds", b.email, "");
  b.status = "paid";
  b.amountPaidCents = b.amountCents;
  b.stripePaymentIntentId = "pi_test_friend3";
  await bookingsLib.saveBooking(b);
  sentEmails.length = 0;
  await bookingsLib.finalizePaidBooking(b);
  check("friend email still goes out without a payer email", sentEmails.some((e) => e.to === "taylor@test.example" && /gift from Jordan Lee/.test(e.subject)), true);
  check("no receipt without a payer email", sentEmails.some((e) => /Your receipt/.test(e.subject)), false);

  // ============ (6) address-in-email rules ============
  const paidTreatment = {
    service: "classic-facial", serviceName: "Classic Facial", serviceLabel: "Classic Facial",
    date: futureDate(13), time: "10:00 AM", type: "regular", forWhom: "me",
    name: "Jordan Lee", email: "jordan@test.example", phone: "(905) 555-0100",
    minsLabel: "55 minutes", amountCents: 8500, amountPaidCents: 8500, status: "paid",
    giftAppliedCents: 0, myReferralCode: null,
  };
  const confirmHtml = bookingsLib.bookingEmailHtml(paidTreatment, "");
  check("paid confirmation carries the address", confirmHtml.includes("92 Willow Street, Bolton, Ontario L7E 3G3"), true);
  check("paid confirmation carries the Maps link", confirmHtml.includes("https://www.google.com/maps/search/?api=1&query=92+Willow+Street+Bolton+ON+L7E+3G3"), true);
  check("paid confirmation drops the old directions line", confirmHtml.includes("directions are shared when you book"), false);

  const videoConsult = Object.assign({}, paidTreatment, {
    service: "consultation", serviceName: "Video Consultation", serviceLabel: "Video Consultation",
    format: "video", amountCents: 3000, amountPaidCents: 3000,
  });
  const videoHtml = bookingsLib.bookingEmailHtml(videoConsult, "https://meet.google.com/abc-defg-hij");
  check("video consultation email has NO street address", videoHtml.includes("92 Willow Street"), false);
  check("video consultation email has the video link", videoHtml.includes("https://meet.google.com/abc-defg-hij"), true);

  const inPersonConsult = Object.assign({}, videoConsult, { serviceName: "In-Person Consultation", serviceLabel: "In-Person Consultation", format: "in-person" });
  check("in-person consultation email HAS the address", bookingsLib.bookingEmailHtml(inPersonConsult, "").includes("92 Willow Street"), true);

  sentEmails.length = 0;
  const holdBooking = Object.assign({}, paidTreatment, { status: "pending", amountPaidCents: 0, payMode: "deposit", depositCents: 3000 });
  await bookingsLib.sendHoldEmail(holdBooking, "https://checkout.stripe.test/pay/x");
  check("hold email has NO street address", sentEmails.some((e) => /92 Willow Street/.test(e.html)), false);

  const certHtml = bookingsLib.voucherCertificateHtml({
    code: "IN2-ABCD", buyerName: "Jordan Lee", message: "",
    originalCents: 8500, voucherLabel: "Classic Facial — $85", suggestedUseBy: null,
  });
  check("voucher certificate has NO street address", certHtml.includes("92 Willow Street"), false);

  // The address lives in exactly one server-only place (lib/studio.js) —
  // never in a public page, a browser script, or another server file.
  const root = path.join(__dirname, "..");
  const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
  check("address is the studio.js constant", read("lib/studio.js").includes('STUDIO_ADDRESS = "92 Willow Street, Bolton, Ontario L7E 3G3"'), true);
  check("bookings.js holds no literal address", read("lib/bookings.js").includes("92 Willow Street"), false);
  for (const p of ["index.html", "gift/index.html", "gift-sent.html", "booked.html", "js/main.js", "js/gift.js", "questions/index.html", "contact/index.html"]) {
    check(`no street address on public ${p}`, read(p).includes("92 Willow Street"), false);
  }

  // ============ (7) front-end wiring: no preview codes, real endpoints ============
  const giftJs = read("js/gift.js");
  check("gift.js posts to /api/gift-buy", giftJs.includes('fetch("/api/gift-buy"'), true);
  check("gift.js has no browser-invented code", giftJs.includes("createPreviewOrder"), false);
  check("gift.js has no localStorage gift store", giftJs.includes("in2-gifts-v1"), false);
  check("gift.js renders the paid card from /api/gift", giftJs.includes('/api/gift?session_id='), true);
  const mainJs = read("js/main.js");
  check("picker posts the friend note", mainJs.includes("friendMessage"), true);
  check("picker shows the remaining gift balance", mainJs.includes("left on the code"), true);
  check("picker checks codes server-side", mainJs.includes('/api/gift?code='), true);

  console.log(`gift-friend tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error("FAIL:", err); process.exit(1); });
