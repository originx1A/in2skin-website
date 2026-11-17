// GET /api/admin/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD
// (defaults: today through +30 days) — the admin calendar. Signed in only.
const { requireAdmin } = require("../../lib/auth");
const { listBookingsRange, listBookingsForDate } = require("../../lib/bookings");
const { dateKey } = require("../../lib/schedule");

module.exports = async (req, res) => {
  const session = await requireAdmin(req, res);
  if (!session) return;
  try {
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
