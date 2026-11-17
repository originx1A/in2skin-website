// GET /api/booking-status?session_id=... — after Stripe checkout, confirm
// the booking is paid (marks it paid + sends the confirmation email if the
// webhook has not run yet) and return the booking for the confirmation page.
const { getStripe } = require("../lib/stripe");
const { getBooking, deductGift, sendBookingConfirmation } = require("../lib/bookings");
const { kvSet } = require("../lib/kv");

module.exports = async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session." });
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(200).json({ paid: false });
    }
    const bookingId = (session.metadata || {}).bookingId;
    const booking = await getBooking(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.status !== "paid") {
      booking.status = "paid";
      booking.amountPaidCents = session.amount_total || booking.amountCents;
      booking.stripePaymentIntentId = session.payment_intent || null;
      await deductGift(booking);
      await kvSet(`booking:${booking.id}`, booking);
    }
    await sendBookingConfirmation(booking);
    return res.status(200).json({
      paid: true,
      booking: {
        serviceName: booking.serviceName,
        date: booking.date,
        time: booking.time,
        type: booking.type,
        name: booking.name,
        guestName: booking.guestName,
        email: booking.email,
        amountPaidCents: booking.amountPaidCents,
        giftAppliedCents: booking.giftAppliedCents,
      },
    });
  } catch (err) {
    console.error("[booking-status]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
