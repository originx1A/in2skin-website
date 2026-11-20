// Pay-link creation is admin-only (Tony Nov 19, 2026) — the "Send a
// payment link" form lives in the dashboard behind Sarah's sign-in.
// Run: node scripts/test-pay-admin.js
// Uses an in-memory KV stub + stubbed Stripe (no Stripe/KV/Resend needed).
// Unlike test-security.js (which stubs auth as always signed in), this
// file loads the REAL lib/auth so the gate is tested for real:
//   POST without a session cookie -> 401
//   POST with a real session cookie -> 200, link created (dashboard path)
//   GET ?id= (client redemption, /pay.html) -> 200, still public
//   GET ?session_id= (pay-paid fallback) -> 200, still public
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
// --- Stripe stub: payment links + checkout retrieve (never charged) ---
let lastSessionId = null;
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async () => ({ id: "cs_test", url: "https://checkout.stripe.com/pay/test" }),
          retrieve: async (id) => ({
            id,
            payment_status: "paid",
            amount_total: 6500,
            metadata: { type: "payspot", paylinkId: lastSessionId || "", giftCode: "", giftAppliedCents: "0" },
          }),
        },
      },
      paymentLinks: {
        create: async () => ({ url: "https://buy.stripe.com/test", id: "plink_test" }),
      },
    }),
  },
};

const pay = require("../api/pay");

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

async function main() {
  // 1. No session cookie: creating a link is refused.
  const anon = await call(pay, {
    method: "POST",
    body: { amount: 65, clientName: "Test Client", contact: "", method: "qr", serviceLabel: "Classic Facial" },
  });
  assert.strictEqual(anon.statusCode, 401, "POST /api/pay without a session must be 401");
  assert.ok(/sign in/i.test(anon.body.error), "401 says to sign in");

  // 2. A real session cookie (seeded straight into KV, as the magic-link
  // login would): the dashboard path works.
  const token = "test-session-token";
  mem.set(`session:${token}`, JSON.stringify({
    email: "sdmadsen@live.com",
    createdAt: new Date().toISOString(),
    exp: Date.now() + 30 * 24 * 3600 * 1000,
  }));
  const authed = await call(pay, {
    method: "POST",
    headers: { cookie: `in2skin_admin=${token}` },
    body: { amount: 65, clientName: "Test Client", contact: "", method: "qr", serviceLabel: "Classic Facial" },
  });
  assert.strictEqual(authed.statusCode, 200, "POST /api/pay with a session must be 200");
  assert.ok(authed.body.url && authed.body.id, "signed-in POST returns a pay link url + id");
  assert.ok(authed.body.url.includes("/pay?id="), "link points at the client pay page");
  lastSessionId = authed.body.id;

  // 3. The client's side stays public: redeeming the link needs no sign-in.
  const redeem = await call(pay, { method: "GET", query: { id: authed.body.id } });
  assert.strictEqual(redeem.statusCode, 200, "GET /api/pay?id= stays public");
  assert.strictEqual(redeem.body.paid, false, "fresh link is unpaid");
  assert.ok(redeem.body.stripeUrl, "redemption returns the Stripe URL");

  // 4. The pay-paid fallback stays public too: a paid Stripe session
  // settles the link without a sign-in.
  const settled = await call(pay, { method: "GET", query: { session_id: "cs_test_1" } });
  assert.strictEqual(settled.statusCode, 200, "GET /api/pay?session_id= stays public");
  assert.strictEqual(settled.body.paid, true, "paid session marks the link paid");

  console.log("test-pay-admin: all 4 checks passed");
}

main().catch((e) => { console.error("FAIL", e); process.exit(1); });
