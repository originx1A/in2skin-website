// POST /api/gift-buy — Stripe Checkout for a gift certificate.
// Any amount ($10 minimum for custom). On webhook success a code is issued
// with that balance; the receipt IS the certificate (printout + code).
// Gift codes NEVER expire.
// POST with { kind: "voucher" } — a treatment voucher: a named facial +
// add-ons, paid in full ahead, sold as "Good for [treatment]" instead of an
// open amount. Same gift-code rails; the issued record is tagged voucherFor.
// The /gift/ page posts its own order shape (see mapGiftPageOrder):
// { amount, treatment, toName, toPhone, message, delivery, toEmail,
//   sendOn, buyerName, buyerEmail, buyerPhone } — a treatment NAME maps to
// a voucher (service id + add-ons), an amount maps to a certificate.
// Print delivery needs NO recipient email: the certificate goes to the
// buyer to print. Email delivery takes an optional sendOn date.
const { getStripe } = require("../lib/stripe");
const { GIFT_OPTIONS, priceVoucher, money } = require("../lib/schedule");
const { siteUrlFor } = require("../lib/bookings");
const { sendEmail } = require("../lib/email");
const { checkLimit } = require("../lib/rate-limit");
const { torontoDateKey } = require("../lib/transfer");

// The /gift/ page's treatment buttons (data-tre in gift/index.html) map
// to voucher services. "The Works" on that page is $160 — the Classic
// variant (combo-classic). The server prices the voucher itself; the
// page's amount is never trusted for a treatment.
const GIFT_PAGE_TREATMENTS = {
  "Classic Facial": "classic-facial",
  "Anti-Aging Facial": "anti-aging-facial",
  "The Works": "combo-classic",
};

function mapGiftPageOrder(b) {
  const delivery = b.delivery === "print" ? "print" : "email";
  const out = {
    fromGiftPage: true,
    buyerName: String(b.buyerName || "").trim(),
    buyerEmail: String(b.buyerEmail || "").trim(),
    buyerPhone: String(b.buyerPhone || "").trim(),
    recipientName: String(b.toName || "").trim(),
    recipientEmail: String(b.toEmail || "").trim(),
    recipientPhone: String(b.toPhone || "").trim(),
    message: String(b.message || "").trim().slice(0, 500),
    delivery,
    sendOn: "",
  };
  if (delivery === "email") {
    // sendOn: "now" (or missing) means right away; a YYYY-MM-DD date
    // means the certificate goes out ON that date, not at payment.
    if (b.sendOn && b.sendOn !== "now") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.sendOn)) throw new Error("Please choose a valid send date.");
      if (b.sendOn < torontoDateKey()) throw new Error("Please choose today or a later date to send the gift.");
      out.sendOn = b.sendOn;
    }
  }
  if (b.treatment) {
    const service = GIFT_PAGE_TREATMENTS[String(b.treatment).trim()];
    if (!service) throw new Error("Please choose a treatment from the list.");
    out.kind = "voucher";
    out.service = service;
    out.addons = [];
    out.type = "regular";
  } else {
    const val = Math.round(Number(b.amount) * 100);
    if (!val || val < 1000) throw new Error("Please enter an amount of $10 or more for a custom certificate.");
    out.kind = "gift";
    out.amountCents = val;
  }
  return out;
}

function checkGiftParties(b, { emailRequired, phonesRequired }) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  if (!b.buyerName) throw bad("Please add your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.buyerEmail || "")) throw bad("Please add your email — your confirmation is sent there.");
  // Phones are required on the /gift/ page (it collects them); the legacy
  // shape never had them, so they stay optional there.
  if (phonesRequired && (!b.buyerPhone || b.buyerPhone.replace(/[^0-9]/g, "").length < 10)) throw bad("Please add your phone number.");
  if (!b.recipientName) throw bad("Please add your friend's name — it goes on the certificate.");
  if (phonesRequired && (!b.recipientPhone || b.recipientPhone.replace(/[^0-9]/g, "").length < 10)) throw bad("Please add your friend's phone number.");
  if (emailRequired && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.recipientEmail || "")) throw bad("Please add your friend's email — the certificate code is sent there.");
}

function giftSessionMeta(b, extra) {
  return Object.assign({
    type: "gift",
    amountCents: String(b.amountCents || 0),
    buyerName: b.buyerName,
    buyerEmail: b.buyerEmail,
    buyerPhone: b.buyerPhone || "",
    recipientName: b.recipientName,
    recipientEmail: b.recipientEmail || "",
    recipientPhone: b.recipientPhone || "",
    message: b.message || "",
    delivery: b.delivery || "email",
    sendOn: b.sendOn || "",
  }, extra || {});
}

async function handleVoucherBuy(req, res, b) {
  let priced;
  try {
    priced = priceVoucher(b.service, Array.isArray(b.addons) ? b.addons : [], b.type);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    // Print delivery: no recipient email needed — the certificate goes
    // to the buyer to print. Email delivery still needs one.
    checkGiftParties(b, { emailRequired: b.delivery !== "print", phonesRequired: b.fromGiftPage === true });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
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
        unit_amount: priced.totalCents,
        product_data: {
          name: `In2Skin Treatment Voucher — ${priced.label}`,
          description: `Good for ${priced.label} · for ${b.recipientName} · No cash value · Dollar value never expires`,
        },
      },
    }],
    payment_intent_data: { statement_descriptor: "IN2SKIN" },
    customer_email: b.buyerEmail,
    metadata: giftSessionMeta(
      { amountCents: priced.totalCents, buyerName: b.buyerName, buyerEmail: b.buyerEmail, buyerPhone: b.buyerPhone || "", recipientName: b.recipientName, recipientEmail: b.recipientEmail || "", recipientPhone: b.recipientPhone || "", message: b.message || "", delivery: b.delivery || "email", sendOn: b.sendOn || "" },
      {
        kind: "voucher",
        voucherLabel: priced.label,
        // Where the gift was bought (Nov 20, 2026): the certificate email
        // links back to this origin.
        origin: siteUrlFor(req),
        voucherFor: JSON.stringify({
          service: priced.main.id,
          serviceName: priced.main.name,
          addons: priced.addons.map((a) => ({ id: a.id, name: a.name })),
          type: priced.type,
        }),
      },
    ),
    success_url: `${siteUrlFor(req)}/gift/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrlFor(req)}/gift/`,
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
        // Where the gift was bought (Nov 20, 2026): the certificate email
        // links back to this origin.
        origin: siteUrlFor(req),
      }, b.kind === "voucher" ? {
        kind: "voucher",
        voucherLabel,
        voucherFor: JSON.stringify(voucherFor),
      } : {}),
      success_url: `${siteUrlFor(req)}/gift-sent.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrlFor(req)}/#gift`,
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
    // The /gift/ page posts its own order shape — map it first. The
    // legacy shape ({ option | kind:"voucher" + service/addons }) still
    // works, normalised into the same fields.
    let n;
    if (b.delivery || b.toName || b.treatment) {
      try {
        n = mapGiftPageOrder(b);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    } else if (b.kind === "voucher") {
      n = {
        kind: "voucher", service: b.service, addons: Array.isArray(b.addons) ? b.addons : [], type: b.type,
        buyerName: String(b.buyerName || "").trim(), buyerEmail: String(b.buyerEmail || "").trim(),
        buyerPhone: String(b.buyerPhone || "").trim(), recipientName: String(b.recipientName || "").trim(),
        recipientEmail: String(b.recipientEmail || "").trim(), recipientPhone: String(b.recipientPhone || "").trim(),
        message: String(b.message || "").trim().slice(0, 500), delivery: "email", sendOn: "",
      };
    } else {
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
      n = {
        kind: "gift", amountCents, label,
        buyerName: String(b.buyerName || "").trim(), buyerEmail: String(b.buyerEmail || "").trim(),
        buyerPhone: String(b.buyerPhone || "").trim(), recipientName: String(b.recipientName || "").trim(),
        recipientEmail: String(b.recipientEmail || "").trim(), recipientPhone: String(b.recipientPhone || "").trim(),
        message: String(b.message || "").trim().slice(0, 500), delivery: "email", sendOn: "",
      };
    }
    if (n.kind === "voucher") return await handleVoucherBuy(req, res, n);
    try {
      // Print delivery: no recipient email needed — the certificate goes
      // to the buyer to print. Email delivery still needs one.
      checkGiftParties(n, { emailRequired: n.delivery !== "print", phonesRequired: n.fromGiftPage === true });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const label = n.label || "Custom Amount Gift Certificate";
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "cad",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: n.amountCents,
          product_data: {
            name: `In2Skin Gift Certificate — ${money(n.amountCents)}`,
            description: `${label} for ${n.recipientName} · Gift codes never expire`,
          },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      customer_email: n.buyerEmail,
      // Where the gift was bought (Nov 20, 2026): the certificate email
      // links back to this origin.
      metadata: giftSessionMeta(n, { origin: siteUrlFor(req) }),
      success_url: `${siteUrlFor(req)}/gift/?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrlFor(req)}/gift/`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("[gift-buy]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
