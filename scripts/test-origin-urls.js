// Origin-aware URLs tests (Tony Nov 20, 2026).
// A preview payment whose Stripe success URL points at the live site
// lands the payer on "Payment not confirmed yet" (bookings) or a 404
// (gifts). Success URLs, email links, referral share links and gift
// copy must point at the deployment the client is actually on — the
// request's own origin when SITE_URL is unset — and keep pointing at
// the live domain in Production. No preview URL is ever hardcoded.
// Uses an in-memory KV stub + stubbed Stripe (no Stripe/KV/Resend needed).
// Run: node scripts/test-origin-urls.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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
let lastPayLinkArgs = null;
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async (args) => { lastCheckoutArgs = args; return { id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" }; },
          retrieve: async () => ({ payment_status: "paid", amount_total: 10000, metadata: {}, payment_intent: "pi_test" }),
        },
      },
      paymentLinks: { create: async (args) => { lastPayLinkArgs = args; return { id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }; } },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
  },
};

delete process.env.RESEND_API_KEY;
delete process.env.SITE_URL;
process.env.AGENT_API_KEY = "test-agent-key";

const { siteUrlFor, originOf, originLabel, buildBooking, createBookingCheckout, createPayLink, ensureGiftCode } = require("../lib/bookings");
const { dedupeServicesByName, SERVICES } = require("../lib/schedule");
const book = require("../api/book");
const giftBuy = require("../api/gift-buy");

let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }

const PREVIEW = "https://in2skin-website-git-cooper-handof-b20d0a-tony-demilios-projects.vercel.app";
const PREVIEW_HOST = "in2skin-website-git-cooper-handof-b20d0a-tony-demilios-projects.vercel.app";
const LIVE = "https://www.boltonfacials.com";

// --- (1) siteUrlFor: the request's own origin, live fallback, env wins. ---
ok(siteUrlFor({ headers: { host: PREVIEW_HOST } }) === PREVIEW, "preview host -> preview origin");
ok(siteUrlFor({ headers: { "x-forwarded-host": PREVIEW_HOST, host: "internal.invalid" } }) === PREVIEW, "x-forwarded-host wins over host");
ok(siteUrlFor({ headers: { host: "www.boltonfacials.com" } }) === LIVE, "live www host -> live fallback");
ok(siteUrlFor({ headers: { host: "boltonfacials.com" } }) === LIVE, "live apex host -> live fallback");
ok(siteUrlFor({ headers: {} }) === LIVE, "no host -> live fallback");
ok(siteUrlFor(null) === LIVE, "no request -> live fallback");
ok(siteUrlFor({ headers: { host: PREVIEW_HOST, "x-forwarded-proto": "http" } }) === "http://" + PREVIEW_HOST, "forwarded proto respected");
process.env.SITE_URL = "https://example.invalid";
ok(siteUrlFor({ headers: { host: PREVIEW_HOST } }) === "https://example.invalid", "SITE_URL env wins over the request origin");
delete process.env.SITE_URL;

// --- (2) originOf / originLabel: the recorded origin, live fallback. ---
ok(originOf({ origin: PREVIEW }) === PREVIEW, "recorded preview origin is used");
ok(originOf({ origin: PREVIEW + "/" }) === PREVIEW, "trailing slash stripped");
ok(originOf({}) === LIVE, "no origin -> live fallback");
ok(originOf(null) === LIVE, "no record -> live fallback");
ok(originOf({ origin: "not-a-url" }) === LIVE, "garbage origin -> live fallback");
ok(originLabel(LIVE) === "boltonfacials.com", "live origin reads as boltonfacials.com");
ok(originLabel("https://www.boltonfacials.com") === "boltonfacials.com", "live www origin reads as boltonfacials.com");
ok(originLabel(PREVIEW) === PREVIEW_HOST, "preview origin shows its own host");

// --- (3) No success URL is built from the bare live constant anymore. ---
const bookingsJs = read("lib/bookings.js");
ok(!/\$\{SITE_URL\}\//.test(bookingsJs), "lib/bookings.js builds no link from the bare SITE_URL constant");
ok(bookingsJs.includes("success_url: `${originOf(booking)}/booked.html?session_id={CHECKOUT_SESSION_ID}`"), "booking checkout success URL uses the booking origin");
for (const [file, bad] of [
  ["api/book.js", "${SITE_URL}/booked.html"],
  ["api/gift-buy.js", "${SITE_URL}/gift/"],
  ["api/gift-buy.js", "${SITE_URL}/gift-sent.html"],
  ["api/admin/magic-link.js", "${SITE_URL}/admin/"],
]) {
  ok(!read(file).includes(bad), `${file} builds no success URL from the bare SITE_URL constant`);
}
ok(read("api/book.js").includes("siteUrlFor(req)"), "api/book.js derives the origin from the request");
ok(read("api/gift-buy.js").includes("siteUrlFor(req)"), "api/gift-buy.js derives the origin from the request");
ok(read("api/gift-buy.js").includes("origin: siteUrlFor(req)"), "gift checkout metadata carries the origin");
ok(read("booked.html").includes("siteLabel() + '/?ref='"), "booked.html share link uses the current origin");
ok(!read("booked.html").includes("boltonfacials.com/?ref="), "booked.html share link never hardcodes the live domain");
ok(read("js/gift.js").includes('siteLabel() + " or call (289) 212-4124."'), "gift redeem copy uses the current origin");
ok(read("gift/index.html").includes('id="gcHow"'), "gift page redeem line is set from the current origin");

// --- (4) Walk-in dropdown: one needling row (the catalog dedupe). ---
const deduped = dedupeServicesByName(SERVICES);
ok(deduped.filter((s) => s.name === "Microneedling / NANO Needling").length === 1, "deduped catalog lists needling once");
ok(deduped.find((s) => s.name === "Microneedling / NANO Needling").id === "nano-needling", "deduped catalog keeps nano-needling, the current id");
ok(deduped.length === SERVICES.length - 1, "dedupe removes exactly the duplicate row");
ok(read("api/admin/data.js").includes("dedupeServicesByName(SERVICES)"), "catalog view serves the deduped list");

// --- (5) Booking + gift + pay link carry the origin end to end. ---
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

(async () => {
  // buildBooking records the caller's origin on the booking.
  const booking = await buildBooking({
    service: "classic-facial", date: futureDate(5), time: "10:00 AM", type: "regular",
    name: "Test Booker", phone: "(905) 555-0100", email: "booker@test.example",
    origin: PREVIEW,
  }, { bufferMins: 60, blocks: [], via: "web" });
  ok(booking.origin === PREVIEW, "buildBooking records the origin on the booking");
  ok(booking.payMode === "deposit" && booking.depositCents === 3000, "deposit model unchanged ($30 deposit)");

  // createBookingCheckout sends the payer back to the booking's origin.
  lastCheckoutArgs = null;
  await createBookingCheckout(booking);
  ok(lastCheckoutArgs.success_url === PREVIEW + "/booked.html?session_id={CHECKOUT_SESSION_ID}", "booking success URL points at the preview origin");
  ok(lastCheckoutArgs.cancel_url === PREVIEW + "/#book", "booking cancel URL points at the preview origin");

  // A booking with no origin falls back to the live site.
  const liveBooking = Object.assign({}, booking, { origin: null });
  lastCheckoutArgs = null;
  await createBookingCheckout(liveBooking);
  ok(lastCheckoutArgs.success_url === LIVE + "/booked.html?session_id={CHECKOUT_SESSION_ID}", "booking without an origin falls back to the live site");

  // POST /api/book on a preview host: the checkout success URL is preview.
  lastCheckoutArgs = null;
  const res = mockRes();
  await book({
    method: "POST",
    headers: { host: PREVIEW_HOST, "x-forwarded-proto": "https" },
    body: {
      service: "classic-facial", date: futureDate(6), time: "10:00 AM", type: "regular",
      name: "Test Booker", phone: "(905) 555-0100", email: "booker@test.example",
      payMode: "deposit", who: "me", forWhom: "me", giftCode: "",
      website: "", formLoadedAt: String(Date.now() - 60000),
    },
  }, res);
  ok(res.statusCode === 200 && res.body && res.body.url, "POST /api/book answers with a checkout URL");
  ok(lastCheckoutArgs && lastCheckoutArgs.success_url === PREVIEW + "/booked.html?session_id={CHECKOUT_SESSION_ID}", "POST /api/book success URL points at the preview origin");
  const saved = mem.get(`booking:${res.body.bookingId}`);
  ok(saved && saved.origin === PREVIEW, "saved booking carries the preview origin");

  // POST /api/gift-buy on a preview host: the gift success URL is preview.
  lastCheckoutArgs = null;
  const gres = mockRes();
  await giftBuy({
    method: "POST",
    headers: { host: PREVIEW_HOST, "x-forwarded-proto": "https" },
    body: {
      amount: 50, toName: "Friend Test", toPhone: "(905) 555-0101", message: "",
      delivery: "print", toEmail: "", buyerName: "Test Booker",
      buyerEmail: "booker@test.example", buyerPhone: "(905) 555-0100",
    },
  }, gres);
  ok(gres.statusCode === 200 && gres.body && gres.body.url, "POST /api/gift-buy answers with a checkout URL");
  ok(lastCheckoutArgs && lastCheckoutArgs.success_url === PREVIEW + "/gift/?paid={CHECKOUT_SESSION_ID}", "gift success URL points at the preview origin");
  ok(lastCheckoutArgs.metadata && lastCheckoutArgs.metadata.origin === PREVIEW, "gift checkout metadata carries the preview origin");

  // ensureGiftCode stores the origin on the issued gift record.
  const gift = await ensureGiftCode({
    id: "cs_test_gift1", amount_total: 5000,
    metadata: {
      type: "gift", amountCents: "5000", buyerName: "Test Booker",
      buyerEmail: "booker@test.example", recipientName: "Friend Test",
      recipientEmail: "", delivery: "print", sendOn: "", origin: PREVIEW,
    },
  });
  ok(gift.origin === PREVIEW, "issued gift record carries the preview origin");

  // createPayLink builds the pay URL on the passed origin.
  lastPayLinkArgs = null;
  const pay = await createPayLink({
    amountCents: 5500, clientName: "Test Booker", contact: "booker@test.example",
    method: "email", serviceLabel: "Classic Facial — balance", bookingId: booking.id,
    origin: PREVIEW,
  });
  ok(pay.url === PREVIEW + "/pay?id=" + pay.id, "pay link URL points at the preview origin");
  ok(lastPayLinkArgs.after_completion.redirect.url === PREVIEW + "/pay-paid.html?id=" + pay.id + "&session_id={CHECKOUT_SESSION_ID}", "pay link redirect points at the preview origin");

  // --- (6) Confirmation page names the deposit. ---
  const bookedHtml = read("booked.html");
  ok(bookedHtml.includes('(b.status === "deposit-paid" ? " deposit" : "")'), "booked.html names the deposit on deposit-paid bookings");
  ok(bookedHtml.includes("Balance due at your visit"), "booked.html still shows the balance due at the visit");

  // --- (7) Pay-step copy is final — no placeholder left. ---
  const index = read("index.html");
  ok(!index.includes("Wording TBC"), "index.html has no Wording TBC left");
  ok(index.includes("it carries as credit to your next appointment"), "pay-step policy states the deposit carries as credit");
  ok(index.includes("Free reschedule with 24 hours' notice"), "pay-step policy states free reschedule with 24h notice");
  ok(!/Deposit kept for no-shows/.test(index), "pay-step policy no longer says the deposit is kept for no-shows");

  // --- (8) One-click submit guards on every pay button. ---
  for (const [file, guard] of [
    ["js/main.js", "if (submitting) return;"],
    ["js/consult.js", "if (submitting) return;"],
    ["js/gift.js", "if (submitting) return;"],
  ]) {
    ok(read(file).includes(guard), `${file} ignores extra clicks while a payment is in flight`);
  }
  ok(read("js/main.js").includes('if (!submitting) $("#reserveBtn").textContent'), "picker render never resets the Reserve label mid-flight");
  ok(read("js/gift.js").includes('if (!submitting) $("#giftPay").textContent'), "gift paint never resets the Pay label mid-flight");

  console.log(`origin-url tests: all ${n} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
