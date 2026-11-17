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
// POST /api/admin/data { view:"bookings", action:"complete"|"no-show", bookingId }
//   → mark a booking's outcome (complete voids a $0 voucher; no-show restores it).
// POST /api/admin/data { view:"bookings", action:"cancel", bookingId, reason }
//   → cancel an upcoming booking: frees the slot, restores gift/voucher +
//     referral value, emails the client.
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
//   → set the gap between appointments (0–120 min, default 30).
// POST /api/admin/data { view:"settings", action:"block-add", date, start, end, reason }
//   → block off part of a day (or a whole day) — stops new bookings there.
// POST /api/admin/data { view:"settings", action:"block-remove", id }
//   → remove a block.
// POST /api/admin/data { view:"messages", action:"read", id, read }
//   → mark a caller message read / unread.
// POST /api/admin/data { view:"messages", action:"delete", id }
//   → delete a caller message.
// Signed in only. Merged because Vercel Hobby allows 12 serverless
// functions per deployment.
const { requireAdmin } = require("../../lib/auth");
const {
  listBookingsRange, listBookingsForDate, listPayments, listGifts,
  giftDisplayStatus, getBooking, markBookingOutcome, saveBooking,
  cancelBooking, moveBooking, buildBooking, createBookingCheckout, createPayLink,
  sendBookingConfirmation, sendWalkInConfirmation, sendHoldEmail, finalizePaidBooking,
  balanceDue, recordPayment, newId, PHONE_DISPLAY,
} = require("../../lib/bookings");
const {
  dateKey, money, SERVICES, COMBOS, QUIET_PREMIUM_CENTS, FIRST_VISIT_CENTS,
  parseTime, durationFor, findService,
} = require("../../lib/schedule");
const { getSettings, saveSettings, transferStatus } = require("../../lib/transfer");
const { listReferrals, getOrCreateReferral, attendeeOf } = require("../../lib/referrals");
const {
  getBufferMins, setBufferMins, listBlocks, addBlock, removeBlock, studioForDate,
} = require("../../lib/studio");
const { listMessages, markMessageRead, deleteMessage } = require("../../lib/messages");
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

const UPCOMING = ["pending", "unpaid", "paid", "consultation"];

module.exports = async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method === "POST") {
      const b = req.body || {};
      if (b.view === "transfer-hours" && b.settings) {
        const settings = await saveSettings(b.settings);
        return res.status(200).json({ settings, status: transferStatus(settings) });
      }
      if (b.view === "referrals" && b.action === "create") {
        if (!b.name || !String(b.name).trim() || !b.email || !b.phone) {
          return res.status(400).json({ error: "Add the client's name, email and phone." });
        }
        const referral = await getOrCreateReferral({
          name: String(b.name).trim(), email: String(b.email).trim(), phone: String(b.phone).trim(),
        });
        return res.status(200).json({ referral });
      }
      if (b.view === "settings" && b.action === "buffer") {
        const bufferMins = await setBufferMins(b.bufferMins);
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
        return res.status(200).json({ block, overlapping });
      }
      if (b.view === "settings" && b.action === "block-remove") {
        const removed = await removeBlock(b.id);
        if (!removed) return res.status(404).json({ error: "That block is already gone." });
        return res.status(200).json({ ok: true });
      }
      if (b.view === "messages" && b.action === "read") {
        const ok = await markMessageRead(b.id, b.read !== false);
        if (!ok) return res.status(404).json({ error: "Message not found." });
        return res.status(200).json({ ok: true });
      }
      if (b.view === "messages" && b.action === "delete") {
        const ok = await deleteMessage(b.id);
        if (!ok) return res.status(404).json({ error: "Message not found." });
        return res.status(200).json({ ok: true });
      }
      if (b.view === "bookings" && b.action === "walk-in") {
        const payment = ["cash", "e-transfer", "pay-link", "later"].includes(b.payment) ? b.payment : "later";
        const { bufferMins, blocks } = await studioForDate(b.date);
        const booking = await buildBooking(b, { bufferMins, blocks, allowToday: true, via: "admin" });
        // $0 (consultation, or fully covered by a code): confirmed straight away.
        if (booking.amountCents === 0) {
          booking.status = booking.servicePriceLabel === "Custom" ? "consultation" : "paid";
          booking.amountPaidCents = 0;
          await saveBooking(booking);
          await finalizePaidBooking(booking);
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
          return res.status(200).json({ booking: publicBooking(booking), paid: false, checkoutUrl: checkout.url, emailed });
        }
        // Pay later: the appointment is real and holds the slot; the client
        // pays at the visit (cash, e-transfer, or card on their own phone).
        booking.status = "unpaid";
        booking.amountPaidCents = 0;
        await saveBooking(booking);
        const emailed = await sendWalkInConfirmation(booking);
        return res.status(200).json({ booking: publicBooking(booking), paid: false, emailed });
      }
      if (b.view === "bookings" && (b.action === "complete" || b.action === "no-show") && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!["paid", "consultation", "unpaid"].includes(booking.status)) {
          return res.status(400).json({ error: "Only a paid, consultation or unpaid booking can be marked complete or no-show." });
        }
        const updated = await markBookingOutcome(booking, b.action);
        return res.status(200).json({ booking: publicBooking(updated) });
      }
      if (b.view === "bookings" && b.action === "cancel" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!UPCOMING.includes(booking.status)) {
          return res.status(400).json({ error: "Only an upcoming booking can be cancelled." });
        }
        const { booking: updated, emailed } = await cancelBooking(booking, b.reason);
        return res.status(200).json({ booking: publicBooking(updated), emailed });
      }
      if (b.view === "bookings" && b.action === "move" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (!UPCOMING.includes(booking.status)) {
          return res.status(400).json({ error: "Only an upcoming booking can be moved." });
        }
        const { bufferMins, blocks } = await studioForDate(b.date);
        const { booking: updated, emailed } = await moveBooking(booking, {
          date: b.date, time: b.time, type: b.type, bufferMins, blocks,
        });
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
        return res.status(200).json({ booking: publicBooking(booking) });
      }
      if (b.view === "bookings" && b.action === "pay-link" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (["cancelled", "completed", "no-show"].includes(booking.status)) {
          return res.status(400).json({ error: "This booking is closed — a payment link can't be sent for it." });
        }
        if (booking.status === "pending" && booking.checkoutUrl) {
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
        return res.status(200).json({ url: out.url, paylinkId: out.id, emailed: true });
      }
      if (b.view === "bookings" && b.action === "resend-confirmation" && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        booking.emailSent = false;
        const emailed = await sendBookingConfirmation(booking);
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
