// Push alerts + chime feed tests (Tony Nov 19, 2026): subscriptions,
// events, badge counts, the counts view, and the transfer-status hook.
// Run: node scripts/test-push.js
// Uses an in-memory KV stub + stubbed web-push/auth (no KV/Resend needed).
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
// --- web-push stub: records sends; endpoints with "dead" in them 410 ---
const pushCalls = [];
const webpushPath = require.resolve("web-push");
require.cache[webpushPath] = {
  exports: {
    setVapidDetails: () => {},
    sendNotification: async (sub) => {
      pushCalls.push(sub.endpoint);
      if (String(sub.endpoint).includes("dead")) {
        const e = new Error("gone");
        e.statusCode = 410;
        throw e;
      }
    },
  },
};
// --- admin auth stub ---
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = {
  exports: {
    requireAdmin: async () => ({ email: "sarah@test.example" }),
    adminEmails: () => ["sarah@test.example", "tony@test.example"],
  },
};

delete process.env.RESEND_API_KEY;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.AGENT_API_KEY = "test-agent-key";

const push = require("../lib/push");
const messagesLib = require("../lib/messages");
const dataHandler = require("../api/admin/data");
const transferStatusHandler = require("../api/transfer-status");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL:", name, "\n  got:     ", JSON.stringify(got), "\n  expected:", JSON.stringify(want)); }
  return ok;
}
function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
function mockReq({ method = "GET", headers = {}, body = null, query = {} } = {}) {
  return { method, headers, body, query };
}
async function callAdmin(body, query = {}) {
  const res = mockRes();
  await dataHandler(mockReq({ method: body ? "POST" : "GET", body, query }), res);
  return res;
}
function sub(endpoint) {
  return { endpoint, keys: { p256dh: "p256dh-" + endpoint, auth: "auth-" + endpoint } };
}

(async () => {
  // --- configured() follows the env keys ---
  check("not configured without keys", push.configured(), false);
  check("publicKey null without keys", push.publicKey(), null);
  process.env.VAPID_PUBLIC_KEY = "BPUBLIC_TEST";
  process.env.VAPID_PRIVATE_KEY = "PRIVATE_TEST";
  check("configured with keys", push.configured(), true);
  check("publicKey returns key", push.publicKey(), "BPUBLIC_TEST");

  // --- subscriptions: add, dedupe, cap, remove ---
  check("addSub valid", await push.addSub(sub("https://push.test/one")), true);
  check("addSub same endpoint dedupes", await push.addSub(sub("https://push.test/one")), true);
  check("one sub stored after dedupe", (await push.listSubs()).length, 1);
  check("addSub bad keys rejected", await push.addSub({ endpoint: "https://push.test/bad", keys: {} }), false);
  check("addSub no endpoint rejected", await push.addSub({ keys: { p256dh: "x", auth: "y" } }), false);
  check("removeSub missing is false", await push.removeSub("https://push.test/nope"), false);
  check("removeSub works", await push.removeSub("https://push.test/one"), true);
  check("subs empty after remove", (await push.listSubs()).length, 0);
  for (let i = 0; i < 12; i++) await push.addSub(sub("https://push.test/s" + i));
  check("subs capped at 10", (await push.listSubs()).length, 10);
  await push.removeSub("https://push.test/s11");
  check("subs back to 9", (await push.listSubs()).length, 9);
  mem.delete(push.SUBS_KEY);

  // --- events: record, cap, since-filter ---
  const e1 = await push.recordEvent({ type: "booking", title: "New booking", body: "Classic Facial — Alex" });
  check("recordEvent keeps title", e1.title, "New booking");
  check("recordEvent keeps type", e1.type, "booking");
  await push.recordEvent({ type: "paid", title: "Booking paid", body: "$85 — Classic" });
  const all = await push.listEvents();
  check("events newest first", all[0].title, "Booking paid");
  check("eventsSince past returns all", push.listEventsSince(all, "2000-01-01T00:00").length, 2);
  check("eventsSince future returns none", push.listEventsSince(all, "2999-01-01T00:00").length, 0);
  check("eventsSince garbage returns none", push.listEventsSince(all, "not-a-date").length, 0);
  for (let i = 0; i < 55; i++) await push.recordEvent({ type: "booking", title: "B" + i, body: "" });
  check("events capped at 50", (await push.listEvents()).length, 50);
  mem.delete(push.EVENTS_KEY);

  // --- badge: unread messages + today's events ---
  const m1 = await messagesLib.saveMessage({ name: "A", phone: "111", reason: "hi" });
  await messagesLib.saveMessage({ name: "B", phone: "222", reason: "hi" });
  const m3 = await messagesLib.saveMessage({ name: "C", phone: "333", reason: "hi" });
  await messagesLib.markMessageRead(m3.id, true);
  await push.recordEvent({ type: "booking", title: "New booking", body: "x" });
  check("badge = 2 unread + 1 event", await push.badgeCount(), 3);
  check("unread messages still 2", (await messagesLib.listMessages()).filter((m) => !m.read).length, 2);

  // --- sendPush: sends, drops dead endpoints, no-op unconfigured ---
  pushCalls.length = 0;
  await push.addSub(sub("https://push.test/good"));
  await push.addSub(sub("https://push.test/dead-one"));
  const out = await push.sendPush({ title: "T", body: "B", badge: 1 });
  check("sendPush sent 1", out.sent, 1);
  check("sendPush removed 1 dead", out.removed, 1);
  check("dead sub gone from store", (await push.listSubs()).map((s) => s.endpoint), ["https://push.test/good"]);
  check("pushCalls saw both endpoints", pushCalls.length, 2);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  check("sendPush unconfigured sends 0", (await push.sendPush({ title: "T", body: "B" })).sent, 0);
  process.env.VAPID_PUBLIC_KEY = "BPUBLIC_TEST";
  process.env.VAPID_PRIVATE_KEY = "PRIVATE_TEST";

  // --- notifyPush records the event and pushes it ---
  pushCalls.length = 0;
  mem.delete(push.EVENTS_KEY);
  const rec = await push.notifyPush({ type: "booking", title: "New booking", body: "Classic — Dana" });
  check("notifyPush returns the record", rec && rec.title, "New booking");
  check("notifyPush recorded 1 event", (await push.listEvents()).length, 1);
  check("notifyPush pushed to the sub", pushCalls, ["https://push.test/good"]);

  // --- counts view: unread + events + push state ---
  let res = await callAdmin(null, { view: "counts", since: "2000-01-01T00:00" });
  check("counts 200", res.statusCode, 200);
  check("counts unreadMessages", res.body.unreadMessages, 2);
  check("counts events since past", res.body.events.length, 1);
  check("counts pushConfigured", res.body.pushConfigured, true);
  check("counts vapidPublicKey", res.body.vapidPublicKey, "BPUBLIC_TEST");
  res = await callAdmin(null, { view: "counts", since: "2999-01-01T00:00" });
  check("counts future since has no events", res.body.events.length, 0);

  // --- push subscribe / test / unsubscribe through data.js ---
  mem.delete(push.SUBS_KEY);
  res = await callAdmin({ view: "push", action: "subscribe", subscription: sub("https://push.test/dash") });
  check("push subscribe 200", res.statusCode, 200);
  check("push subscribe ok", res.body.ok, true);
  pushCalls.length = 0;
  res = await callAdmin({ view: "push", action: "test" });
  check("push test 200", res.statusCode, 200);
  check("push test sent 1", res.body.sent, 1);
  res = await callAdmin({ view: "push", action: "unsubscribe", endpoint: "https://push.test/dash" });
  check("push unsubscribe 200", res.statusCode, 200);
  check("subs empty after unsubscribe", (await push.listSubs()).length, 0);
  res = await callAdmin({ view: "push", action: "subscribe", subscription: { endpoint: "x" } });
  check("push subscribe bad sub is 400", res.statusCode, 400);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  res = await callAdmin({ view: "push", action: "subscribe", subscription: sub("https://push.test/dash") });
  check("push subscribe unconfigured is 503", res.statusCode, 503);
  res = await callAdmin({ view: "push", action: "test" });
  check("push test unconfigured is 503", res.statusCode, 503);
  process.env.VAPID_PUBLIC_KEY = "BPUBLIC_TEST";
  process.env.VAPID_PRIVATE_KEY = "PRIVATE_TEST";

  // --- transfer-status hook: a caller message records an event + pushes ---
  pushCalls.length = 0;
  mem.delete(push.EVENTS_KEY);
  await push.addSub(sub("https://push.test/phone"));
  const tr = mockRes();
  await transferStatusHandler(
    mockReq({
      method: "POST",
      headers: { "x-agent-key": "test-agent-key" },
      body: { name: "Robin", phone: "4165550100", reason: "Wants a facial", callId: "call_1" },
    }),
    tr
  );
  check("transfer-status 200", tr.statusCode, 200);
  check("transfer-status saved the message", (await messagesLib.listMessages()).some((m) => m.name === "Robin"), true);
  const evs = await push.listEvents();
  check("transfer-status recorded a message event", evs.length, 1);
  check("transfer-status event title", evs[0].title, "New message from a caller");
  check("transfer-status pushed to the phone", pushCalls, ["https://push.test/phone"]);

  // --- dashboard + service worker carry the feature ---
  const dash = fs.readFileSync(path.join(__dirname, "..", "admin", "dashboard.html"), "utf8");
  for (const marker of ["alertEnable", "alertTest", "alertOff", "chimeToggle", "alertBanner", "checkAlerts", "playChime", "setAppBadge", "/admin/sw.js", "view=counts", "view:\"push\""]) {
    check("dashboard contains " + marker, dash.includes(marker), true);
  }
  const sw = fs.readFileSync(path.join(__dirname, "..", "admin", "sw.js"), "utf8");
  for (const marker of ['addEventListener("push"', 'addEventListener("notificationclick"', "showNotification", "setAppBadge", "/admin/dashboard.html"]) {
    check("sw.js contains " + marker, sw.includes(marker), true);
  }

  console.log(`\ntest-push: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("test-push crashed:", e);
  process.exit(1);
});
