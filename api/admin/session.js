// GET /api/admin/session — { signedIn, email } for the admin pages.
// POST /api/admin/session with { action: "logout" } signs out.
// POST /api/admin/session with { token } exchanges a magic-link token for a
// session cookie, then the studio stays signed in for 30 days.
// (Was /api/admin/verify — merged: Vercel Hobby allows 12 functions.)
const { kvGet, kvDel } = require("../../lib/kv");
const { getSession, destroySession, clearSessionCookie, createSession, sessionCookie } = require("../../lib/auth");

module.exports = async (req, res) => {
  try {
    if (req.method === "POST" && (req.body || {}).action === "logout") {
      await destroySession(req);
      res.setHeader("Set-Cookie", clearSessionCookie());
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST" && (req.body || {}).token) {
      const token = String(req.body.token).trim();
      const rec = await kvGet(`admin:magic:${token}`);
      if (!rec || !rec.exp || rec.exp < Date.now()) {
        return res.status(400).json({ error: "That sign-in link has expired or was already used — request a fresh one." });
      }
      await kvDel(`admin:magic:${token}`);
      const session = await createSession(rec.email);
      res.setHeader("Set-Cookie", sessionCookie(session));
      return res.status(200).json({ ok: true });
    }
    if (req.method === "POST") return res.status(400).json({ error: "Missing token." });
    const s = await getSession(req);
    if (!s) return res.status(200).json({ signedIn: false });
    return res.status(200).json({ signedIn: true, email: s.email });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
