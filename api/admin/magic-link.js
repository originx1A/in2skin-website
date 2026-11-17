// POST /api/admin/magic-link { email } — email a one-tap sign-in link.
// Only the configured studio email (ADMIN_EMAIL) ever receives one; the
// response is the same either way so the endpoint does not leak addresses.
const crypto = require("crypto");
const { kvSet } = require("../../lib/kv");
const { sendEmail } = require("../../lib/email");
const { adminEmail, MAGIC_LINK_MINUTES } = require("../../lib/auth");
const { SITE_URL } = require("../../lib/bookings");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    const studio = adminEmail();
    if (studio && email && email === studio) {
      const token = crypto.randomBytes(32).toString("hex");
      await kvSet(`admin:magic:${token}`, { email, exp: Date.now() + MAGIC_LINK_MINUTES * 60 * 1000 });
      await sendEmail({
        to: email,
        subject: "Your In2Skin admin sign-in link",
        html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Sign in to In2Skin admin</h2><p>Tap the link below — it signs you in for 30 days, no password needed. It expires in ${MAGIC_LINK_MINUTES} minutes.</p><p><a href="${SITE_URL}/admin/?token=${token}">${SITE_URL}/admin/?token=${token}</a></p><p>If you did not ask for this, just ignore it.</p><p>— In2Skin</p>`,
      });
    } else if (!studio) {
      return res.status(503).json({ error: "Admin email is not configured yet: set ADMIN_EMAIL in the Vercel project settings, then redeploy." });
    }
    return res.status(200).json({ ok: true, message: "If that email is the studio email, a sign-in link is on its way." });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
