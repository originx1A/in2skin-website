// Security tests — rate limiting, booking honeypot, backup + audit log.
// Run: node scripts/test-security.js
// Uses an in-memory KV stub + stubbed auth/Stripe (no Stripe/KV/Resend needed).
const assert = require("assert");

// --- in-memory KV, stubbed before any lib loads ---
const mem = new Map();
const exp = new Map();
function rawGet(k) {
  if (exp.has(k) && exp.get(k) <= Date.now()) { mem.delete(k); exp.delete(k); }
  return mem.has(k) ? mem.get(k) : null;
}
function globToRe(pattern) {
  return new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
}
async function stubPipeline(commands) {
  const out = [];
  for (const [cmd, ...args] of commands) {
    if (cmd === "INCR") {
      const v = (parseInt(rawGet(args[0]) || "0", 10) || 0) + 1;
      mem.set(args[0], String(v));
      out.push(v);
    } else if (cmd === "TTL") {
      if (!mem.has(args[0])) out.push(-2);
      else if (!exp.has(args[0])) out.push(-1);
      else out.push(Math.max(0, Math.ceil((exp.get(args[0]) - Date.now()) / 1000)));
    } else if (cmd === "EXPIRE") {
      exp.set(args[0], Date.now() + Number(args[1]) * 1000);
      out.push(1);
    } else if (cmd === "SCAN") {
      const pattern = args[2];
      const re = globToRe(pattern);
      out.push(["0", [...mem.keys()].filter((k) => re.test(k))]);
    } else if (cmd === "GET") {
      out.push(rawGet(args[0]));
    } else if (cmd === "SET") {
      mem.set(args[0], args[1]);
      out.push("OK");
    } else if (cmd === "DEL") {
      const had = mem.delete(args[0]);
      out.push(had ? 1 : 0);
    } else {
      throw new Error(`stub pipeline: unsupported ${cmd}`);
    }
  }
  return out;
}
const kvPath = require.resolve("../lib/kv");
require.cache[kvPath] = {
  exports: {
    configured: () => true,
    kvGet: async (k) => {
      const v = rawGet(k);
      if (v == null) return null;
      try { return JSON.parse(v); } catch { return v; }
    },
    kvSet: async (k, v) => { mem.set(k, JSON.stringify(v)); },
    kvDel: async (k) => { mem.delete(k); exp.delete(k); },
    pipeline: stubPipeline,
  },
};
// --- admin auth stub: every data.js call is signed in as the studio ---
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = {
  exports: {
    requireAdmin: async () => ({ email: "sarah@test.example" }),
    adminEmails: () => (process.env.ADMIN_EMAIL || "sarah@test.example,tony@test.example").split(",").map((e) => e.trim()),
  },
};
// --- Stripe stub: checkout + payment links (never charged in tests) ---
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async () => ({ id: "cs_test", url: "https://checkout.stripe.com/pay/test" }),
          retrieve: async () => ({ payment_status: "paid", amount_total: 6500, metadata: {} }),
        },
      },
      paymentLinks: {
        create: async () => ({ url: "https://buy.stripe.com/test", id: "plink_test" }),
      },
    }),
  },
};

const book = require("../api/book");
const gift = require("../api/gift");
const giftBuy = require("../api/gift-buy");
const pay = require("../api/pay");
const login = require("../api/admin/login");
const magicLink = require("../api/admin/magic-link");
const data = require("../api/admin/data");
const { saveBooking, listGifts, recordPayment } = require("../lib/bookings");

function mockReq({ method = "GET", query = {}, body = {}, headers = {} } = {}) {
  return { method, query, body, headers };
}
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
  };
  return res;
}
async function call(handler, reqOpts) {
  const res = mockRes();
  await handler(mockReq(reqOpts), res);
  return res;
}
function resetStore() { mem.clear(); exp.clear(); }

const BOT_MSG = "Something went wrong — please call us and we will book you in.";

async function testRateLimitBook() {
  resetStore();
  const ip = { "x-forwarded-for": "1.2.3.4" };
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call(book, { method: "POST", body: {}, headers: ip });
  }
  assert.strictEqual(last.statusCode, 429, "11th booking POST from one IP must be 429");
  assert.ok(last.headers["retry-after"], "429 carries a Retry-After header");
  assert.ok(/too many/i.test(last.body.error), "429 message is generic");
}

async function testRateLimitAgentExempt() {
  resetStore();
  process.env.AGENT_API_KEY = "agent-secret";
  const headers = { "x-forwarded-for": "5.6.7.8", "x-agent-key": "agent-secret" };
  let last;
  for (let i = 0; i < 12; i++) {
    last = await call(book, { method: "POST", body: { via: "agent" }, headers });
  }
  // Agent calls are never rate-limited (they fail validation instead — the
  // agent hold needs a real service — but never with a 429).
  assert.notStrictEqual(last.statusCode, 429, "agent calls must not be rate-limited");
  delete process.env.AGENT_API_KEY;
}

async function testRateLimitFailOpen() {
  resetStore();
  // KV down: pipeline throws -> requests are allowed, never blocked.
  require.cache[kvPath].exports.pipeline = async () => { throw new Error("KV down"); };
  const res = await call(book, { method: "POST", body: {}, headers: { "x-forwarded-for": "9.9.9.9" } });
  assert.notStrictEqual(res.statusCode, 429, "KV failure must fail open");
  require.cache[kvPath].exports.pipeline = stubPipeline;
}

async function testRateLimitGift() {
  resetStore();
  const ip = { "x-forwarded-for": "2.3.4.5" };
  let last;
  for (let i = 0; i < 31; i++) {
    last = await call(gift, { method: "GET", query: { code: "IN2SKIN-AAAAAA" }, headers: ip });
  }
  assert.strictEqual(last.statusCode, 429, "31st gift lookup from one IP must be 429");
}

async function testRateLimitMagicLink() {
  resetStore();
  process.env.ADMIN_EMAIL = "sarah@test.example";
  const ip = { "x-forwarded-for": "3.4.5.6" };
  let last;
  for (let i = 0; i < 6; i++) {
    last = await call(magicLink, { method: "POST", body: { email: "sarah@test.example" }, headers: ip });
  }
  assert.strictEqual(last.statusCode, 429, "6th magic link for one email in an hour must be 429");
  // Same IP, fresh emails: the per-IP bucket (10/hour) trips on the 11th.
  resetStore();
  for (let i = 0; i < 11; i++) {
    last = await call(magicLink, { method: "POST", body: { email: `other${i}@example.com` }, headers: ip });
  }
  assert.strictEqual(last.statusCode, 429, "11th magic link from one IP in an hour must be 429");
  delete process.env.ADMIN_EMAIL;
}

async function testRateLimitLogin() {
  resetStore();
  const ip = { "x-forwarded-for": "4.5.6.7" };
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call(login, { method: "POST", body: { password: "wrong" }, headers: ip });
  }
  assert.strictEqual(last.statusCode, 429, "11th password attempt from one IP in an hour must be 429");
}

async function testHoneypot() {
  resetStore();
  const ip = { "x-forwarded-for": "10.0.0.1" };
  // Honeypot filled -> generic rejection.
  let res = await call(book, { method: "POST", body: { website: "http://spam.example" }, headers: ip });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, BOT_MSG);
  // Submitted under 3 seconds after page load -> generic rejection.
  res = await call(book, { method: "POST", body: { formLoadedAt: Date.now() }, headers: { "x-forwarded-for": "10.0.0.2" } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, BOT_MSG);
  // Slow submit (a real client) -> passes the bot check and fails on the
  // missing treatment instead — never with the bot message.
  res = await call(book, { method: "POST", body: { formLoadedAt: Date.now() - 60000 }, headers: { "x-forwarded-for": "10.0.0.3" } });
  assert.strictEqual(res.statusCode, 400);
  assert.notStrictEqual(res.body.error, BOT_MSG);
  // No timestamp at all (old cached page) -> fails open, same as above.
  res = await call(book, { method: "POST", body: {}, headers: { "x-forwarded-for": "10.0.0.4" } });
  assert.strictEqual(res.statusCode, 400);
  assert.notStrictEqual(res.body.error, BOT_MSG);
}

async function testBackupAndAudit() {
  resetStore();
  // Seed one booking, one gift, one payment.
  await saveBooking({
    id: "bk_test1", service: "classic-facial", serviceName: "Classic Facial",
    date: "2026-11-20", time: "10:00 AM", type: "regular", name: "Test Client",
    phone: "9055550100", email: "test@example.com", amountCents: 6500,
    amountPaidCents: 6500, status: "paid", createdAt: new Date().toISOString(),
  });
  await mem.set("gift:IN2SKIN-TEST01", JSON.stringify({
    code: "IN2SKIN-TEST01", kind: "gift", balanceCents: 6500, originalCents: 6500,
    buyerName: "Buyer", recipientName: "Friend", createdAt: new Date().toISOString(),
  }));
  await mem.set("gift:all", JSON.stringify(["IN2SKIN-TEST01"]));
  await recordPayment({
    id: "pay_test1", kind: "pay-spot", amountCents: 6500, clientName: "Test Client",
    serviceLabel: "Classic Facial", method: "cash", createdAt: new Date().toISOString(),
  });

  // Backup view returns everything.
  let res = await call(data, { method: "GET", query: { view: "backup" } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.counts.bookings, 1);
  assert.strictEqual(res.body.counts.gifts, 1);
  assert.strictEqual(res.body.counts.payments, 1);
  assert.strictEqual(res.body.bookings[0].id, "bk_test1");
  assert.strictEqual(res.body.gifts[0].code, "IN2SKIN-TEST01");

  // A mutating action writes an audit entry, visible in the audit view.
  res = await call(data, { method: "POST", body: { view: "settings", action: "buffer", bufferMins: 75 } });
  assert.strictEqual(res.statusCode, 200);
  res = await call(data, { method: "GET", query: { view: "audit" } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.entries.length, 1);
  assert.strictEqual(res.body.entries[0].action, "settings.buffer");
  assert.strictEqual(res.body.entries[0].by, "sarah@test.example");

  // Cron branch: no secret -> 503; wrong token -> 401; right token -> 200.
  delete process.env.CRON_SECRET;
  res = await call(data, { method: "GET", query: { view: "backup", cron: "1" }, headers: { authorization: "Bearer x" } });
  assert.strictEqual(res.statusCode, 503);
  process.env.CRON_SECRET = "test-cron-secret";
  res = await call(data, { method: "GET", query: { view: "backup", cron: "1" }, headers: { authorization: "Bearer wrong" } });
  assert.strictEqual(res.statusCode, 401);
  res = await call(data, { method: "GET", query: { view: "backup", cron: "1" }, headers: { authorization: "Bearer test-cron-secret" } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.counts.bookings, 1);
  delete process.env.CRON_SECRET;
}

async function testAuditCap() {
  resetStore();
  const { kvSet } = require("../lib/kv");
  // Write 560 entries directly through the audit path via repeated
  // buffer saves (each one logs), then check the list is capped at 500.
  for (let i = 0; i < 560; i++) {
    await call(data, { method: "POST", body: { view: "settings", action: "buffer", bufferMins: 60 } });
  }
  const res = await call(data, { method: "GET", query: { view: "audit" } });
  assert.strictEqual(res.statusCode, 200);
  // The view returns the newest 100; the index itself must be capped.
  assert.strictEqual(res.body.entries.length, 100);
  const all = await require("../lib/kv").kvGet("audit:all");
  assert.strictEqual(all.length, 500, "audit index is capped at 500 entries");
}

(async () => {
  await testRateLimitBook();
  console.log("ok rate-limit: book 10/min/IP");
  await testRateLimitAgentExempt();
  console.log("ok rate-limit: agent key exempt");
  await testRateLimitFailOpen();
  console.log("ok rate-limit: KV failure fails open");
  await testRateLimitGift();
  console.log("ok rate-limit: gift 30/min/IP");
  await testRateLimitMagicLink();
  console.log("ok rate-limit: magic link 5/hour/email + 10/hour/IP");
  await testRateLimitLogin();
  console.log("ok rate-limit: login 10/hour/IP");
  await testHoneypot();
  console.log("ok honeypot: filled / too-fast rejected, slow + missing pass through");
  await testBackupAndAudit();
  console.log("ok backup + audit views + cron auth");
  await testAuditCap();
  console.log("ok audit log capped at 500");
  console.log("ALL SECURITY TESTS PASSED");
})().catch((err) => {
  console.error("SECURITY TEST FAILED:", err);
  process.exit(1);
});
