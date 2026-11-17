// GET /api/gift — gift certificates, one function for both reads:
//   ?code=IN2SKIN-XXXXXX → remaining balance (was /api/gift-balance)
//   ?session_id=... → after Stripe checkout, the issued code (was /api/gift-status)
// Merged because Vercel Hobby allows 12 serverless functions per deployment.
const { getStripe } = require("../lib/stripe");
const {
  getGift, ensureGiftCode, sendGiftCertificate, sendGiftReceipt,
} = require("../lib/bookings");

module.exports = async (req, res) => {
  try {
    if (req.query.session_id) {
      const sessionId = req.query.session_id;
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
    }
    const gift = await getGift(req.query.code);
    if (!gift) return res.status(404).json({ error: "Code not found.", balanceCents: 0 });
    return res.status(200).json({
      code: gift.code,
      balanceCents: gift.balanceCents,
      originalCents: gift.originalCents,
      recipientName: gift.recipientName || "",
      neverExpires: true,
    });
  } catch (err) {
    console.error("[gift]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
