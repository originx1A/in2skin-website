// POST /api/gift-buy — Stripe Checkout for a gift certificate.
// Any amount ($10 minimum for custom). On webhook success a code is issued
// with that balance; the receipt IS the certificate (printout + code).
// Gift codes NEVER expire.
const { getStripe } = require("../lib/stripe");
const { GIFT_OPTIONS, money } = require("../lib/schedule");
const { SITE_URL } = require("../lib/bookings");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const b = req.body || {};
    let amountCents = 0;
    let label = "";
    if (b.option && GIFT_OPTIONS[b.option]) {
      amountCents = GIFT_OPTIONS[b.option].amountCents;
      label = GIFT_OPTIONS[b.option].name;
    } else if (b.option === "gift-custom") {
      const val = Math.round(parseFloat(b.amount) * 100);
      if (!val || val < 1000) return res.status(400).json({ error: "Please enter an amount of $10 or more for a custom certificate." });
      amountCents = val;
      label = "Custom Amount Gift Certificate";
    } else {
      return res.status(400).json({ error: "Please choose a certificate." });
    }
    if (!b.buyerName || !String(b.buyerName).trim()) return res.status(400).json({ error: "Please add your name." });
    if (!b.buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.buyerEmail))) return res.status(400).json({ error: "Please add your email — your confirmation is sent there." });
    if (!b.recipientName || !String(b.recipientName).trim()) return res.status(400).json({ error: "Please add your friend's name — it goes on the certificate." });
    if (!b.recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.recipientEmail))) return res.status(400).json({ error: "Please add your friend's email — the certificate code is sent there." });

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
            name: `In2Skin Gift Certificate — ${money(amountCents)}`,
            description: `${label} for ${String(b.recipientName).trim()} · Gift codes never expire`,
          },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      customer_email: String(b.buyerEmail).trim(),
      metadata: {
        type: "gift",
        amountCents: String(amountCents),
        buyerName: String(b.buyerName).trim(),
        buyerEmail: String(b.buyerEmail).trim(),
        recipientName: String(b.recipientName).trim(),
        recipientEmail: String(b.recipientEmail).trim(),
        message: String(b.message || "").trim().slice(0, 500),
      },
      success_url: `${SITE_URL}/gift-sent.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#gift`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("[gift-buy]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
