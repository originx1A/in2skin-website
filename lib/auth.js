// Admin auth: magic link (one-tap, no password) or login + password.
// Session = random token in KV + httpOnly cookie. Once signed in, the studio
// stays signed in for 30 days.
const crypto = require("crypto");
const { kvGet, kvSet, kvDel } = require("./kv");

const COOKIE = "in2skin_admin";
const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}; Secure`;
}

function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure`;
}

function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

function passwordMatches(input) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !input) return false;
  const a = sha(input);
  const b = sha(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminEmail() {
  return (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}

async function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  await kvSet(`session:${token}`, {
    email,
    createdAt: new Date().toISOString(),
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
  });
  return token;
}

async function getSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = await kvGet(`session:${token}`);
  if (!s || !s.exp || s.exp < Date.now()) return null;
  return { ...s, token };
}

async function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) await kvDel(`session:${token}`);
}

async function requireAdmin(req, res) {
  try {
    const s = await getSession(req);
    if (!s) {
      res.status(401).json({ error: "Not signed in. Please sign in from /admin/." });
      return null;
    }
    return s;
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
    return null;
  }
}

module.exports = {
  COOKIE, MAGIC_LINK_MINUTES,
  parseCookies, sessionCookie, clearSessionCookie,
  passwordMatches, adminEmail,
  createSession, getSession, destroySession, requireAdmin,
};
