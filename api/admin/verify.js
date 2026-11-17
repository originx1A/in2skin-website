// POST /api/admin/verify { token } — exchange a magic-link token for a
// session cookie, then the studio stays signed in for 30 days.
const { kvGet, kvDel } = require("../../lib/kv");
const { createSession, sessionCookie } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const token = String((req.body || {}).token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token." });
    const rec = await kvGet(`admin:magic:${token}`);
    if (!rec || !rec.exp || rec.exp < Date.now()) {
      return res.status(400).json({ error: "That sign-in link has expired or was already used — request a fresh one." });
    }
    await kvDel(`admin:magic:${token}`);
    const session = await createSession(rec.email);
    res.setHeader("Set-Cookie", sessionCookie(session));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
