// Agent gift-sale tests — the voice agent sells gift certificates and
// treatment vouchers over the phone (Tony Nov 17, 2026). The pay link is
// emailed to the BUYER; the gift code goes to the friend after payment.
// Run: node scripts/test-agent-gift.js
// Uses an in-memory KV stub + stubbed Stripe/email (no Stripe/KV/Resend needed).
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
// --- Stripe stub: capture the checkout session creation ---
let lastSessionArgs = null;
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async (args) => { lastSessionArgs = args; return { id: "cs_test_gift", url: "https://checkout.stripe.test/pay/cs_test_gift" }; },
          retrieve: async () => ({ payment_status: "paid", amount_total: 6500, metadata: {}, payment_intent: "pi_test" }),
        },
      },
      paymentLinks: { create: async () => ({ id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }) },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
  },
};
// --- Email stub: capture sent mail; emailOk=false simulates a send failure ---
let emailOk = true;
const sentEmails = [];
const emailPath = require.resolve("../lib/email");
require.cache[emailPath] = {
  exports: {
    sendEmail: async (args) => { sentEmails.push(args); return emailOk; },
    FROM: "In2Skin <bookings@boltonfacials.com>",
  },
};

delete process.env.RESEND_API_KEY;
process.env.AGENT_API_KEY = "test-agent-key";

const giftBuy = require("../api/gift-buy");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}
const agentReq = (body) => ({ method: "POST", headers: { "x-agent-key": "test-agent-key" }, body });

async function run() {
  // 1. No AGENT_API_KEY set -> 503 naming the missing var.
  delete process.env.AGENT_API_KEY;
  let res = mockRes();
  await giftBuy(agentReq({ via: "agent", option: "gift-classic" }), res);
  assert.equal(res.statusCode, 503, "missing key -> 503, got " + res.statusCode);
  assert.match(res.body.error, /AGENT_API_KEY/, "503 names AGENT_API_KEY");
  process.env.AGENT_API_KEY = "test-agent-key";

  // 2. Wrong key -> 401.
  res = mockRes();
  await giftBuy({ method: "POST", headers: { "x-agent-key": "wrong" }, body: { via: "agent", option: "gift-classic" } }, res);
  assert.equal(res.statusCode, 401, "wrong key -> 401, got " + res.statusCode);

  // 3. Certificate via the agent: Classic $65 for a friend.
  sentEmails.length = 0;
  res = mockRes();
  await giftBuy(agentReq({
    via: "agent", option: "gift-classic",
    buyerName: "Jordan Smith", buyerEmail: "buyer@test.example",
    recipientName: "Alex Taylor", recipientEmail: "friend@test.example",
  }), res);
  assert.equal(res.statusCode, 200, "agent cert -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.sent, true, "agent cert reports sent");
  assert.equal(res.body.amountCents, 6500, "Classic certificate is $65");
  assert.equal(lastSessionArgs.metadata.type, "gift", "checkout metadata type is gift");
  assert.equal(lastSessionArgs.customer_email, "buyer@test.example", "checkout goes to the buyer");
  assert.equal(lastSessionArgs.metadata.recipientEmail, "friend@test.example", "friend is the recipient");
  assert.equal(sentEmails.length, 1, "one pay-link email sent");
  assert.deepEqual(sentEmails[0].to, "buyer@test.example", "pay-link email goes to the BUYER, not the friend");
  assert.match(sentEmails[0].html, /cs_test_gift/, "pay-link email carries the checkout URL");
  assert.match(sentEmails[0].subject, /Alex Taylor/, "pay-link email names the friend");

  // 4. Voucher via the agent: Classic + Reflexology = $90.
  sentEmails.length = 0;
  res = mockRes();
  await giftBuy(agentReq({
    via: "agent", kind: "voucher", service: "classic-facial", addons: ["reflexology"], type: "regular",
    buyerName: "Jordan Smith", buyerEmail: "buyer@test.example",
    recipientName: "Alex Taylor", recipientEmail: "friend@test.example",
  }), res);
  assert.equal(res.statusCode, 200, "agent voucher -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.amountCents, 9000, "Classic + Reflexology voucher is $90");
  assert.equal(lastSessionArgs.metadata.kind, "voucher", "checkout metadata kind is voucher");
  const voucherFor = JSON.parse(lastSessionArgs.metadata.voucherFor);
  assert.equal(voucherFor.service, "classic-facial", "voucher is for the Classic Facial");
  assert.deepEqual(voucherFor.addons.map((a) => a.id), ["reflexology"], "voucher carries the add-on");
  assert.match(lastSessionArgs.line_items[0].price_data.product_data.name, /Treatment Voucher/, "voucher product name");

  // 5. Custom amount below $10 -> 400.
  res = mockRes();
  await giftBuy(agentReq({
    via: "agent", option: "gift-custom", amount: "5",
    buyerName: "Jordan Smith", buyerEmail: "buyer@test.example",
    recipientName: "Alex Taylor", recipientEmail: "friend@test.example",
  }), res);
  assert.equal(res.statusCode, 400, "custom $5 -> 400, got " + res.statusCode);

  // 6. Missing friend email -> 400.
  res = mockRes();
  await giftBuy(agentReq({
    via: "agent", option: "gift-classic",
    buyerName: "Jordan Smith", buyerEmail: "buyer@test.example",
    recipientName: "Alex Taylor", recipientEmail: "",
  }), res);
  assert.equal(res.statusCode, 400, "missing friend email -> 400, got " + res.statusCode);

  // 7. Email failure -> 502 (the agent must not claim a link is on its way).
  emailOk = false;
  res = mockRes();
  await giftBuy(agentReq({
    via: "agent", option: "gift-classic",
    buyerName: "Jordan Smith", buyerEmail: "buyer@test.example",
    recipientName: "Alex Taylor", recipientEmail: "friend@test.example",
  }), res);
  assert.equal(res.statusCode, 502, "email failure -> 502, got " + res.statusCode);
  emailOk = true;

  console.log("agent-gift tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
