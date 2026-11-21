// Push notifications + the recent-events feed for the studio dashboard
// (Tony Nov 19, 2026): a pop-up on the studio's phone + a counter on the
// dashboard icon when a booking, payment, or caller message lands —
// even with the dashboard closed. Web Push (VAPID) via the `web-push`
// package; the dashboard subscribes from the browser and the server
// sends to every stored subscription.
//
// Fail-open everywhere: no VAPID keys, no subscriptions, a dead
// endpoint, or a push error never breaks a booking, a message, an
// email, or the dashboard. The events feed is the same store the
// dashboard polls while it is open (chime + banner), so the two paths
// can never disagree about what is new.
const { kvGet, kvSet } = require("./kv");

const SUBS_KEY = "push:subs";
const EVENTS_KEY = "events:recent";
const EVENTS_MAX = 50;
const SUBS_MAX = 10;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:bookings@boltonfacials.com";

let webpush = null;
let webPushError = null;
try {
  webpush = require("web-push");
} catch (e) {
  // Optional dependency — without it, push is simply off.
  // The message is kept (not a secret) so the live diagnostic can say
  // WHY it failed instead of just that it did.
  webPushError = e && e.message ? String(e.message) : String(e);
}

function configured() {
  return Boolean(
    webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Diagnostic only — booleans, never values. The dashboard showed
// pushConfigured false even with a public key live (Nov 19, 2026), so
// the counts endpoint reports which of the three parts is missing:
// the public key, the private key, or the web-push module itself.
function detail() {
  return {
    hasPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY),
    hasPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
    hasWebPush: Boolean(webpush),
    webPushError,
  };
}

async function listSubs() {
  return (await kvGet(SUBS_KEY)) || [];
}

async function addSub(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint) return false;
  if (!sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") return false;
  const subs = await listSubs();
  const next = subs.filter((s) => s.endpoint !== sub.endpoint);
  next.unshift({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    createdAt: new Date().toISOString(),
  });
  await kvSet(SUBS_KEY, next.slice(0, SUBS_MAX));
  return true;
}

async function removeSub(endpoint) {
  if (!endpoint) return false;
  const subs = await listSubs();
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length === subs.length) return false;
  await kvSet(SUBS_KEY, next);
  return true;
}

async function listEvents() {
  return (await kvGet(EVENTS_KEY)) || [];
}

async function recordEvent(event) {
  const record = {
    id: "ev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    type: String(event.type || "info").slice(0, 20),
    title: String(event.title || "In2Skin").slice(0, 100),
    body: String(event.body || "").slice(0, 200),
    at: new Date().toISOString(),
  };
  const events = await listEvents();
  events.unshift(record);
  await kvSet(EVENTS_KEY, events.slice(0, EVENTS_MAX));
  return record;
}

function listEventsSince(events, since) {
  if (!since || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(since)) return [];
  return events.filter((e) => (e.at || "") > since).slice(0, 10);
}

// The badge number for a closed dashboard: unread caller messages +
// today's events (bookings, payments, messages). The open dashboard
// clears the badge itself and counts only new arrivals while open.
async function badgeCount() {
  try {
    const { listMessages } = require("./messages");
    const msgs = await listMessages();
    const unread = msgs.filter((m) => !m.read).length;
    const today = new Date().toISOString().slice(0, 10);
    const events = await listEvents();
    const todays = events.filter((e) => (e.at || "").slice(0, 10) === today).length;
    return unread + todays;
  } catch {
    return 0;
  }
}

async function sendPush(payload) {
  if (!configured()) return { sent: 0, removed: 0, configured: false };
  const subs = await listSubs();
  if (!subs.length) return { sent: 0, removed: 0, configured: true };
  webpush.setVapidDetails(SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s, JSON.stringify(payload)))
  );
  const dead = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const code = r.reason && r.reason.statusCode;
      if (code === 410 || code === 404) dead.push(subs[i].endpoint);
      else console.error("[push] send failed:", r.reason && r.reason.message);
    }
  });
  for (const ep of dead) {
    try {
      await removeSub(ep);
    } catch {
      /* best-effort cleanup */
    }
  }
  return {
    sent: results.filter((r) => r.status === "fulfilled").length,
    removed: dead.length,
    configured: true,
  };
}

// Record the event for the dashboard poll, then push it to every
// subscribed phone. Never throws — callers must not care.
async function notifyPush(event) {
  try {
    const record = await recordEvent(event);
    const badge = await badgeCount();
    await sendPush({
      title: event.title,
      body: event.body,
      badge,
      url: "/admin/dashboard.html",
    });
    return record;
  } catch (e) {
    console.error("[push]", e.message);
    return null;
  }
}

module.exports = {
  SUBS_KEY,
  EVENTS_KEY,
  configured,
  publicKey,
  detail,
  listSubs,
  addSub,
  removeSub,
  listEvents,
  recordEvent,
  listEventsSince,
  badgeCount,
  sendPush,
  notifyPush,
};
