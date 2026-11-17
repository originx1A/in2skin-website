// POST /api/book — create a booking + Stripe Checkout session.
// Full payment at booking. Accepts an optional gift code (its balance comes
// off the total; anything left stays on the code) and the $10 first-visit
// offer. Custom-priced consultations (microneedling / skin tightening) and
// bookings fully covered by a gift code need no payment — they are confirmed
// straight away.
const { getStripe } = require("../lib/stripe");
const { kvGet, kvSet } = require("../lib/kv");
const {
  findService, parseDateLocal, dateKey, timesFor, parseTime, durationFor,
  slotTaken, QUIET_PREMIUM_CENTS, FIRST_VISIT_CENTS, PENDING_HOLD_MS, money,
} = require("../lib/schedule");
const {
  SITE_URL, newId, saveBooking, listBookingsForDate,
  getGift, getBooking, deductGift, sendBookingConfirmation, sendHoldEmail,
} = require("../lib/bookings");

function bad(res, msg) { return res.status(400).json({ error: msg }); }

// POST /api/book with { via: "agent" } — the voice agent holds a slot for a
// caller and gets a Stripe pay link back. Authenticated by the AGENT_API_KEY
// env var (header x-agent-key). The hold is a normal pending booking, so it
// blocks the slot for 30 minutes (PENDING_HOLD_MS) and then releases it.
// No gift codes and no friend bookings on this path — the caller pays the
// full price less the first-visit offer, on their own phone, via the link.
async function handleAgentHold(req, res, b) {
  try {
    const key = process.env.AGENT_API_KEY;
    if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
    if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
    const svc = findService(b.service);
    if (!svc) return bad(res, "Please choose a treatment.");
    const type = b.type === "after" ? "after" : "regular";
    const d = parseDateLocal(b.date);
    if (!d) return bad(res, "Please choose a day.");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const maxDay = new Date(today); maxDay.setDate(maxDay.getDate() + 60);
    if (d < tomorrow) return bad(res, "Bookings start from tomorrow — please choose a later day.");
    if (d > maxDay) return bad(res, "Bookings open up to 60 days ahead — please choose an earlier day.");
    if (!timesFor(b.date, type).includes(b.time)) return bad(res, "That time is not available for this kind of appointment.");
    if (!b.name || !String(b.name).trim()) return bad(res, "Please add your name so we know who is coming.");
    if (!b.phone || String(b.phone).replace(/[^0-9]/g, "").length < 10) return bad(res, "Please add a phone number so we can reach you about your appointment.");
    if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return bad(res, "Please add a valid email — your confirmation is sent there.");

    const bookings = await listBookingsForDate(b.date);
    if (slotTaken(bookings, parseTime(b.time), durationFor(svc))) {
      return res.status(409).json({ error: "That time was just taken — please choose another time." });
    }

    const first = b.first !== "no";
    const baseCents = svc.priceNum * 100 + (type === "after" ? QUIET_PREMIUM_CENTS : 0);
    const firstVisitDiscountCents = svc.priceNum > 0 && first ? FIRST_VISIT_CENTS : 0;
    const amountCents = Math.max(0, baseCents - firstVisitDiscountCents);
    const booking = {
      id: newId("bk"),
      service: svc.id,
      serviceName: svc.name,
      servicePriceLabel: svc.priceLabel,
      minsLabel: svc.mins > 0 ? `${svc.mins} minutes` : "By consultation",
      date: b.date,
      time: b.time,
      type,
      forWhom: "me",
      name: String(b.name).trim(),
      phone: String(b.phone).trim(),
      email: String(b.email).trim(),
      guestName: null,
      guestPhone: null,
      guestEmail: null,
      first: first ? "yes" : "no",
      firstVisitDiscountCents,
      giftCode: null,
      giftAppliedCents: 0,
      giftDeducted: false,
      amountCents,
      amountPaidCents: 0,
      status: "pending",
      via: "agent",
      emailSent: false,
      createdAt: new Date().toISOString(),
    };
    const holdUntil = new Date(Date.now() + PENDING_HOLD_MS).toISOString();

    // Consultation (or a first-visit discount covering it all): no payment
    // due — hold the time and let Sarah confirm it.
    if (amountCents === 0) {
      booking.status = svc.priceNum === 0 ? "consultation" : "paid";
      await saveBooking(booking);
      await sendHoldEmail(booking, null);
      return res.status(200).json({ hold: true, bookingId: booking.id, consultation: booking.status === "consultation", holdUntil });
    }

    await saveBooking(booking);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "cad",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: amountCents,
          product_data: {
            name: `${svc.name} — ${b.date} at ${b.time}${type === "after" ? " (Private Hours)" : ""}`,
            description: `In2Skin · Bolton, Ontario — held by phone${firstVisitDiscountCents ? " · $10 first-visit offer applied" : ""}`,
          },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      customer_email: booking.email,
      metadata: { type: "booking", bookingId: booking.id, via: "agent", giftCode: "", giftAppliedCents: "0" },
      success_url: `${SITE_URL}/booked.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#book`,
    });
    booking.checkoutSessionId = session.id;
    booking.checkoutUrl = session.url;
    await saveBooking(booking);
    await sendHoldEmail(booking, session.url);
    return res.status(200).json({
      hold: true,
      bookingId: booking.id,
      serviceName: booking.serviceName,
      date: booking.date,
      time: booking.time,
      type: booking.type,
      amountCents: booking.amountCents,
      checkoutUrl: session.url,
      holdUntil,
    });
  } catch (err) {
    console.error("[book:agent-hold]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    // GET ?session_id=... — after Stripe checkout, confirm the booking is
    // paid (marks it paid + sends the confirmation email if the webhook has
    // not run yet) and return the booking for the confirmation page.
    // (Was /api/booking-status — merged: Vercel Hobby allows 12 functions.)
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
      console.error("[book]", err);
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const b = req.body || {};
    // Voice-agent hold: same slot rules, no gift codes, no friend bookings.
    if (b.via === "agent") return handleAgentHold(req, res, b);
    const svc = findService(b.service);
    if (!svc) return bad(res, "Please choose a treatment.");
    const type = b.type === "after" ? "after" : "regular";
    const d = parseDateLocal(b.date);
    if (!d) return bad(res, "Please choose a day.");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const maxDay = new Date(today); maxDay.setDate(maxDay.getDate() + 60);
    if (d < tomorrow) return bad(res, "Bookings start from tomorrow — please choose a later day.");
    if (d > maxDay) return bad(res, "Bookings open up to 60 days ahead — please choose an earlier day.");
    if (!timesFor(b.date, type).includes(b.time)) return bad(res, "That time is not available for this kind of appointment.");
    if (!b.name || !String(b.name).trim()) return bad(res, "Please add your name so we know who is coming.");
    if (!b.phone || String(b.phone).replace(/[^0-9]/g, "").length < 10) return bad(res, "Please add a phone number so we can reach you about your appointment.");
    if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return bad(res, "Please add a valid email — your confirmation is sent there.");
    if (b.forWhom === "friend") {
      if (!b.guestName || !String(b.guestName).trim()) return bad(res, "Please add your friend's name so we know who is coming.");
      if (!b.guestPhone || String(b.guestPhone).replace(/[^0-9]/g, "").length < 10) return bad(res, "Please add your friend's phone so we can reach them about the appointment.");
      if (!b.guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.guestEmail))) return bad(res, "Please add your friend's email — their confirmation is sent there.");
    }

    const bookings = await listBookingsForDate(b.date);
    if (slotTaken(bookings, parseTime(b.time), durationFor(svc))) {
      return res.status(409).json({ error: "That time was just taken — please choose another time." });
    }

    // Price: base + $15 Private Hours premium, less $10 first-visit offer,
    // less gift-certificate balance.
    const first = b.first !== "no";
    let baseCents = svc.priceNum * 100 + (type === "after" ? QUIET_PREMIUM_CENTS : 0);
    const firstVisitDiscountCents = svc.priceNum > 0 && first ? FIRST_VISIT_CENTS : 0;
    let giftCode = null;
    let giftAppliedCents = 0;
    if (b.giftCode && String(b.giftCode).trim()) {
      const gift = await getGift(b.giftCode);
      if (!gift) return bad(res, "That gift code was not found — check the code and try again.");
      if (!gift.balanceCents || gift.balanceCents <= 0) return bad(res, "That gift code has no balance left.");
      giftCode = gift.code;
      giftAppliedCents = Math.min(gift.balanceCents, Math.max(0, baseCents - firstVisitDiscountCents));
    }
    const amountCents = Math.max(0, baseCents - firstVisitDiscountCents - giftAppliedCents);

    const booking = {
      id: newId("bk"),
      service: svc.id,
      serviceName: svc.name,
      servicePriceLabel: svc.priceLabel,
      minsLabel: svc.mins > 0 ? `${svc.mins} minutes` : "By consultation",
      date: b.date,
      time: b.time,
      type,
      forWhom: b.forWhom === "friend" ? "friend" : "me",
      name: String(b.name).trim(),
      phone: String(b.phone).trim(),
      email: String(b.email).trim(),
      guestName: b.guestName ? String(b.guestName).trim() : null,
      guestPhone: b.guestPhone ? String(b.guestPhone).trim() : null,
      guestEmail: b.guestEmail ? String(b.guestEmail).trim() : null,
      first: first ? "yes" : "no",
      firstVisitDiscountCents,
      giftCode,
      giftAppliedCents,
      giftDeducted: false,
      amountCents,
      amountPaidCents: 0,
      status: "pending",
      emailSent: false,
      createdAt: new Date().toISOString(),
    };

    // No payment due: custom consultation, or a gift code covering it all.
    if (amountCents === 0) {
      booking.status = svc.priceNum === 0 ? "consultation" : "paid";
      booking.amountPaidCents = 0;
      await deductGift(booking);
      await saveBooking(booking);
      await sendBookingConfirmation(booking);
      return res.status(200).json({ paid: true, bookingId: booking.id, consultation: booking.status === "consultation" });
    }

    await saveBooking(booking);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "cad",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: amountCents,
          product_data: {
            name: `${svc.name} — ${b.date} at ${b.time}${type === "after" ? " (Private Hours)" : ""}`,
            description: `In2Skin · Bolton, Ontario${giftAppliedCents ? ` · ${money(giftAppliedCents)} from gift certificate ${giftCode}` : ""}${firstVisitDiscountCents ? " · $10 first-visit offer applied" : ""}`,
          },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      customer_email: booking.email,
      metadata: {
        type: "booking",
        bookingId: booking.id,
        giftCode: giftCode || "",
        giftAppliedCents: String(giftAppliedCents),
      },
      success_url: `${SITE_URL}/booked.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#book`,
    });
    booking.checkoutSessionId = session.id;
    await saveBooking(booking);
    return res.status(200).json({ url: session.url, bookingId: booking.id });
  } catch (err) {
    console.error("[book]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
