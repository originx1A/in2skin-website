// Agent-hold tests — auth paths only (no Stripe/KV needed for these).
// Run: node scripts/test-agent-hold.js
// Also verifies every API module loads and the new exports exist.
const assert = require("assert");

const book = require("../api/book");
assert.equal(typeof book, "function", "api/book exports a handler");

const sched = require("../lib/schedule");
assert.equal(sched.PENDING_HOLD_MS, 30 * 60 * 1000, "PENDING_HOLD_MS is 30 min");
assert.equal(sched.BUFFER_MINS, 60, "BUFFER_MINS is 60");

const bookings = require("../lib/bookings");
assert.equal(typeof bookings.sendHoldEmail, "function", "sendHoldEmail is exported");

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
}

async function run() {
  // No AGENT_API_KEY set -> 503 naming the missing var.
  delete process.env.AGENT_API_KEY;
  let res = mockRes();
  await book({ method: "POST", headers: {}, body: { via: "agent", service: "classic-facial" } }, res);
  assert.equal(res.statusCode, 503, "missing key -> 503, got " + res.statusCode);
  assert.match(res.body.error, /AGENT_API_KEY/, "503 names AGENT_API_KEY");

  // Wrong key -> 401.
  process.env.AGENT_API_KEY = "test-key-123";
  res = mockRes();
  await book({ method: "POST", headers: { "x-agent-key": "wrong" }, body: { via: "agent", service: "classic-facial" } }, res);
  assert.equal(res.statusCode, 401, "wrong key -> 401, got " + res.statusCode);

  console.log("agent-hold tests: passed");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
