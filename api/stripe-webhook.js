// POST /api/stripe-webhook — verify the Stripe signature, then:
//   booking checkout -> a full payment marks the booking paid, a $30
//                      deposit marks it deposit-paid (balance due at the
//                      visit); gift balance deducted once, confirmation
//                      email sent. Referral credit waits for full payment.
//   gift checkout    -> issue the gift code, email the certificate + receipt.
//   pay-spot link    -> mark the pay link paid, record the payment.
// Raw body is required for signature verification.
const { getStripe } = require("../lib/stripe");
const {
  getBooking, settleBookingPayment, markPaylinkPaid,
  ensureGiftCode, sendGiftCertificate, sendGiftReceipt, sendVoucherCertificate,
} = require("../lib/bookings");

module.exports = async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not set." });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const sig = req.headers["stripe-signature"];

  // The site has ONE webhook URL for both Stripe accounts, but test and
  // live endpoints sign with DIFFERENT secrets. Try the live secret first,
  // then the test secret (STRIPE_WEBHOOK_SECRET_TEST). Live stays exactly
  // as before; test deliveries stop failing with "Invalid signature."
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_TEST].filter(Boolean);
  let event;
  let lastErr;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!event) {
    console.error("[webhook] signature verification failed:", lastErr && lastErr.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata || {};
      if (meta.type === "booking" && meta.bookingId) {
        const booking = await getBooking(meta.bookingId);
        // One shared settle step (also used by the GET fallback): a full
        // payment flips the booking to paid; a $30 deposit flips it to
        // deposit-paid with a balance due at the visit.
        if (booking) await settleBookingPayment(booking, session);
      } else if (meta.type === "gift") {
        const gift = await ensureGiftCode(session);
        if (gift.kind === "voucher") await sendVoucherCertificate(gift);
        else await sendGiftCertificate(gift);
        await sendGiftReceipt(gift);
      } else if (meta.type === "payspot" && meta.paylinkId) {
        // Shared with the GET fallback in /api/pay — see markPaylinkPaid
        // in lib/bookings.js. The fallback replays the same step when the
        // webhook never fires; either order is safe (idempotent per session).
        await markPaylinkPaid(session);
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[webhook] handler error:", err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
