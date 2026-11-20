// POST /api/book — create a booking + Stripe Checkout session.
// Deposit at booking ($30 for a booking for yourself; friend bookings
// and consultations pay in full). The balance is due at the visit.
// Accepts an optional gift code (its balance comes off the total;
// anything left stays on the code). Bookings fully covered
// by a gift code need no payment — they are confirmed straight away.
const { getStripe } = require("../lib/stripe");
const { kvGet, kvSet } = require("../lib/kv");
const {
  findService, parseDateLocal, timesFor, parseTime, normalizeAddons,
  durationForBooking, baseCentsFor,
  slotTaken, PENDING_HOLD_MS, dayIsFull, countsTowardCap,
} = require("../lib/schedule");
const { studioForDate } = require("../lib/studio");
const {
  SITE_URL, newId, saveBooking, listBookingsForDate,
  getBooking, finalizePaidBooking, settleBookingPayment, balanceDue,
  sendHoldEmail, notifyStudioBooking,
  buildBooking, createBookingCheckout, createConsultRequest, CONSULT_ID,
  CONSULT_FORMATS, consultFormatOf, consultName, meetLinkFor,
} = require("../lib/bookings");
const { getReferralByEmailOrPhone } = require("../lib/referrals");
const { getOrCreateReferral } = require("../lib/referrals");
const { checkLimit } = require("../lib/rate-limit");

function bad(res, msg) { return res.status(400).json({ error: msg }); }

// Honeypot / too-fast-submit check for the public booking form. A bot
// fills the hidden "website" field or submits within 3 seconds of the page
// loading; a real client takes minutes through the multi-step wizard. The
// rejection is generic on purpose — never tell a bot why it was rejected.
// A missing timestamp fails open (an old cached page) — the honeypot is
// the trap that matters. Agent holds (x-agent-key) never come from the
// form, so this runs on the web path only.
const BOT_MSG = "Something went wrong — please call us and we will book you in.";
function botCheck(b) {
  if (typeof b.website === "string" && b.website.trim() !== "") return false;
  if (b.formLoadedAt != null) {
    const loadedAt = Number(b.formLoadedAt);
    if (Number.isFinite(loadedAt) && Date.now() - loadedAt < 3000) return false;
  }
  return true;
}

// POST /api/book with { via: "agent" } — the voice agent holds a slot for a
// caller and gets a Stripe pay link back. Authenticated by the AGENT_API_KEY
// env var (header x-agent-key). The hold is a normal pending booking, so it
// blocks the slot for 30 minutes (PENDING_HOLD_MS) and then releases it.
// No gift codes and no friend bookings on this path — the caller pays the
// full price, on their own phone, via the link.
// Add-ons ride along (b.addons): treatment first, then tick add-ons.
async function handleAgentHold(req, res, b) {
  try {
    const key = process.env.AGENT_API_KEY;
    if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
    if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
    const svc = findService(b.service);
    if (!svc) return bad(res, "Please choose a treatment.");
    let addons;
    try { addons = normalizeAddons(b.addons); } catch (err) { return bad(res, err.message); }
    // A consultation is just the consultation — no add-ons.
    if (svc.id === CONSULT_ID && addons.length) return bad(res, "A consultation is just the consultation — pick your add-ons with your treatment.");
    // The format (Tony Nov 19, 2026): video call or in person at the
    // studio. An invalid format is refused, not guessed.
    if (svc.id === CONSULT_ID && b.format != null && b.format !== "" && !CONSULT_FORMATS.includes(b.format)) return bad(res, "Pick video or in person for your consultation.");
    const format = svc.id === CONSULT_ID ? consultFormatOf(b) : null;
    // First-time clients only (Tony Nov 19, 2026): one consultation per
    // client, ever. The agent cannot see caller history (the V13 prompt
    // tells it to ask first); this is the backstop if it offers one to
    // a returning client anyway.
    if (svc.id === CONSULT_ID) {
      const prior = await getReferralByEmailOrPhone(b.email, b.phone);
      if (prior) return bad(res, "You've already had your consultation with the studio — book your treatment directly.");
    }
    const totalMins = durationForBooking(svc.id, addons);
    const addonNames = addons.map((id) => findService(id).name);
    const serviceLabel = svc.id === CONSULT_ID ? consultName(format) : (addonNames.length ? `${svc.name} + ${addonNames.join(" + ")}` : svc.name);
    const type = b.type === "after" ? "after" : "regular";
    // Early mornings and evenings are by request through the studio — the voice
    // agent never books them; it takes a message instead (Tony Nov 19).
    if (type === "after") return bad(res, "Early mornings and evenings are by request — please take the caller's message and the studio will call them back.");
    const d = parseDateLocal(b.date);
    if (!d) return bad(res, "Please choose a day.");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const maxDay = new Date(today); maxDay.setDate(maxDay.getDate() + 60);
    if (d < tomorrow) return bad(res, "Bookings start from tomorrow — please choose a later day.");
    if (d > maxDay) return bad(res, "Bookings open up to 60 days ahead — please choose an earlier day.");
    if (!timesFor(b.date, type, svc.id).includes(b.time)) return bad(res, "That time is not available for this kind of appointment.");
    if (!b.name || !String(b.name).trim()) return bad(res, "Please add your name so we know who is coming.");
    if (!b.phone || String(b.phone).replace(/[^0-9]/g, "").length < 10) return bad(res, "Please add a phone number so we can reach you about your appointment.");
    if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return bad(res, "Please add a valid email — your confirmation is sent there.");

    const bookings = await listBookingsForDate(b.date);
    const { bufferMins, blocks } = await studioForDate(b.date);
    if (slotTaken(bookings, parseTime(b.time), totalMins, { bufferMins, blocks })) {
      return res.status(409).json({ error: "That time was just taken — please choose another time." });
    }
    // Four appointments a day, whatever they are (Tony Nov 19, 2026).
    // Consultations share the cap (A4).
    if (countsTowardCap(svc.id) && dayIsFull(bookings)) {
      return res.status(409).json({ error: "That day is fully booked — the studio takes four appointments a day. Please choose another day." });
    }

    const baseCents = baseCentsFor(svc.id, addons, type);
    // The $10 first-visit offer was dropped (Tony Nov 19, 2026) — the $30
    // consultation credit is the one first-visit offer. The field is still
    // recorded as 0 so old bookings keep their recorded value.
    const firstVisitDiscountCents = 0;
    const amountCents = Math.max(0, baseCents);
    const myRef = await getOrCreateReferral({ name: b.name, email: b.email, phone: b.phone });
    const booking = {
      id: newId("bk"),
      service: svc.id,
      serviceName: svc.id === CONSULT_ID ? consultName(format) : svc.name,
      serviceLabel,
      format,
      addons,
      addonNames,
      servicePriceLabel: svc.priceLabel,
      minsLabel: svc.mins > 0 ? `${totalMins} minutes` : "By consultation",
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
      firstVisitDiscountCents,
      giftCode: null,
      giftAppliedCents: 0,
      giftKind: null,
      giftDeducted: false,
      referralCode: null,
      referralAppliedCents: 0,
      referralDeducted: false,
      freeReflexologyApplied: false,
      freeReflexologyDeducted: false,
      referredBy: null,
      myReferralCode: myRef.code,
      amountCents,
      amountPaidCents: 0,
      status: "pending",
      via: "agent",
      emailSent: false,
      createdAt: new Date().toISOString(),
    };
    const holdUntil = new Date(Date.now() + PENDING_HOLD_MS).toISOString();

    // Consultation (or a booking fully covered): no payment due — hold
    // the time and let the studio confirm it. A consultation earns no
    // referral credit and marks no client paid, so the hold email is the
    // only email on this path.
    if (amountCents === 0) {
      booking.status = svc.priceNum === 0 ? "consultation" : "paid";
      await saveBooking(booking);
      await sendHoldEmail(booking, null);
      await notifyStudioBooking(booking, "new");
      return res.status(200).json({ hold: true, bookingId: booking.id, consultation: booking.status === "consultation", holdUntil });
    }

    await saveBooking(booking);
    const stripe = getStripe();
    const isConsult = svc.id === CONSULT_ID;
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
            // The consultation's checkout names the service plainly
            // (Tony Nov 19, 2026); the statement descriptor is IN2SKIN.
            name: isConsult ? `${consultName(format)} — In2Skin` : `${serviceLabel} — ${b.date} at ${b.time}${type === "after" ? " (Private Hours)" : ""}`,
            description: isConsult
              ? `Payment for ${consultName(format)} · In2Skin, Bolton, Ontario — ${b.date} at ${b.time}`
              : `In2Skin · Bolton, Ontario — held by phone`,
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
    await notifyStudioBooking(booking, "new");
    return res.status(200).json({
      hold: true,
      bookingId: booking.id,
      serviceName: booking.serviceName,
      serviceLabel: booking.serviceLabel,
      format: booking.format || null,
      addons: booking.addons,
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
      // One shared settle step (also used by the webhook): a full payment
      // flips the booking to paid; a $30 deposit flips it to deposit-paid
      // with a balance due at the visit.
      await settleBookingPayment(booking, session);
      return res.status(200).json({
        paid: true,
        booking: {
          serviceName: booking.serviceName,
          format: booking.format || null,
          date: booking.date,
          time: booking.time,
          type: booking.type,
          name: booking.name,
          guestName: booking.guestName,
          email: booking.email,
          status: booking.status,
          amountCents: booking.amountCents,
          amountPaidCents: booking.amountPaidCents,
          balanceDueCents: balanceDue(booking),
          payMode: booking.payMode || "full",
          giftAppliedCents: booking.giftAppliedCents,
          giftKind: booking.giftKind || null,
          myReferralCode: booking.myReferralCode || null,
          // A paid video consultation carries its own fresh Meet link
          // (minted at payment); one that never got a link yet still
          // says it is coming — the confirmation page shows either.
          meetLink: await meetLinkFor(booking),
          meetLinkFailed: !!booking.meetLinkFailed,
        },
      });
    } catch (err) {
      console.error("[book]", err);
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  // 10 booking attempts per minute per IP (agent calls are exempt — the
  // voice agent books from shared IPs). Fail open on any limiter error.
  if (!(await checkLimit(req, res, { scope: "book", limit: 10, windowSecs: 60 }))) return;
  try {
    const b = req.body || {};
    // Consultation request (after hours) — no payment, no slot
    // hold; the studio answers it on the dashboard. The voice agent may
    // submit one too (same key as holds); the web form uses the honeypot.
    if (b.consultRequest === true) {
      if (b.via === "agent") {
        const key = process.env.AGENT_API_KEY;
        if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
        if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
      } else if (!botCheck(b)) {
        return res.status(400).json({ error: BOT_MSG });
      }
      try {
        const created = await createConsultRequest(b);
        return res.status(200).json({ ok: true, requestId: created.id, format: created.format || "video", date: created.date, time: created.time });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    }
    // Voice-agent hold: same slot rules, no gift codes, no friend bookings.
    if (b.via === "agent") return handleAgentHold(req, res, b);
    if (!botCheck(b)) return res.status(400).json({ error: BOT_MSG });
    // Shared creation path with the admin walk-in form (same validation,
    // slot rules incl. live buffer + blocks, and pricing).
    const { bufferMins, blocks } = await studioForDate(b.date);
    const booking = await buildBooking(b, { bufferMins, blocks, via: "web" });
    const svc = findService(booking.service);

    // No payment due: custom consultation, or a gift code covering it all.
    if (booking.amountCents === 0) {
      booking.status = svc.priceNum === 0 ? "consultation" : "paid";
      booking.amountPaidCents = 0;
      await saveBooking(booking);
      await finalizePaidBooking(booking);
      await notifyStudioBooking(booking, "new");
      return res.status(200).json({ paid: true, bookingId: booking.id, consultation: booking.status === "consultation", myReferralCode: booking.myReferralCode });
    }

    await saveBooking(booking);
    const session = await createBookingCheckout(booking);
    booking.checkoutSessionId = session.id;
    await saveBooking(booking);
    // Web hold warning (Tony Nov 19): web bookers get the same 30-minute
    // hold email the phone callers get — but only when an email was given
    // (email is optional on the web form). Email failure must never break
    // the checkout redirect.
    if (booking.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(booking.email))) {
      try { await sendHoldEmail(booking, session.url); } catch (e) { console.error("[book:hold-email]", e); }
    }
    await notifyStudioBooking(booking, "new");
    return res.status(200).json({ url: session.url, bookingId: booking.id, payMode: booking.payMode, depositCents: booking.depositCents, amountCents: booking.amountCents });
  } catch (err) {
    console.error("[book]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
