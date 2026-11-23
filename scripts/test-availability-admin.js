// Admin-aware after-hours availability (D1, Nov 23, 2026): the public
// booking wizard must never see Private Hours times, but the signed-in
// dashboard needs them for walk-ins and moves — this endpoint is the
// dashboard's only time source.
// Run: node scripts/test-availability-admin.js
// Uses an in-memory KV stub + stubbed auth (no KV/Resend needed).
const assert = require("assert");

// --- in-memory KV, stubbed before any lib loads (storage unconfigured,
// so the handler returns the full schedule without booking lookups) ---
const kvPath = require.resolve("../lib/kv");
require.cache[kvPath] = {
  exports: {
    configured: () => false,
    kvGet: async () => null,
    kvSet: async () => {},
    kvDel: async () => {},
    pipeline: async () => { throw new Error("pipeline not available in tests"); },
  },
};
// --- auth stub: getSession answers from the adminMode flag ---
let adminMode = false;
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = {
  exports: {
    getSession: async () => (adminMode ? { email: "sarah@test.example" } : null),
    requireAdmin: async () => ({ email: "sarah@test.example" }),
    adminEmails: () => ["sarah@test.example"],
  },
};

delete process.env.RESEND_API_KEY;
const availability = require("../api/availability");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL:", name, "got", JSON.stringify(got), "want", JSON.stringify(want)); }
  return ok;
}
function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
async function call(query) {
  const res = mockRes();
  await availability({ method: "GET", headers: {}, body: null, query }, res);
  return res;
}

async function run() {
  // Tuesday 2026-11-24, Sunday 2026-11-29 (verified with `date -d`).
  const tue = "2026-11-24";
  const sun = "2026-11-29";

  // 1. The public wizard (no admin session) never sees after-hours times.
  adminMode = false;
  let r = await call({ date: tue, service: "classic-facial", type: "after" });
  check("unauth after times are empty", r.body.times, []);
  check("unauth after status 200", r.statusCode, 200);

  // 2. The signed-in dashboard gets the real morning + evening times.
  adminMode = true;
  r = await call({ date: tue, service: "classic-facial", type: "after" });
  check("admin after times are the 6 after-hours slots", r.body.times.length, 6);
  check("admin after includes 7:00 AM", r.body.times.includes("7:00 AM"), true);
  check("admin after includes 7:00 PM", r.body.times.includes("7:00 PM"), true);
  check("admin after status 200", r.statusCode, 200);

  // 3. Regular hours are unchanged for both sides.
  adminMode = false;
  const regAnon = await call({ date: tue, service: "classic-facial", type: "regular" });
  adminMode = true;
  const regAdmin = await call({ date: tue, service: "classic-facial", type: "regular" });
  check("regular times identical for anon and admin", regAnon.body.times, regAdmin.body.times);
  check("regular times include 9:00 AM", regAdmin.body.times.includes("9:00 AM"), true);

  // 4. Sundays stay closed even for the admin.
  r = await call({ date: sun, service: "classic-facial", type: "after" });
  check("admin after Sunday is empty", r.body.times, []);
  r = await call({ date: sun, service: "classic-facial", type: "regular" });
  check("admin regular Sunday is empty", r.body.times, []);

  // 5. A consultation at after-hours gets the consultation request times.
  r = await call({ date: tue, service: "consultation", type: "after" });
  check("admin after consultation times are non-empty", r.body.times.length > 0, true);

  console.log(`test-availability-admin: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((err) => { console.error(err); process.exit(1); });
