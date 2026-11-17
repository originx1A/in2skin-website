// POST /api/stripe-webhook — verify the Stripe signature, then:
//   booking checkout -> mark the booking paid, deduct any gift balance once,
//                      send the confirmation email.
//   gift checkout    -> issue the gift code, email the certificate + receipt.
//   pay-spot link    -> mark the pay link paid, record the payment.
// Raw body is required for signature verification.
const { getStripe } = require("../lib/stripe");
const { kvGet, kvSet } = require("../lib/kv");
const { sendEmail } = require("../lib/email");
const { money } = require("../lib/schedule");
const {
  SITE_URL, getBooking, finalizePaidBooking,
  ensureGiftCode, sendGiftCertificate, sendGiftReceipt, sendVoucherCertificate,
  recordPayment, newId, getGift, logGiftUse,
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
        if (booking && booking.status !== "paid") {
          booking.status = "paid";
          booking.amountPaidCents = session.amount_total || booking.amountCents;
          booking.stripePaymentIntentId = session.payment_intent || null;
          await kvSet(`booking:${booking.id}`, booking);
        }
        if (booking) await finalizePaidBooking(booking);
      } else if (meta.type === "gift") {
        const gift = await ensureGiftCode(session);
        if (gift.kind === "voucher") await sendVoucherCertificate(gift);
        else await sendGiftCertificate(gift);
        await sendGiftReceipt(gift);
      } else if (meta.type === "payspot" && meta.paylinkId) {
        const rec = await kvGet(`paylink:${meta.paylinkId}`);
        if (rec) {
          if (meta.giftCode && meta.giftAppliedCents && !rec.giftDeducted) {
            const gift = await getGift(meta.giftCode);
            if (gift) {
              gift.balanceCents = Math.max(0, gift.balanceCents - Number(meta.giftAppliedCents));
              logGiftUse(gift, {
                bookingId: rec.id, amountCents: Number(meta.giftAppliedCents),
                date: new Date().toISOString(), usedBy: rec.clientName || "",
                note: "pay on the spot",
              });
              await kvSet(`gift:${gift.code}`, gift);
            }
            rec.giftDeducted = true;
          }
          rec.paid = true;
          rec.paidAt = new Date().toISOString();
          await kvSet(`paylink:${rec.id}`, rec);
          await recordPayment({
            id: newId("pay"),
            kind: "pay-spot",
            amountCents: session.amount_total || rec.dueCents,
            clientName: rec.clientName,
            serviceLabel: rec.serviceLabel,
            method: "card",
            paylinkId: rec.id,
            bookingId: rec.bookingId || null,
            checkoutSessionId: session.id,
            createdAt: new Date().toISOString(),
          });
          // A pay link sent for a booking balance: the money lands on the
          // booking, and a booking that was waiting on payment becomes paid
          // (gift + referral settle once, via finalizePaidBooking). A booking
          // already marked paid can still owe a balance — a move to Private
          // Hours raises the total by $15 — so the amount is added for any
          // booking that is not closed, and only unpaid/pending flip to paid.
          if (rec.bookingId) {
            const booking = await getBooking(rec.bookingId);
            if (booking && !["completed", "cancelled", "no-show"].includes(booking.status)) {
              booking.amountPaidCents = (booking.amountPaidCents || 0) + (session.amount_total || rec.dueCents);
              booking.paymentMethod = "card";
              if (booking.amountPaidCents >= (booking.amountCents || 0) && (booking.status === "unpaid" || booking.status === "pending")) {
                booking.status = "paid";
                await kvSet(`booking:${booking.id}`, booking);
                await finalizePaidBooking(booking);
              } else {
                await kvSet(`booking:${booking.id}`, booking);
              }
            }
          }
          if (rec.contact && rec.contact.includes("@")) {
            await sendEmail({
              to: rec.contact,
              subject: `Your In2Skin receipt — ${money(session.amount_total || rec.dueCents)} paid`,
              html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Paid — thank you</h2><p>Hi ${String(rec.clientName || "").split(" ")[0] || "there"},</p><p>Your payment of <strong>${money(session.amount_total || rec.dueCents)}</strong> for <strong>${rec.serviceLabel}</strong> at In2Skin is confirmed. The charge shows as <strong>IN2SKIN</strong> on your card statement.</p><p>— In2Skin, Bolton</p>`,
            });
          }
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[webhook] handler error:", err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
