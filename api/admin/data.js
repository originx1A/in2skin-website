// GET /api/admin/data — the admin panel's reads, one function:
//   ?view=bookings (default) → the admin calendar (was /api/admin/bookings)
//   ?view=payments → today's payments at a glance (was /api/admin/payments)
//   ?view=transfer-hours → Sarah's call-answering hours + live status
//   ?view=referrals → every referrer: credit, free reflexology, who they referred
//   ?view=codes → every gift certificate + voucher: buyer, holder, balance, uses
//   ?view=settings → studio settings: gap between appointments + blocked-off time
//   ?view=catalog → service + combo catalog for the walk-in form
//   ?view=reports → per-client history + totals for a date range
//   ?view=messages → caller messages taken by the voice agent (newest first)
// POST /api/admin/data { view:"transfer-hours", settings } → save call hours.
// POST /api/admin/data { view:"referrals", action:"create", name, email, phone }
//   → create a referral code for a walk-in client.
// POST /api/admin/data { view:"referrals", action:"delete", code }
//   → delete a referral code for good (record, ref:all entry, email/phone
//     indexes). Any credit or banked free reflexology on it is gone.
//     BACKUP FIRST (Tony Nov 19, 2026): the record is saved into the
//     deleted-items archive before it is removed — the archive rides in
//     every full backup download and weekly backup email.
// POST /api/admin/data { view:"codes", action:"delete", code }
//   → delete a gift certificate / voucher for good. BACKUP FIRST, same
//     rule as referrals — the record is archived before it is removed.
// POST /api/admin/data { view:"payments", action:"delete", paymentId }
//   → delete a pay-on-the-spot payment record for good. BACKUP FIRST,
//     same rule. Booking-linked payments are refused here — they are the
//     audit trail for money already in a booking; delete or cancel the
//     booking from the calendar instead.
// POST /api/admin/data { view:"bookings", action:"complete"|"no-show", bookingId }
//   → mark a booking's outcome (complete voids a $0 voucher; no-show restores it).
// POST /api/admin/data { view:"bookings", action:"cancel", bookingId, reason }
//   → cancel an upcoming booking: frees the slot, restores gift/voucher +
//     referral value, emails the client.
// POST /api/admin/data { view:"bookings", action:"delete", bookingId }
//   → delete a booking for good (test bookings, unneeded ones). Removes the
//     record + its day index; gift/voucher codes and referral credits are
//     left alone (a cancelled booking already restored them).
// POST /api/admin/data { view:"bookings", action:"move", bookingId, date, time, type }
//   → move a booking to a free slot (same slot rules as a new booking);
//     Regular ↔ Private Hours changes the total by $15 (balance due / overpaid).
// POST /api/admin/data { view:"bookings", action:"walk-in", ...fields, payment }
//   → Sarah books a client herself. payment: "cash" | "e-transfer" |
//     "pay-link" (Stripe checkout link) | "later" (pay at the visit).
// POST /api/admin/data { view:"bookings", action:"record-payment", bookingId, amountCents, method }
//   → record cash / e-transfer / card received against a booking.
// POST /api/admin/data { view:"bookings", action:"set-amount", bookingId, amountCents, note }
//   → change the amount owed (e.g. the exact peel price set at consultation).
// POST /api/admin/data { view:"bookings", action:"pay-link", bookingId }
//   → send a fresh card pay link for the balance due (or resend the live
//     checkout link on a pending booking).
// POST /api/admin/data { view:"bookings", action:"resend-confirmation", bookingId }
//   → send the confirmation email again.
// POST /api/admin/data { view:"bookings", action:"email-client", bookingId, subject, message }
//   → send the client a short custom note.
// POST /api/admin/data { view:"settings", action:"buffer", bufferMins }
//   → set the gap between appointments (60–120 min, default 60).
// POST /api/admin/data { view:"settings", action:"block-add", date, start, end, reason }
//   → block off part of a day (or a whole day) — stops new bookings there.
// POST /api/admin/data { view:"settings", action:"block-remove", id }
//   → remove a block.
// POST /api/admin/data { view:"messages", action:"read", id, read }
//   → mark a caller message read / unread.
// POST /api/admin/data { view:"messages", action:"delete", id }
//   → delete a caller message.
// GET /api/admin/data ?view=counts&since=<ISO>
//   → what is new since `since`: unread caller messages + recent
//     events (bookings, payments, messages), for the dashboard chime,
//     banner, and icon badge; also carries the push setup state and the
//     finish checks due right now (appointments an hour in, awaiting
//     Sarah's "Done" / "Not yet").
// POST /api/admin/data { view:"finish-check", action:"notify"|"done"|"snooze", bookingId }
//   → the finish check (Tony Nov 19, 2026): "notify" fires the pop-up
//     once for a due check; "done" marks the appointment finished (the
//     room is free from now, so the next slot opens an hour from this
//     minute); "snooze" asks again in 15 minutes.
// POST /api/admin/data { view:"push", action:"subscribe", subscription }
//   → store this phone's Web Push subscription (pop-up alerts on).
// POST /api/admin/data { view:"push", action:"unsubscribe", endpoint }
//   → drop a stored subscription (pop-up alerts off).
// POST /api/admin/data { view:"push", action:"test" }
//   → send a test pop-up to every subscribed phone.
// POST /api/admin/data { view:"codes", action:"delete", code }
//   → delete a gift certificate / voucher for good (record, index entry,
//     checkout-session link). The remaining balance is gone.
// Signed in only. Merged because Vercel Hobby allows 12 serverless
// functions per deployment.
const { requireAdmin, adminEmails } = require("../../lib/auth");
const { pipeline, kvGet, kvSet, kvDel } = require("../../lib/kv");
const {
  listBookingsRange, listBookingsForDate, listPayments, listGifts, deleteGift, getGift,
  giftDisplayStatus, getBooking, markBookingOutcome, saveBooking,
  cancelBooking, moveBooking, deleteBooking, buildBooking, createBookingCheckout, createPayLink,
  sendBookingConfirmation, sendWalkInConfirmation, sendHoldEmail, finalizePaidBooking,
  balanceDue, recordPayment, getPayment, deletePayment, newId, PHONE_DISPLAY,
  dueFinishChecks, notifyFinishCheck, markFinishDone, snoozeFinishCheck,
} = require("../../lib/bookings");
const {
  dateKey, money, SERVICES, COMBOS, QUIET_PREMIUM_CENTS, FIRST_VISIT_CENTS,
  parseTime, durationFor, findService,
} = require("../../lib/schedule");
const { getSettings, saveSettings, transferStatus } = require("../../lib/transfer");
const { listReferrals, getOrCreateReferral, getReferralByCode, deleteReferral, normalizeReferralCode, attendeeOf } = require("../../lib/referrals");
const {
  getBufferMins, setBufferMins, listBlocks, addBlock, removeBlock, studioForDate,
} = require("../../lib/studio");
const { listMessages, markMessageRead, deleteMessage } = require("../../lib/messages");
const {
  configured: pushConfigured, publicKey: pushPublicKey, addSub, removeSub,
  listEvents, listEventsSince, badgeCount, sendPush,
} = require("../../lib/push");
const { sendEmail } = require("../../lib/email");

function publicBooking(b) {
  return {
    id: b.id, serviceName: b.serviceName, service: b.service, date: b.date, time: b.time, type: b.type,
    name: b.name, phone: b.phone, email: b.email,
    guestName: b.guestName, guestPhone: b.guestPhone, guestEmail: b.guestEmail,
    status: b.status, amountCents: b.amountCents, amountPaidCents: b.amountPaidCents,
    balanceDueCents: balanceDue(b),
    paymentMethod: b.paymentMethod || null, amountNote: b.amountNote || null,
    giftCode: b.giftCode, giftAppliedCents: b.giftAppliedCents,
    referralCode: b.referralCode || null, referralAppliedCents: b.referralAppliedCents || 0,
    freeReflexologyApplied: !!b.freeReflexologyApplied,
    referredBy: b.referredBy || null, myReferralCode: b.myReferralCode || null,
    outcomeAt: b.outcomeAt || null, cancelledAt: b.cancelledAt || null, cancelReason: b.cancelReason || null,
    checkoutUrl: b.checkoutUrl || null, paylinkId: b.paylinkId || null,
    via: b.via || null, createdAt: b.createdAt,
  };
}

function publicPayment(p) {
  return {
    id: p.id, kind: p.kind || "pay-spot", amountCents: p.amountCents,
    clientName: p.clientName || "", email: p.email || null,
    serviceLabel: p.serviceLabel || "", method: p.method || null,
    bookingId: p.bookingId || null, note: p.note || null,
    createdAt: p.createdAt || "",
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------------- audit log + backup (Nov 18, 2026) ---------------- */

const AUDIT_MAX = 500;

// Record one admin action. Never throws — the audit log must never break
// the action it records.
async function logAudit(session, action, details) {
  try {
    const id = newId("au");
    const entry = {
      id,
      at: new Date().toISOString(),
      by: (session && session.email) || "studio",
      action,
      details: String(details || "").slice(0, 300),
    };
    await kvSet(`audit:${id}`, entry);
    const all = (await kvGet("audit:all")) || [];
    all.unshift(id);
    if (all.length > AUDIT_MAX) {
      const dropped = all.splice(AUDIT_MAX);
      for (const oldId of dropped) {
        try { await kvDel(`audit:${oldId}`); } catch { /* best-effort trim */ }
      }
    }
    await kvSet("audit:all", all);
    return entry;
  } catch (err) {
    console.error("[audit]", err.message);
    return null;
  }
}

async function listAudit(limit) {
  const ids = ((await kvGet("audit:all")) || []).slice(0, limit || 100);
  const out = [];
  for (const id of ids) {
    const e = await kvGet(`audit:${id}`);
    if (e) out.push(e);
  }
  return out;
}

// Backup-before-delete (Tony Nov 19, 2026): a payment, gift code, or
// referral is only ever deleted AFTER a backup copy of the record exists.
// archiveDeleted saves the full record into the deleted-items archive
// (key backup:deleted, newest first, capped at 200 — the archive rides
// inside every full backup download and every weekly backup email, so a
// deleted record survives in the emailed backup even after it rolls out
// of the live archive). The delete handlers below call this FIRST and
// abort the delete if the archive write throws — fail closed, never lose
// a record. Bookings and caller messages do NOT need it (Tony's rule
// names payments, gift codes, and referrals only).
const DELETED_ARCHIVE_MAX = 200;

async function archiveDeleted(session, type, record) {
  const entry = {
    type,
    record,
    deletedAt: new Date().toISOString(),
    deletedBy: (session && session.email) || "studio",
  };
  const all = (await kvGet("backup:deleted")) || [];
  all.unshift(entry);
  await kvSet("backup:deleted", all.slice(0, DELETED_ARCHIVE_MAX));
  return entry;
}

async function listDeletedArchive() {
  return (await kvGet("backup:deleted")) || [];
}

// Delete gate (Tony Nov 19, 2026): nothing — no booking, message,
// payment, gift code, or referral — can be deleted until the first
// monthly backup email has gone out. The flag is set when a monthly
// backup is sent (the 1st-of-the-month cron, or the dashboard's
// send-now button). Every delete branch below checks this first.
async function monthlyBackupActive() {
  return !!(await kvGet("backup:lastMonthly"));
}
const DELETE_BLOCKED_MSG = "Monthly backup isn't active yet — deletions are paused until the first monthly backup email goes out. Use the Backup section to send it now.";

// Every booking, found by scanning the per-day indexes — a backup must not
// miss a booking just because it is older than some window. Falls back to
// a wide date range if SCAN is unavailable.
async function listAllBookings() {
  const seen = new Set();
  const out = [];
  try {
    let cursor = "0";
    do {
      const [[next, keys]] = await pipeline([["SCAN", cursor, "MATCH", "bookings:date:*", "COUNT", "100"]]);
      cursor = String(next);
      for (const key of keys || []) {
        const ids = (await kvGet(key)) || [];
        for (const id of ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          const b = await kvGet(`booking:${id}`);
          if (b) out.push(b);
        }
      }
    } while (cursor !== "0");
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.time || "").localeCompare(b.time || ""));
  } catch (err) {
    console.error("[backup] SCAN failed, falling back to date range:", err.message);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    return listBookingsRange("2026-01-01", to.toISOString().slice(0, 10));
  }
}

async function exportBackup() {
  const [bookings, gifts, payments, referrals, transferSettings, bufferMins, blocks, deleted] = await Promise.all([
    listAllBookings(),
    listGifts(),
    listPayments(null, null),
    listReferrals(),
    getSettings(),
    getBufferMins(),
    listBlocks(),
    listDeletedArchive(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    counts: {
      bookings: bookings.length,
      gifts: gifts.length,
      payments: payments.length,
      referrals: referrals.length,
      deleted: deleted.length,
    },
    bookings,
    gifts,
    payments,
    referrals,
    deleted,
    settings: { transfer: transferSettings, bufferMins, blocks },
  };
}

async function sendBackupEmail(backup, period) {
  const to = adminEmails();
  if (!to.length) return false;
  const label = period === "monthly" ? "monthly" : "weekly";
  const json = JSON.stringify(backup, null, 2);
  return sendEmail({
    to,
    subject: `In2Skin ${label} backup — ${backup.counts.bookings} bookings, ${backup.counts.gifts} gift codes (${backup.exportedAt.slice(0, 10)})`,
    html: `<p>In2Skin weekly backup — ${backup.exportedAt}.</p>`
      + `<p>Bookings: <strong>${backup.counts.bookings}</strong> · Gift codes: <strong>${backup.counts.gifts}</strong> · Payments: <strong>${backup.counts.payments}</strong> · Referrals: <strong>${backup.counts.referrals}</strong> · Deleted items backed up: <strong>${backup.counts.deleted || 0}</strong>.</p>`
      + `<p>The full backup is below as text — save it somewhere safe. You can also download the same file any time from the admin dashboard (Backup section).</p>`
      + `<pre style="font-size:11px; white-space:pre-wrap; word-break:break-all;">${json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
    text: `In2Skin weekly backup — ${backup.exportedAt}.\nBookings: ${backup.counts.bookings} · Gift codes: ${backup.counts.gifts} · Payments: ${backup.counts.payments} · Referrals: ${backup.counts.referrals} · Deleted items backed up: ${backup.counts.deleted || 0}.\n\n${json}`,
  });
}

const UPCOMING = ["pending", "unpaid", "paid", "consultation"];

module.exports = async (req, res) => {
  // Weekly + monthly backups, fired by the Vercel crons (vercel.json) — a
  // cron call carries no admin cookie, so it authenticates with the
  // CRON_SECRET env var, which Vercel sends as a Bearer token. Fail
  // CLOSED: without the secret set, or with the wrong token, nothing is
  // sent and nothing leaks. period=monthly runs on the 1st of the month
  // (Tony Nov 19, 2026); anything else is the weekly Monday run. A
  // successful send records backup:lastWeekly / backup:lastMonthly — the
  // monthly flag is the delete gate: nothing can be deleted until the
  // first monthly backup email has gone out (Tony Nov 19, 2026).
  if (req.method === "GET" && (req.query || {}).view === "backup" && (req.query || {}).cron === "1") {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: "CRON_SECRET is not set." });
    if (String(req.headers.authorization || "") !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Not authorized." });
    }
    try {
      const period = (req.query || {}).period === "monthly" ? "monthly" : "weekly";
      const backup = await exportBackup();
      const emailed = await sendBackupEmail(backup, period);
      if (emailed) await kvSet(period === "monthly" ? "backup:lastMonthly" : "backup:lastWeekly", backup.exportedAt);
      return res.status(200).json({ ok: true, emailed, period, counts: backup.counts, exportedAt: backup.exportedAt });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  const session = await requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method === "POST") {
      const b = req.body || {};
      // Send the monthly backup email now (Tony Nov 19, 2026) — activates
      // the monthly backup, which opens deletions (see the delete gate).
      if (b.view === "backup" && b.action === "send-monthly") {
        const backup = await exportBackup();
        const emailed = await sendBackupEmail(backup, "monthly");
        if (emailed) {
          await kvSet("backup:lastMonthly", backup.exportedAt);
          await logAudit(session, "backup.send-monthly", `monthly backup email sent (${backup.exportedAt.slice(0, 10)}) — deletions are open now`);
        }
        return res.status(200).json({ ok: true, emailed, exportedAt: backup.exportedAt });
      }
      if (b.view === "transfer-hours" && b.settings) {
        const settings = await saveSettings(b.settings);
        await logAudit(session, "settings.transfer-hours", "call hours saved");
        return res.status(200).json({ settings, status: transferStatus(settings) });
      }
      if (b.view === "referrals" && b.action === "create") {
        if (!b.name || !String(b.name).trim() || !b.email || !b.phone) {
          return res.status(400).json({ error: "Add the client's name, email and phone." });
        }
        const referral = await getOrCreateReferral({
          name: String(b.name).trim(), email: String(b.email).trim(), phone: String(b.phone).trim(),
        });
        await logAudit(session, "referrals.create", `code ${referral.code} for ${String(b.name).trim()}`);
        return res.status(200).json({ referral });
      }
      if (b.view === "referrals" && b.action === "delete") {
        if (!(await monthlyBackupActive())) return res.status(503).json({ error: DELETE_BLOCKED_MSG });
        const ref = await getReferralByCode(b.code);
        if (!ref) return res.status(404).json({ error: "That referral code is already gone." });
        // Backup first (Tony Nov 19, 2026) — the archive write must succeed
        // before anything is deleted; a throw here aborts the delete.
        await archiveDeleted(session, "referral", ref);
        const ok = await deleteReferral(b.code);
        if (!ok) return res.status(404).json({ error: "That referral code is already gone." });
        await logAudit(session, "referrals.delete", `code ${normalizeReferralCode(b.code)} deleted (backed up first)`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "settings" && b.action === "buffer") {
        const bufferMins = await setBufferMins(b.bufferMins);
        await logAudit(session, "settings.buffer", `gap between appointments set to ${bufferMins} minutes`);
        return res.status(200).json({ bufferMins });
      }
      if (b.view === "settings" && b.action === "block-add") {
        const block = await addBlock({ date: b.date, start: b.start, end: b.end, reason: b.reason });
        // Warn if bookings already sit inside the new block — they stay;
        // the block only stops NEW bookings there.
        const dayBookings = await listBookingsForDate(b.date);
        const overlapping = dayBookings.filter((x) => {
          if (["cancelled", "no-show"].includes(x.status)) return false;
          const s = parseTime(x.time);
          if (s == null) return false;
          const svc = findService(x.service);
          const dur = svc ? durationFor(svc) : 60;
          return s < block.endMin && block.startMin < s + dur;
        }).length;
        await logAudit(session, "settings.block-add", `${block.date} ${block.startLabel || ""}–${block.endLabel || ""}${block.reason ? " — " + block.reason : ""}`);
        return res.status(200).json({ block, overlapping });
      }
      if (b.view === "settings" && b.action === "block-remove") {
        const removed = await removeBlock(b.id);
        if (!removed) return res.status(404).json({ error: "That block is already gone." });
        await logAudit(session, "settings.block-remove", `block ${b.id}`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "messages" && b.action === "read") {
        const ok = await markMessageRead(b.id, b.read !== false);
        if (!ok) return res.status(404).json({ error: "Message not found." });
        await logAudit(session, "messages.read", `message ${b.id} marked ${b.read !== false ? "read" : "unread"}`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "messages" && b.action === "delete") {
        if (!(await monthlyBackupActive())) return res.status(503).json({ error: DELETE_BLOCKED_MSG });
        const ok = await deleteMessage(b.id);
        if (!ok) return res.status(404).json({ error: "Message not found." });
        await logAudit(session, "messages.delete", `message ${b.id} deleted`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "push" && b.action === "subscribe") {
        if (!pushConfigured()) return res.status(503).json({ error: "Pop-up alerts are not set up yet — the studio keys are missing." });
        const sub = b.subscription || {};
        if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
          return res.status(400).json({ error: "That subscription looks incomplete — try again from the dashboard." });
        }
        const ok = await addSub(sub);
        if (!ok) return res.status(400).json({ error: "That subscription could not be saved." });
        await logAudit(session, "push.subscribe", "pop-up alerts turned on for this device");
        return res.status(200).json({ ok: true });
      }
      if (b.view === "push" && b.action === "unsubscribe") {
        await removeSub(String(b.endpoint || ""));
        await logAudit(session, "push.unsubscribe", "pop-up alerts turned off for this device");
        return res.status(200).json({ ok: true });
      }
      if (b.view === "push" && b.action === "test") {
        if (!pushConfigured()) return res.status(503).json({ error: "Pop-up alerts are not set up yet — the studio keys are missing." });
        const out = await sendPush({
          title: "In2Skin — test pop-up",
          body: "Pop-ups are working. New bookings, payments, and caller messages will land here.",
          badge: await badgeCount(),
          url: "/admin/dashboard.html",
        });
        await logAudit(session, "push.test", `test pop-up sent to ${out.sent} device(s)`);
        return res.status(200).json({ ok: true, sent: out.sent });
      }
      if (b.view === "finish-check" && ["notify", "done", "snooze"].includes(b.action)) {
        const id = String(b.bookingId || "");
        if (!id) return res.status(400).json({ error: "Missing booking." });
        if (b.action === "notify") {
          const booking = await notifyFinishCheck(id);
          if (!booking) return res.status(200).json({ ok: true, notified: false });
          await logAudit(session, "finish-check.notify", `finish check pop-up sent — ${booking.serviceName} ${booking.date} ${booking.time}`);
          return res.status(200).json({ ok: true, notified: true });
        }
        if (b.action === "done") {
          const booking = await markFinishDone(id);
          if (!booking) return res.status(404).json({ error: "That appointment is already marked done, or it is gone." });
          await logAudit(session, "finish-check.done", `${booking.serviceName} — ${booking.date} ${booking.time} finished, room free`);
          return res.status(200).json({ ok: true, booking: publicBooking(booking) });
        }
        const booking = await snoozeFinishCheck(id);
        if (!booking) return res.status(404).json({ error: "That appointment is gone." });
        await logAudit(session, "finish-check.snooze", `${booking.serviceName} — ${booking.date} ${booking.time} not done yet, asking again in 15 minutes`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "codes" && b.action === "delete") {
        if (!(await monthlyBackupActive())) return res.status(503).json({ error: DELETE_BLOCKED_MSG });
        const gift = await getGift(b.code);
        if (!gift) return res.status(404).json({ error: "That code is already gone." });
        // Backup first (Tony Nov 19, 2026) — the archive write must succeed
        // before anything is deleted; a throw here aborts the delete.
        await archiveDeleted(session, "gift", gift);
        const ok = await deleteGift(b.code);
        if (!ok) return res.status(404).json({ error: "That code is already gone." });
        await logAudit(session, "codes.delete", `gift code ${b.code} deleted (backed up first)`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "payments" && b.action === "delete" && b.paymentId) {
        if (!(await monthlyBackupActive())) return res.status(503).json({ error: DELETE_BLOCKED_MSG });
        const payment = await getPayment(b.paymentId);
        if (!payment) return res.status(404).json({ error: "That payment is already gone." });
        if (payment.bookingId) {
          return res.status(400).json({ error: "That payment belongs to a booking — delete or cancel the booking from the calendar instead." });
        }
        // Backup first (Tony Nov 19, 2026) — the archive write must succeed
        // before anything is deleted; a throw here aborts the delete.
        await archiveDeleted(session, "payment", payment);
        const ok = await deletePayment(b.paymentId);
        if (!ok) return res.status(404).json({ error: "That payment is already gone." });
        await logAudit(session, "payments.delete", `payment ${money(payment.amountCents)} — ${payment.clientName || ""} deleted (backed up first)`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "bookings" && b.action === "walk-in") {
        const payment = ["cash", "e-transfer", "pay-link", "later"].includes(b.payment) ? b.payment : "later";
        const { bufferMins, blocks } = await studioForDate(b.date);
        const booking = await buildBooking(b, { bufferMins, blocks, allowToday: true, allowAddonMain: true, via: "admin" });
        // $0 (consultation, or fully covered by a code): confirmed straight away.
        if (booking.amountCents === 0) {
          booking.status = booking.servicePriceLabel === "Custom" ? "consultation" : "paid";
          booking.amountPaidCents = 0;
          await saveBooking(booking);
          await finalizePaidBooking(booking);
          await logAudit(session, "bookings.walk-in", `${booking.serviceName} — ${booking.date} ${booking.time} · no payment due`);
          return res.status(200).json({ booking: publicBooking(booking), paid: true });
        }
        if (payment === "cash" || payment === "e-transfer") {
          booking.status = "paid";
          booking.amountPaidCents = booking.amountCents;
          booking.paymentMethod = payment;
          await saveBooking(booking);
          await recordPayment({
            id: newId("pay"), kind: "booking", bookingId: booking.id,
            amountCents: booking.amountCents, clientName: booking.name,
            email: booking.email, serviceLabel: booking.serviceName,
            method: payment, createdAt: new Date().toISOString(),
          });
          await finalizePaidBooking(booking);
          await logAudit(session, "bookings.walk-in", `${booking.serviceName} — ${booking.date} ${booking.time} · paid ${payment}`);
          return res.status(200).json({ booking: publicBooking(booking), paid: true });
        }
        if (payment === "pay-link") {
          booking.status = "pending";
          booking.paymentMethod = "card";
          await saveBooking(booking);
          const checkout = await createBookingCheckout(booking);
          booking.checkoutSessionId = checkout.id;
          booking.checkoutUrl = checkout.url;
          await saveBooking(booking);
          const emailed = await sendHoldEmail(booking, checkout.url);
          await logAudit(session, "bookings.walk-in", `${booking.serviceName} — ${booking.date} ${booking.time} · card pay link sent`);
          return res.status(200).json({ booking: publicBooking(booking), paid: false, checkoutUrl: checkout.url, emailed });
        }
        // Pay later: the appointment is real and holds the slot; the client
        // pays at the visit (cash, e-transfer, or card on their own phone).
        booking.status = "unpaid";
        booking.amountPaidCents = 0;
        await saveBooking(booking);
        const emailed = await sendWalkInConfirmation(booking);
        await logAudit(session, "bookings.walk-in", `${booking.serviceName} — ${booking.date} ${booking.time} · pay at the visit`);
        return res.status(200).json({ booking: publicBooking(booking), paid: false, emailed });
      }
      if (b.view === "bookings" && (b.action === "complete" || b.action === "no-show") && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!["paid", "consultation", "unpaid"].includes(booking.status)) {
          return res.status(400).json({ error: "Only a paid, consultation or unpaid booking can be marked complete or no-show." });
        }
        const updated = await markBookingOutcome(booking, b.action);
        await logAudit(session, `bookings.${b.action}`, `${booking.serviceName} — ${booking.date} ${booking.time}`);
        return res.status(200).json({ booking: publicBooking(updated) });
      }
      if (b.view === "bookings" && b.action === "cancel" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!UPCOMING.includes(booking.status)) {
          return res.status(400).json({ error: "Only an upcoming booking can be cancelled." });
        }
        const { booking: updated, emailed } = await cancelBooking(booking, b.reason);
        await logAudit(session, "bookings.cancel", `${booking.serviceName} — ${booking.date} ${booking.time}${b.reason ? " — " + String(b.reason).slice(0, 100) : ""}`);
        return res.status(200).json({ booking: publicBooking(updated), emailed });
      }
      if (b.view === "bookings" && b.action === "delete" && b.bookingId) {
        if (!(await monthlyBackupActive())) return res.status(503).json({ error: DELETE_BLOCKED_MSG });
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        await deleteBooking(booking.id);
        await logAudit(session, "bookings.delete", `${booking.serviceName} — ${booking.date} ${booking.time} · ${booking.guestName || booking.name || ""} (${booking.status})`);
        return res.status(200).json({ ok: true });
      }
      if (b.view === "bookings" && b.action === "move" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!UPCOMING.includes(booking.status)) {
          return res.status(400).json({ error: "Only an upcoming booking can be moved." });
        }
        const { bufferMins, blocks } = await studioForDate(b.date);
        const oldWhen = booking.date + " " + booking.time;
        const { booking: updated, emailed } = await moveBooking(booking, {
          date: b.date, time: b.time, type: b.type, bufferMins, blocks,
        });
        await logAudit(session, "bookings.move", `${booking.serviceName} — ${oldWhen} → ${updated.date} ${updated.time}`);
        return res.status(200).json({ booking: publicBooking(updated), emailed });
      }
      if (b.view === "bookings" && b.action === "record-payment" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (booking.status === "pending") {
          return res.status(400).json({ error: "This booking still has a card payment link out — wait for it to be paid, or cancel it and book again." });
        }
        if (!["unpaid", "paid", "consultation"].includes(booking.status)) {
          return res.status(400).json({ error: "Payments can only be recorded on an upcoming or paid booking." });
        }
        const amountCents = Math.round(Number(b.amountCents));
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
          return res.status(400).json({ error: "Enter the amount received — $1 or more." });
        }
        const method = ["cash", "e-transfer", "card"].includes(b.method) ? b.method : "cash";
        booking.amountPaidCents = (booking.amountPaidCents || 0) + amountCents;
        booking.paymentMethod = method;
        await recordPayment({
          id: newId("pay"), kind: "booking", bookingId: booking.id,
          amountCents, clientName: booking.name, email: booking.email,
          serviceLabel: booking.serviceName, method,
          note: String(b.note || "").slice(0, 200),
          createdAt: new Date().toISOString(),
        });
        let finalized = false;
        if (booking.status === "unpaid" && booking.amountPaidCents >= (booking.amountCents || 0)) {
          booking.status = "paid";
          await finalizePaidBooking(booking);
          finalized = true;
        } else {
          await saveBooking(booking);
        }
        await logAudit(session, "bookings.record-payment", `${money(amountCents)} ${method} — ${booking.serviceName} ${booking.date} ${booking.time}`);
        return res.status(200).json({ booking: publicBooking(booking), paid: booking.status === "paid", finalized });
      }
      if (b.view === "bookings" && b.action === "set-amount" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (booking.status === "pending") {
          return res.status(400).json({ error: `This booking still has a card payment link out for ${money(booking.amountCents)} — cancel it and book again, or record the difference after they pay.` });
        }
        if (!["unpaid", "paid", "consultation"].includes(booking.status)) {
          return res.status(400).json({ error: "The amount can only be changed on an upcoming or paid booking." });
        }
        const amountCents = Math.round(Number(b.amountCents));
        if (!Number.isInteger(amountCents) || amountCents < 0) {
          return res.status(400).json({ error: "Enter the new amount owed — $0 or more." });
        }
        booking.amountCents = amountCents;
        if (b.note) booking.amountNote = String(b.note).slice(0, 200);
        booking.amountSetAt = new Date().toISOString();
        await saveBooking(booking);
        await logAudit(session, "bookings.set-amount", `${booking.serviceName} — ${booking.date} ${booking.time} · amount now ${money(amountCents)}${b.note ? " — " + String(b.note).slice(0, 100) : ""}`);
        return res.status(200).json({ booking: publicBooking(booking) });
      }
      if (b.view === "bookings" && b.action === "pay-link" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (["cancelled", "completed", "no-show"].includes(booking.status)) {
          return res.status(400).json({ error: "This booking is closed — a payment link can't be sent for it." });
        }
        if (booking.status === "pending" && booking.checkoutUrl) {
          await logAudit(session, "bookings.pay-link", `${booking.serviceName} — ${booking.date} ${booking.time} · card link resent`);
          return res.status(200).json({ url: booking.checkoutUrl, resent: true });
        }
        const due = balanceDue(booking);
        if (due <= 0) return res.status(400).json({ error: "Nothing is owed on this booking." });
        const who = attendeeOf(booking);
        const out = await createPayLink({
          amountCents: due, clientName: who.name || booking.name,
          contact: who.email || booking.email, method: "email",
          serviceLabel: `${booking.serviceName} — balance`, bookingId: booking.id,
        });
        booking.paylinkId = out.id;
        await saveBooking(booking);
        await logAudit(session, "bookings.pay-link", `${booking.serviceName} — ${booking.date} ${booking.time} · card link sent for ${money(due)}`);
        return res.status(200).json({ url: out.url, paylinkId: out.id, emailed: true });
      }
      if (b.view === "bookings" && b.action === "resend-confirmation" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        booking.emailSent = false;
        const emailed = await sendBookingConfirmation(booking);
        await logAudit(session, "bookings.resend-confirmation", `${booking.serviceName} — ${booking.date} ${booking.time}`);
        return res.status(200).json({ ok: true, emailed });
      }
      if (b.view === "bookings" && b.action === "email-client" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        const subject = String(b.subject || "").trim();
        const message = String(b.message || "").trim();
        if (!subject || !message) return res.status(400).json({ error: "Add a subject and a message." });
        if (subject.length > 200 || message.length > 4000) {
          return res.status(400).json({ error: "That message is too long — keep it under 4,000 characters." });
        }
        const who = attendeeOf(booking);
        const to = [booking.email];
        if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
        const emailed = await sendEmail({
          to,
          subject: subject.startsWith("In2Skin") ? subject : `In2Skin — ${subject}`,
          html: `<p>Hi ${escapeHtml(String(who.name || "").split(" ")[0] || "there")},</p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p><p>— In2Skin, Bolton<br/>${PHONE_DISPLAY}</p>`,
        });
        await logAudit(session, "bookings.email-client", `note to ${booking.email} — ${subject.slice(0, 100)}`);
        return res.status(200).json({ ok: true, emailed });
      }
      return res.status(400).json({ error: "Nothing to save — check the action and try again." });
    }
    if ((req.query || {}).view === "transfer-hours") {
      const settings = await getSettings();
      return res.status(200).json({ settings, status: transferStatus(settings) });
    }
    if ((req.query || {}).view === "settings") {
      const bufferMins = await getBufferMins();
      const blocks = await listBlocks();
      return res.status(200).json({ bufferMins, blocks });
    }
    if ((req.query || {}).view === "messages") {
      const messages = await listMessages();
      return res.status(200).json({ messages });
    }
    if ((req.query || {}).view === "counts") {
      const since = String((req.query || {}).since || "");
      const messages = await listMessages();
      const unreadMessages = messages.filter((m) => !m.read).length;
      const events = listEventsSince(await listEvents(), since);
      return res.status(200).json({
        unreadMessages,
        events,
        finishChecks: await dueFinishChecks(),
        badge: await badgeCount(),
        pushConfigured: pushConfigured(),
        vapidPublicKey: pushPublicKey(),
      });
    }
    if ((req.query || {}).view === "backup" && (req.query || {}).status === "1") {
      const lastMonthly = await kvGet("backup:lastMonthly");
      const lastWeekly = await kvGet("backup:lastWeekly");
      return res.status(200).json({ monthlyActive: !!lastMonthly, lastMonthly: lastMonthly || null, lastWeekly: lastWeekly || null });
    }
    if ((req.query || {}).view === "backup") {
      const backup = await exportBackup();
      return res.status(200).json(backup);
    }
    if ((req.query || {}).view === "audit") {
      const entries = await listAudit(100);
      return res.status(200).json({ entries });
    }
    if ((req.query || {}).view === "catalog") {
      return res.status(200).json({
        services: SERVICES, combos: COMBOS,
        quietPremiumCents: QUIET_PREMIUM_CENTS, firstVisitCents: FIRST_VISIT_CENTS,
      });
    }
    if ((req.query || {}).view === "referrals") {
      const refs = await listReferrals();
      return res.status(200).json({
        referrals: refs.map((r) => ({
          code: r.code, name: r.name, email: r.email, phone: r.phone,
          creditCents: r.creditCents || 0, creditUsedCents: r.creditUsedCents || 0,
          freeReflexology: r.freeReflexology || 0, paidCount: r.paidCount || 0,
          referred: r.referred || [], createdAt: r.createdAt,
        })),
      });
    }
    if ((req.query || {}).view === "codes") {
      const gifts = await listGifts();
      return res.status(200).json({
        codes: gifts.map((g) => ({
          code: g.code, kind: g.kind || "gift", status: giftDisplayStatus(g),
          buyerName: g.buyerName, buyerEmail: g.buyerEmail,
          recipientName: g.recipientName, recipientEmail: g.recipientEmail,
          holderName: g.holderName || g.recipientName || "",
          holderEmail: g.holderEmail || g.recipientEmail || "",
          voucherLabel: g.voucherLabel || "",
          originalCents: g.originalCents, balanceCents: g.balanceCents,
          uses: g.uses || [], createdAt: g.createdAt, suggestedUseBy: g.suggestedUseBy || null,
        })),
      });
    }
    if ((req.query || {}).view === "reports") {
      const { from, to } = req.query || {};
      const today = dateKey(new Date());
      const toStr = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : today;
      let fromStr = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : null;
      if (!fromStr) {
        const d = new Date(toStr + "T00:00:00");
        d.setDate(d.getDate() - 30);
        fromStr = dateKey(d);
      }
      const bookings = await listBookingsRange(fromStr, toStr);
      const payments = await listPayments(fromStr, toStr);
      // Per-client history, grouped by the attendee's email.
      const clientsMap = new Map();
      for (const bk of bookings) {
        const who = attendeeOf(bk);
        const key = (who.email || bk.email || "").toLowerCase();
        if (!key) continue;
        if (!clientsMap.has(key)) {
          clientsMap.set(key, {
            name: who.name || "", email: key, phone: who.phone || "",
            bookings: [], payments: [], totalOwedCents: 0, totalPaidCents: 0,
          });
        }
        const c = clientsMap.get(key);
        c.bookings.push(publicBooking(bk));
        c.totalOwedCents += bk.amountCents || 0;
        c.totalPaidCents += bk.amountPaidCents || 0;
        if (who.name && !c.name) c.name = who.name;
        if (who.phone && !c.phone) c.phone = who.phone;
      }
      const unlinked = [];
      for (const p of payments) {
        let key = null;
        if (p.bookingId) {
          const bk = bookings.find((x) => x.id === p.bookingId);
          if (bk) key = (attendeeOf(bk).email || bk.email || "").toLowerCase();
        }
        if (!key && p.email) key = String(p.email).toLowerCase();
        if (key && clientsMap.has(key)) clientsMap.get(key).payments.push(publicPayment(p));
        else unlinked.push(publicPayment(p));
      }
      const clients = [...clientsMap.values()].sort((a, b) => b.totalPaidCents - a.totalPaidCents);
      // Revenue collected: what bookings actually took in, plus pay-on-the-
      // spot payments that are NOT tied to a booking (a booking-linked one
      // is already counted through the booking's amountPaidCents — counting
      // it again would double it). Booking payment records are the audit
      // trail for the same money, so they are not added either.
      const revenueCollectedCents = bookings.reduce((n, bk) => n + (bk.amountPaidCents || 0), 0)
        + payments.filter((p) => p.kind === "pay-spot" && !p.bookingId).reduce((n, p) => n + (p.amountCents || 0), 0);
      const outstandingCents = bookings
        .filter((bk) => !["cancelled", "no-show"].includes(bk.status))
        .reduce((n, bk) => n + balanceDue(bk), 0);
      return res.status(200).json({
        from: fromStr, to: toStr,
        totals: {
          bookingsCount: bookings.length,
          completedCount: bookings.filter((bk) => bk.status === "completed").length,
          cancelledCount: bookings.filter((bk) => bk.status === "cancelled").length,
          noShowCount: bookings.filter((bk) => bk.status === "no-show").length,
          unpaidCount: bookings.filter((bk) => bk.status === "unpaid").length,
          clientsCount: clients.length,
          revenueCollectedCents, outstandingCents,
          revenueCollected: money(revenueCollectedCents), outstanding: money(outstandingCents),
        },
        clients,
        payments: payments.map(publicPayment),
        unlinkedPayments: unlinked,
      });
    }
    if ((req.query || {}).view === "payments") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : dateKey(new Date());
      const spot = await listPayments(date, date);
      const bookings = (await listBookingsForDate(date)).filter((b) => ["paid", "consultation", "unpaid"].includes(b.status));
      // Booking payment records are the audit trail for money already in a
      // booking's amountPaidCents — only pay-on-the-spot payments with no
      // booking add to the total, or the day's cash would count twice.
      const spotTotal = spot.filter((p) => !p.bookingId).reduce((n, p) => n + (p.amountCents || 0), 0);
      const totalCents = spotTotal
        + bookings.reduce((n, b) => n + (b.amountPaidCents || 0), 0);
      return res.status(200).json({
        date,
        totalCents,
        total: money(totalCents),
        paySpot: spot,
        bookings: bookings.map(publicBooking),
      });
    }
    const { from, to } = req.query || {};
    const today = dateKey(new Date());
    const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : today;
    let toStr = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : null;
    if (!toStr) {
      const d = new Date(fromStr + "T00:00:00");
      d.setDate(d.getDate() + 30);
      toStr = dateKey(d);
    }
    const bookings = await listBookingsRange(fromStr, toStr);
    return res.status(200).json({
      from: fromStr,
      to: toStr,
      bookings: bookings.map(publicBooking),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
