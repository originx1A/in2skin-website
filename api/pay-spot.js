// POST /api/pay-spot — the studio enters the amount owed (+ optional gift
// code) and gets a Stripe payment link back. The client pays on THEIR OWN
// phone: by text, by email, or by scanning the QR code on the studio phone.
// The link is emailed when the contact is an email address. Automatic
// texting is NOT set up (Resend is email-only) — for "text" the studio texts
// the link from their own phone; the response says so (sms: "not_configured").
const { getStripe } = require("../lib/stripe");
const { kvSet } = require("../lib/kv");
const { sendEmail } = require("../lib/email");
const { money } = require("../lib/schedule");
const { SITE_URL, newId, getGift } = require("../lib/bookings");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const b = req.body || {};
    const amount = Math.round(parseFloat(b.amount) * 100);
    if (!amount || amount < 100) return res.status(400).json({ error: "Please enter the amount owed — $1 or more." });
    if (!b.clientName || !String(b.clientName).trim()) return res.status(400).json({ error: "Please add the client's name." });
    const method = ["text", "email", "qr"].includes(b.method) ? b.method : "text";
    const contact = String(b.contact || "").trim();
    if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      return res.status(400).json({ error: "Please add the client's email — the payment link is sent there." });
    }
    if (method === "text" && contact.replace(/[^0-9]/g, "").length < 10) {
      return res.status(400).json({ error: "Please add the client's mobile number — the payment link is texted there." });
    }

    // Optional gift code: its balance comes off what is owed.
    let giftCode = null;
    let giftAppliedCents = 0;
    if (b.giftCode && String(b.giftCode).trim()) {
      const gift = await getGift(b.giftCode);
      if (!gift) return res.status(400).json({ error: "That gift code was not found — check the code and try again." });
      if (!gift.balanceCents || gift.balanceCents <= 0) return res.status(400).json({ error: "That gift code has no balance left." });
      giftCode = gift.code;
      giftAppliedCents = Math.min(gift.balanceCents, amount);
    }
    const dueCents = amount - giftAppliedCents;
    const id = newId("pl");
    const serviceLabel = String(b.serviceLabel || "In2Skin visit").slice(0, 200);
    const clientName = String(b.clientName).trim();

    if (dueCents <= 0) {
      // Fully covered by the gift code — no payment link needed.
      const gift = await getGift(giftCode);
      gift.balanceCents = Math.max(0, gift.balanceCents - giftAppliedCents);
      await kvSet(`gift:${gift.code}`, gift);
      await kvSet(`paylink:${id}`, {
        id, amountCents: amount, dueCents: 0, clientName, contact, method,
        serviceLabel, giftCode, giftAppliedCents, paid: true, createdAt: new Date().toISOString(),
      });
      return res.status(200).json({ paid: true, id, giftApplied: giftAppliedCents / 100, amount: amount / 100 });
    }

    const stripe = getStripe();
    const link = await stripe.paymentLinks.create({
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: dueCents,
          product_data: { name: `${serviceLabel} — In2Skin`, description: `Payment for ${clientName} · In2Skin, Bolton, Ontario` },
        },
      }],
      payment_intent_data: { statement_descriptor: "IN2SKIN" },
      metadata: { type: "payspot", paylinkId: id, giftCode: giftCode || "", giftAppliedCents: String(giftAppliedCents) },
    });
    const url = `${SITE_URL}/pay?id=${id}`;
    await kvSet(`paylink:${id}`, {
      id, amountCents: amount, dueCents, clientName, contact, method,
      serviceLabel, giftCode, giftAppliedCents, stripeUrl: link.url,
      stripePaymentLinkId: link.id, paid: false, createdAt: new Date().toISOString(),
    });

    let sms = null;
    if (method === "email") {
      await sendEmail({
        to: contact,
        subject: `Your In2Skin payment link — ${money(dueCents)}`,
        html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin payment link</h2><p>Hi ${clientName.split(" ")[0] || "there"},</p><p>Here is your secure payment link for <strong>${serviceLabel}</strong> — <strong>${money(dueCents)}</strong>${giftAppliedCents ? ` (${money(giftAppliedCents)} was covered by your gift certificate)` : ""}:</p><p><a href="${url}">${url}</a></p><p>Pay by Visa, Mastercard, Amex or Apple Pay on your own phone. The charge shows as <strong>IN2SKIN</strong> on your card statement, and your receipt arrives the moment you pay.</p><p>— In2Skin, Bolton</p>`,
      });
    } else if (method === "text") {
      // Resend sends email only — there is no SMS provider wired up yet.
      sms = "not_configured";
    }
    return res.status(200).json({ url, stripeUrl: link.url, id, giftApplied: giftAppliedCents / 100, sms });
  } catch (err) {
    console.error("[pay-spot]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
