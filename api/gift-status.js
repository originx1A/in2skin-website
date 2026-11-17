// GET /api/gift-status?session_id=... — after Stripe checkout, return the
// issued gift code (creates it idempotently if the webhook has not run yet).
const { getStripe } = require("../lib/stripe");
const { kvGet } = require("../lib/kv");
const { ensureGiftCode, sendGiftCertificate, sendGiftReceipt } = require("../lib/bookings");

module.exports = async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session." });
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(200).json({ paid: false });
    }
    const gift = await ensureGiftCode(session);
    // Make sure the emails went out even if the webhook was delayed.
    await sendGiftCertificate(gift);
    await sendGiftReceipt(gift);
    return res.status(200).json({
      paid: true,
      code: gift.code,
      amountCents: gift.originalCents,
      recipientName: gift.recipientName,
      recipientEmail: gift.recipientEmail,
    });
  } catch (err) {
    console.error("[gift-status]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
