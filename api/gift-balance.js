// GET /api/gift-balance?code=IN2SKIN-XXXXXX — remaining balance, in cents.
const { getGift, normalizeGiftCode } = require("../lib/bookings");

module.exports = async (req, res) => {
  try {
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
    return res.status(err.status || 500).json({ error: err.message });
  }
};
