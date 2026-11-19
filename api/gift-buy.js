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
const { sendEmail } = require("../lib/email");
const { checkLimit } = require("../lib/rate-limit");

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

// POST /api/gift-buy with { via: "agent" } — the voice agent sells a gift
// certificate or treatment voucher to a caller (Tony Nov 17, 2026: agents
// can upsell). Authenticated by the AGENT_API_KEY env var (header
// x-agent-key). The agent collects the buyer + friend details; the site
// creates the same Stripe Checkout session as the website and emails the
// pay link to the BUYER — the caller pays on their own phone (never read
// out, never typed in by the studio). After payment the webhook issues the
// code and emails it to the friend, exactly like a website purchase. SMS is
// parked (Tony Nov 17, 2026) — email only.
async function handleAgentGift(req, res, b) {
  try {
    const key = process.env.AGENT_API_KEY;
    if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
    if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
    const bad = (msg) => res.status(400).json({ error: msg });
    const buyerName = String(b.buyerName || "").trim();
    const buyerEmail = String(b.buyerEmail || "").trim();
    const recipientName = String(b.recipientName || "").trim();
    const recipientEmail = String(b.recipientEmail || "").trim();
    if (!buyerName) return bad("Please add your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return bad("Please add your email — the payment link is sent there.");
    if (!recipientName) return bad("Please add your friend's name — it goes on the gift.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return bad("Please add your friend's email — the gift code is sent there after payment.");

    let amountCents = 0;
    let label = "";
    let voucherLabel = "";
    let voucherFor = null;
    if (b.kind === "voucher") {
      let priced;
      try {
        priced = priceVoucher(b.service, Array.isArray(b.addons) ? b.addons : [], b.type);
      } catch (err) {
        return bad(err.message);
      }
      amountCents = priced.totalCents;
      label = `Treatment Voucher — ${priced.label}`;
      voucherLabel = priced.label;
      voucherFor = {
        service: priced.main.id,
        serviceName: priced.main.name,
        addons: priced.addons.map((a) => ({ id: a.id, name: a.name })),
        type: priced.type,
      };
    } else if (b.option && GIFT_OPTIONS[b.option]) {
      amountCents = GIFT_OPTIONS[b.option].amountCents;
      label = GIFT_OPTIONS[b.option].name;
    } else if (b.option === "gift-custom") {
      const val = Math.round(parseFloat(b.amount) * 100);
      if (!val || val < 1000) return bad("Please choose an amount of $10 or more for a custom certificate.");
      amountCents = val;
      label = "Custom Amount Gift Certificate";
    } else {
      return bad("Please choose a certificate or a treatment voucher.");
    }

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
            name: b.kind === "voucher" ? `In2Skin Treatment Voucher — ${voucherLabel}` : `In2Skin Gift Certificate — ${money(amountCents)}`,
            description: b.kind === "voucher"
              ? `Good for ${voucherLabel} · for ${recipientName} · No cash value · Dollar value never expires`
              : `${label} for ${recipientName} · Gift codes never expire`,
          },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      customer_email: buyerEmail,
      metadata: Object.assign({
        type: "gift",
        amountCents: String(amountCents),
        buyerName,
        buyerEmail,
        recipientName,
        recipientEmail,
        message: String(b.message || "").trim().slice(0, 500),
      }, b.kind === "voucher" ? {
        kind: "voucher",
        voucherLabel,
        voucherFor: JSON.stringify(voucherFor),
      } : {}),
      success_url: `${SITE_URL}/gift-sent.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#gift`,
    });
    // The buyer pays on their own phone — the link goes to their email.
    // If the email does not go out, say so: the agent must not tell the
    // caller a link is on its way when it is not.
    const emailed = await sendEmail({
      to: buyerEmail,
      subject: `Pay for your In2Skin gift — ${money(amountCents)} for ${recipientName}`,
      html: `<p>Hi ${buyerName},</p>`
        + `<p>Here is the secure payment link for your In2Skin gift: <strong>${label}</strong> — ${money(amountCents)} for <strong>${recipientName}</strong>.</p>`
        + `<p><a href="${session.url}">Pay securely by card</a></p>`
        + `<p>As soon as your payment goes through, the gift code is emailed to ${recipientName} at ${recipientEmail}. The charge shows as <strong>IN2SKIN</strong> on your card statement. Gift codes never expire, and there is no cash value.</p>`
        + `<p>In2Skin · Bolton, Ontario · (289) 212-4124</p>`,
      text: `Hi ${buyerName},\n\nHere is the secure payment link for your In2Skin gift: ${label} — ${money(amountCents)} for ${recipientName}.\n\nPay securely by card: ${session.url}\n\nAs soon as your payment goes through, the gift code is emailed to ${recipientName} at ${recipientEmail}. The charge shows as IN2SKIN on your card statement. Gift codes never expire, and there is no cash value.\n\nIn2Skin · Bolton, Ontario · (289) 212-4124`,
    });
    if (!emailed) return res.status(502).json({ error: "The payment link could not be emailed — please try again or buy it on boltonfacials.com." });
    return res.status(200).json({
      sent: true,
      amountCents,
      label,
      recipientName,
      recipientEmail,
      buyerEmail,
    });
  } catch (err) {
    console.error("[gift-buy:agent]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  // 10 gift purchases per minute per IP (agent sales are exempt).
  if (!(await checkLimit(req, res, { scope: "gift-buy", limit: 10, windowSecs: 60 }))) return;
  try {
    const b = req.body || {};
    // Voice-agent sale: the agent collects buyer + friend details on the
    // call and gets a pay link emailed to the BUYER (see handleAgentGift).
    if (b.via === "agent") return await handleAgentGift(req, res, b);
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
