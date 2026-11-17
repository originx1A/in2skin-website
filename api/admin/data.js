// GET /api/admin/data — the admin panel's reads, one function:
//   ?view=bookings (default) → the admin calendar (was /api/admin/bookings)
//   ?view=payments → today's payments at a glance (was /api/admin/payments)
// Signed in only. Merged because Vercel Hobby allows 12 serverless
// functions per deployment.
const { requireAdmin } = require("../../lib/auth");
const { listBookingsRange, listBookingsForDate, listPayments } = require("../../lib/bookings");
const { dateKey, money } = require("../../lib/schedule");

module.exports = async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  try {
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
        createdAt: b.createdAt,
      })),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
