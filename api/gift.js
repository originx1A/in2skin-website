// GET /api/gift — gift certificates, one function for both reads:
//   ?code=IN2SKIN-XXXXXX → remaining balance (was /api/gift-balance)
//   ?code=NAME-XXXX → a referral code: the referrer's credit + free
//     reflexology banked (the wizard shows it in the gift-code field)
//   ?session_id=... → after Stripe checkout, the issued code (was /api/gift-status)
// Merged because Vercel Hobby allows 12 serverless functions per deployment.
const { getStripe } = require("../lib/stripe");
const {
  getGift, ensureGiftCode, sendGiftCertificate, sendGiftReceipt, sendVoucherCertificate,
  certificateRecipient,
} = require("../lib/bookings");
const { getReferralByCode } = require("../lib/referrals");
const { checkLimit } = require("../lib/rate-limit");

module.exports = async (req, res) => {
  // 30 balance lookups per minute per IP — generous for real use, tight
  // enough that guessing gift codes (IN2SKIN-XXXXXX) is impractical.
  if (!(await checkLimit(req, res, { scope: "gift", limit: 30, windowSecs: 60 }))) return;
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
      // A future sendOn stays gated here too — the certificate goes out
      // ON that date via the dashboard-poll sweep, never early.
      if (gift.kind === "voucher") await sendVoucherCertificate(gift);
      else await sendGiftCertificate(gift);
      await sendGiftReceipt(gift);
      return res.status(200).json({
        paid: true,
        code: gift.code,
        amountCents: gift.originalCents,
        buyerName: gift.buyerName || "",
        buyerEmail: gift.buyerEmail || "",
        recipientName: gift.recipientName,
        recipientEmail: gift.recipientEmail,
        kind: gift.kind || "gift",
        voucherLabel: gift.voucherLabel || "",
        suggestedUseBy: gift.suggestedUseBy || null,
        // Where the certificate went / will go: print goes to the buyer,
        // a future sendOn waits for its date.
        delivery: gift.delivery || "email",
        sendOn: gift.sendOn || null,
        certificateTo: certificateRecipient(gift),
        certificateSent: !!gift.certificateSent,
      });
    }
    const gift = await getGift(req.query.code);
    if (gift) {
      return res.status(200).json({
        code: gift.code,
        balanceCents: gift.balanceCents,
        originalCents: gift.originalCents,
        recipientName: gift.recipientName || "",
        neverExpires: true,
      });
    }
    const ref = await getReferralByCode(req.query.code);
    if (ref) {
      return res.status(200).json({
        code: ref.code,
        referral: true,
        creditCents: ref.creditCents || 0,
        freeReflexology: ref.freeReflexology || 0,
        balanceCents: ref.creditCents || 0,
        neverExpires: true,
      });
    }
    return res.status(404).json({ error: "Code not found.", balanceCents: 0 });
  } catch (err) {
    console.error("[gift]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
