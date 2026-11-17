// POST /api/admin/login { password } — password sign-in (ADMIN_PASSWORD).
// Sets the same 30-day session cookie as the magic link.
const { passwordMatches, createSession, sessionCookie, adminEmail } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    if (!process.env.ADMIN_PASSWORD) {
      return res.status(503).json({ error: "Password sign-in is not configured yet: set ADMIN_PASSWORD in the Vercel project settings, then redeploy." });
    }
    if (!passwordMatches((req.body || {}).password)) {
      return res.status(401).json({ error: "That password did not match." });
    }
    const session = await createSession(adminEmail() || "studio");
    res.setHeader("Set-Cookie", sessionCookie(session));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
