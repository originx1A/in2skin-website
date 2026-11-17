// /api/pay — pay on the spot, one function for both sides:
//   GET ?id=... → what /pay.html fetches (was /api/pay-link)
//   POST → the studio creates a Stripe payment link (was /api/pay-spot)
// The client pays on THEIR OWN phone: by text, by email, or by scanning the
// QR code on the studio phone. The link is emailed when the contact is an
// email address. Automatic texting is NOT set up (Resend is email-only) —
// for "text" the studio texts the link from their own phone; the response
// says so (sms: "not_configured").
// The link creation lives in lib/bookings.js (createPayLink) so the admin
// "send a pay link" action for a booking balance shares the same path.
// Merged because Vercel Hobby allows 12 serverless functions per deployment.
const { kvGet } = require("../lib/kv");
const { createPayLink } = require("../lib/bookings");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const rec = await kvGet(`paylink:${req.query.id}`);
      if (!rec) return res.status(404).json({ error: "Payment link not found." });
      return res.status(200).json({
        id: rec.id,
        stripeUrl: rec.stripeUrl || null,
        amountCents: rec.amountCents,
        dueCents: rec.dueCents,
        serviceLabel: rec.serviceLabel,
        clientName: rec.clientName,
        paid: !!rec.paid,
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const b = req.body || {};
    const amountCents = Math.round(parseFloat(b.amount) * 100);
    const out = await createPayLink({
      amountCents,
      clientName: b.clientName,
      contact: b.contact,
      method: b.method,
      serviceLabel: b.serviceLabel,
      giftCode: b.giftCode,
    });
    if (out.paid) {
      return res.status(200).json({ paid: true, id: out.id, giftApplied: out.giftAppliedCents / 100, amount: out.amountCents / 100 });
    }
    return res.status(200).json({ url: out.url, stripeUrl: out.stripeUrl, id: out.id, giftApplied: out.giftAppliedCents / 100, sms: out.sms || null });
  } catch (err) {
    console.error("[pay]", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
