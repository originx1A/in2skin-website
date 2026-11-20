// POST /api/stripe-webhook — verify the Stripe signature, then:
//   booking checkout -> mark the booking paid, deduct any gift balance once,
//                      send the confirmation email.
//   gift checkout    -> issue the gift code, email the certificate + receipt.
//   pay-spot link    -> mark the pay link paid, record the payment.
// Raw body is required for signature verification.
const { getStripe } = require("../lib/stripe");
const {
  getBooking, finalizePaidBooking, markPaylinkPaid, markBookingCheckoutPaid,
  ensureGiftCode, sendGiftCertificate, sendGiftReceipt, sendVoucherCertificate,
} = require("../lib/bookings");

module.exports = async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not set." });

  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const meta = session.metadata || {};
      if (meta.type === "booking" && meta.bookingId) {
        const booking = await getBooking(meta.bookingId);
        // Deposit model (Tony Nov 19, 2026): the checkout paid the $30
        // deposit (or the full $30 consultation, or the full amount when
        // Sarah waived the deposit). The shared helper applies it — the
        // status-page fallback replays the same step, idempotently.
        if (booking) await markBookingCheckoutPaid(booking, session);
        if (booking) await finalizePaidBooking(booking);
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
