// GET /api/pay-link?id=... — what /pay.html fetches: the Stripe payment
// link for a pay-on-the-spot record, plus the amount and what it is for.
const { kvGet } = require("../lib/kv");

module.exports = async (req, res) => {
  try {
    const rec = await kvGet(`paylink:${req.query.id}`);
    if (!rec) return res.status(404).json({ error: "Payment link not found." });
    return res.status(200).json({
      id: rec.id,
      stripeUrl: rec.stripeUrl || null,
      amountCents: rec.amountCents,
      dueCents: rec.dueCents,
      serviceLabel: rec.serviceLabel,
      clientName: rec.clientName,
      paid: !!rec.paid,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
