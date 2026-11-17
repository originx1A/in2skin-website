// GET /api/admin/session — { signedIn, email } for the admin pages.
// POST /api/admin/session with { action: "logout" } signs out.
const { getSession, destroySession, clearSessionCookie } = require("../../lib/auth");

module.exports = async (req, res) => {
  try {
    if (req.method === "POST" && (req.body || {}).action === "logout") {
      await destroySession(req);
      res.setHeader("Set-Cookie", clearSessionCookie());
      return res.status(200).json({ ok: true });
    }
    const s = await getSession(req);
    if (!s) return res.status(200).json({ signedIn: false });
    return res.status(200).json({ signedIn: true, email: s.email });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
