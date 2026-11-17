// POST /api/gift-buy — Stripe Checkout for a gift certificate.
// Any amount ($10 minimum for custom). On webhook success a code is issued
// with that balance; the receipt IS the certificate (printout + code).
// Gift codes NEVER expire.
// POST with { kind: "voucher" } — a treatment voucher: a named facial +
// add-ons, paid in full ahead, sold as "Good for [treatment]" instead of an
// open amount. Same gift-code rails; the issued record is tagged voucherFor.
const { getStripe } = require("../lib/stripe");
const { GIFT_OPTIONS, priceVoucher, money } = require("../lib/schedule");
const { SITE_URL } = require("../lib/bookings");

async function handleVoucherBuy(req, res, b) {
  let priced;
  try {
    priced = priceVoucher(b.service, Array.isArray(b.addons) ? b.addons : [], b.type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!b.buyerName || !String(b.buyerName).trim()) return res.status(400).json({ error: "Please add your name." });
  if (!b.buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.buyerEmail))) return res.status(400).json({ error: "Please add your email — your confirmation is sent there." });
  if (!b.recipientName || !String(b.recipientName).trim()) return res.status(400).json({ error: "Please add your friend's name — it goes on the voucher." });
  if (!b.recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.recipientEmail))) return res.status(400).json({ error: "Please add your friend's email — the voucher code is sent there." });
  const buyerName = String(b.buyerName).trim();
  const buyerEmail = String(b.buyerEmail).trim();
  const recipientName = String(b.recipientName).trim();
  const recipientEmail = String(b.recipientEmail).trim();
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    currency: "cad",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "cad",
        unit_amount: priced.totalCents,
        product_data: {
          name: `In2Skin Treatment Voucher — ${priced.label}`,
          description: `Good for ${priced.label} · for ${recipientName} · No cash value · Dollar value never expires`,
        },
      },
    }],
    payment_intent_data: { statement_descriptor: "IN2SKIN" },
    customer_email: buyerEmail,
    metadata: {
      type: "gift",
      kind: "voucher",
      amountCents: String(priced.totalCents),
      buyerName,
      buyerEmail,
      recipientName,
      recipientEmail,
      message: String(b.message || "").trim().slice(0, 500),
      voucherLabel: priced.label,
      voucherFor: JSON.stringify({
        service: priced.main.id,
        serviceName: priced.main.name,
        addons: priced.addons.map((a) => ({ id: a.id, name: a.name })),
        type: priced.type,
      }),
    },
    success_url: `${SITE_URL}/gift-sent.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/#gift`,
  });
  return res.status(200).json({ url: session.url });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const b = req.body || {};
    if (b.kind === "voucher") return await handleVoucherBuy(req, res, b);
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
