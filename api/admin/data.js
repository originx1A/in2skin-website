// GET /api/admin/data — the admin panel's reads, one function:
//   ?view=bookings (default) → the admin calendar (was /api/admin/bookings)
//   ?view=payments → today's payments at a glance (was /api/admin/payments)
//   ?view=transfer-hours → Sarah's call-answering hours + live status
//   ?view=referrals → every referrer: credit, free reflexology, who they referred
//   ?view=codes → every gift certificate + voucher: buyer, holder, balance, uses
// POST /api/admin/data { view:"transfer-hours", settings } → save call hours.
// POST /api/admin/data { view:"referrals", action:"create", name, email, phone }
//   → create a referral code for a walk-in client.
// POST /api/admin/data { view:"bookings", action:"complete"|"no-show", bookingId }
//   → mark a booking's outcome (complete voids a $0 voucher; no-show restores it).
// Signed in only. Merged because Vercel Hobby allows 12 serverless
// functions per deployment.
const { requireAdmin } = require("../../lib/auth");
const {
  listBookingsRange, listBookingsForDate, listPayments, listGifts,
  giftDisplayStatus, getBooking, markBookingOutcome,
} = require("../../lib/bookings");
const { dateKey, money } = require("../../lib/schedule");
const { getSettings, saveSettings, transferStatus } = require("../../lib/transfer");
const { listReferrals, getOrCreateReferral } = require("../../lib/referrals");

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
      if (b.view === "bookings" && (b.action === "complete" || b.action === "no-show") && b.bookingId) {
        const booking = await getBooking(b.bookingId);
        if (!booking) return res.status(404).json({ error: "Booking not found." });
        if (booking.status !== "paid" && booking.status !== "consultation") {
          return res.status(400).json({ error: "Only a paid or consultation booking can be marked complete or no-show." });
        }
        const updated = await markBookingOutcome(booking, b.action);
        return res.status(200).json({ booking: { id: updated.id, status: updated.status } });
      }
      return res.status(400).json({ error: "Nothing to save — send the call hours." });
    }
    if ((req.query || {}).view === "transfer-hours") {
      const settings = await getSettings();
      return res.status(200).json({ settings, status: transferStatus(settings) });
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
    if ((req.query || {}).view === "payments") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : dateKey(new Date());
      const spot = await listPayments(date, date);
      const bookings = (await listBookingsForDate(date)).filter((b) => b.status === "paid" || b.status === "consultation");
      const totalCents = spot.reduce((n, p) => n + (p.amountCents || 0), 0)
        + bookings.reduce((n, b) => n + (b.amountPaidCents || 0), 0);
      return res.status(200).json({
        date,
        totalCents,
        total: money(totalCents),
        paySpot: spot,
        bookings: bookings.map((b) => ({
          id: b.id, serviceName: b.serviceName, time: b.time, name: b.name,
          guestName: b.guestName, status: b.status, amountPaidCents: b.amountPaidCents,
          giftAppliedCents: b.giftAppliedCents,
        })),
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
      bookings: bookings.map((b) => ({
        id: b.id, serviceName: b.serviceName, date: b.date, time: b.time, type: b.type,
        name: b.name, phone: b.phone, email: b.email,
        guestName: b.guestName, guestPhone: b.guestPhone, guestEmail: b.guestEmail,
        status: b.status, amountCents: b.amountCents, amountPaidCents: b.amountPaidCents,
        giftCode: b.giftCode, giftAppliedCents: b.giftAppliedCents,
        referralCode: b.referralCode || null, referralAppliedCents: b.referralAppliedCents || 0,
        freeReflexologyApplied: !!b.freeReflexologyApplied,
        referredBy: b.referredBy || null, myReferralCode: b.myReferralCode || null,
        outcomeAt: b.outcomeAt || null,
        createdAt: b.createdAt,
      })),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
