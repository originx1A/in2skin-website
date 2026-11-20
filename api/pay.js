// /api/pay — pay on the spot, one function for both sides:
//   GET ?id=... → what /pay.html fetches (was /api/pay-link)
//   GET ?session_id=... → what /pay-paid.html fetches after Stripe checkout:
//     retrieves the session from Stripe, verifies it is a paid payspot
//     session, and settles it through markPaylinkPaid — the same step the
//     webhook runs. The webhook never fired for the Nov 17 test payment
//     (zero invocations in the Vercel logs), so the redirect page is the
//     fallback that marks the link paid; either order is safe (idempotent).
//   POST → the studio creates a Stripe payment link (was /api/pay-spot).
//     Admin-only: the creation form lives in the dashboard behind
//     Sarah's sign-in (Tony Nov 19, 2026); GET redemption stays public.
// The client pays on THEIR OWN phone: by text, by email, or by scanning the
// QR code on the studio phone. The link is emailed when the contact is an
// email address. Automatic texting is NOT set up (Resend is email-only) —
// for "text" the studio texts the link from their own phone; the response
// says so (sms: "not_configured").
// The link creation lives in lib/bookings.js (createPayLink) so the admin
// "send a pay link" action for a booking balance shares the same path.
// Merged because Vercel Hobby allows 12 serverless functions per deployment.
const { kvGet } = require("../lib/kv");
const { getStripe } = require("../lib/stripe");
const { createPayLink, markPaylinkPaid } = require("../lib/bookings");
const { checkLimit } = require("../lib/rate-limit");
const { requireAdmin } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method === "POST") {
    // 10 pay-link creations per minute per IP.
    if (!(await checkLimit(req, res, { scope: "pay", limit: 10, windowSecs: 60 }))) return;
  }
  try {
    if (req.method === "GET") {
      if (req.query.session_id) {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        if (session.payment_status !== "paid") {
          return res.status(200).json({ paid: false });
        }
        const meta = session.metadata || {};
        if (meta.type !== "payspot" || !meta.paylinkId) {
          return res.status(400).json({ error: "That payment is not a pay-on-the-spot payment." });
        }
        const rec = await markPaylinkPaid(session);
        if (!rec) return res.status(404).json({ error: "Payment link not found." });
        return res.status(200).json({
          paid: true,
          id: rec.id,
          amountCents: session.amount_total || rec.dueCents,
          dueCents: rec.dueCents,
          serviceLabel: rec.serviceLabel,
          clientName: rec.clientName,
          paidAt: rec.paidAt || null,
        });
      }
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
    // Creating a pay link is the studio's tool (Tony Nov 19, 2026) — the
    // dashboard's Pay on the spot form, behind Sarah's sign-in. The
    // session cookie travels on the dashboard's same-origin fetch, so
    // this also keeps the old public form from ever working again.
    // GET redemption (the client's /pay.html link) stays public.
    if (!(await requireAdmin(req, res))) return;
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
