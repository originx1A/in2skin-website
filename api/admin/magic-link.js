// POST /api/admin/magic-link { email } — email a one-tap sign-in link.
// Only the configured studio emails (ADMIN_EMAIL, comma-separated) ever
// receive one; the response is the same either way so the endpoint does
// not leak addresses.
const crypto = require("crypto");
const { kvSet } = require("../../lib/kv");
const { sendEmail } = require("../../lib/email");
const { adminEmails, MAGIC_LINK_MINUTES } = require("../../lib/auth");
const { SITE_URL } = require("../../lib/bookings");
const { checkLimit } = require("../../lib/rate-limit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  // 5 magic-link requests per hour per email + 10 per hour per IP — a
  // stolen inbox is not ours to stop, but nobody gets to spam the studio
  // inbox with sign-in links or probe which emails are studio emails.
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (email) {
    if (!(await checkLimit(req, res, { scope: "admin-magic-email", limit: 5, windowSecs: 3600, bucket: email }))) return;
  }
  if (!(await checkLimit(req, res, { scope: "admin-magic-ip", limit: 10, windowSecs: 3600 }))) return;
  try {
    const studios = adminEmails();
    if (studios.length && email && studios.includes(email)) {
      const token = crypto.randomBytes(32).toString("hex");
      await kvSet(`admin:magic:${token}`, { email, exp: Date.now() + MAGIC_LINK_MINUTES * 60 * 1000 });
      await sendEmail({
        to: email,
        subject: "Your In2Skin admin sign-in link",
        html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Sign in to In2Skin admin</h2><p>Tap the link below — it signs you in for 30 days, no password needed. It expires in ${MAGIC_LINK_MINUTES} minutes.</p><p><a href="${SITE_URL}/admin/?token=${token}">${SITE_URL}/admin/?token=${token}</a></p><p>If you did not ask for this, just ignore it.</p><p>— In2Skin</p>`,
      });
    } else if (!studios.length) {
      return res.status(503).json({ error: "Admin email is not configured yet: set ADMIN_EMAIL in the Vercel project settings, then redeploy." });
    }
    return res.status(200).json({ ok: true, message: "If that email is the studio email, a sign-in link is on its way." });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
