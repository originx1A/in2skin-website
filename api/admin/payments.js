// GET /api/admin/payments?date=YYYY-MM-DD (default: today)
// — today's payments at a glance: completed pay-on-the-spot payments plus
// paid bookings for the day. Signed in only.
const { requireAdmin } = require("../../lib/auth");
const { listPayments, listBookingsForDate } = require("../../lib/bookings");
const { dateKey, money } = require("../../lib/schedule");

module.exports = async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  try {
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
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
