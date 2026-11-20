// Google OAuth connect for video consultations (Tony Nov 20, 2026):
// every video consult gets its own FRESH Google Meet link, created
// automatically through the Google Calendar API — never a shared link.
// Sarah signs into her Google account ONCE on Google's own consent
// screen and taps Allow; the site keeps only the refresh token (in KV,
// server-side only, never in the repo, never in chat or email) and mints
// a new Meet link per consult after that. No password ever changes
// hands, and she can take the permission away any time from her Google
// account settings or from the dashboard (Disconnect).
//
// The Google Cloud OAuth client does not exist yet — its client ID and
// secret arrive as env vars (GOOGLE_OAUTH_CLIENT_ID /
// GOOGLE_OAUTH_CLIENT_SECRET). Until they are set, every step fails
// cleanly with a plain message instead of crashing.
//
// Scope is the least privilege that can mint a Meet link:
// https://www.googleapis.com/auth/calendar.events — create calendar
// events only. Nothing else is ever requested.
const crypto = require("crypto");
const { kvGet, kvSet, kvDel } = require("./kv");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALLBACK_PATH = "/api/google-callback";

const TOKENS_KEY = "google:tokens";
const STATE_TTL_MS = 15 * 60 * 1000; // a connect link lives 15 minutes
const ACCESS_TOKEN_SKEW_MS = 60 * 1000; // refresh if under a minute left

function clientId() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
}

function clientSecret() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
}

function googleConfigured() {
  return Boolean(clientId() && clientSecret());
}

function notConfigured() {
  const e = new Error(
    "Google sign-in isn't set up yet — the studio keys are missing. " +
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the Vercel project settings, then redeploy."
  );
  e.code = "GOOGLE_NOT_CONFIGURED";
  e.status = 503;
  return e;
}

function needsReconnect() {
  const e = new Error(
    "Google isn't connected yet — connect it from the dashboard settings (Studio settings — Video consult links)."
  );
  e.code = "GOOGLE_NEEDS_RECONNECT";
  e.status = 401;
  return e;
}

// The OAuth redirect URI for this deployment, built from the request
// host — the same code runs on the Vercel preview and on the live
// domain, and Google requires the redirect URI to match exactly what
// was registered for that host. The apex boltonfacials.com 308s to
// www everywhere on the site, so it is normalised to www here: without
// this, a connect started from the apex would come back on www and the
// code exchange would fail with a redirect_uri mismatch.
function redirectUriFor(req) {
  const rawHost = String((req && req.headers && (req.headers.host || req.headers["x-forwarded-host"])) || "").trim();
  const host = rawHost.split(":")[0].toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)) {
    throw new Error("Cannot tell which address this site is on — the Google sign-in cannot start.");
  }
  const canonical = host === "boltonfacials.com" ? "www.boltonfacials.com" : host;
  return `https://${canonical}${CALLBACK_PATH}`;
}

// The Google authorization URL Sarah's browser is sent to. access_type
// offline asks Google for a refresh token; prompt consent makes Google
// issue one on every connect (otherwise it only comes the first time).
function buildAuthUrl({ redirectUri, state, clientId: id }) {
  const cid = String(id || clientId()).trim();
  if (!cid) throw notConfigured();
  if (!redirectUri) throw new Error("A redirect address is needed for the Google sign-in.");
  if (!state) throw new Error("A sign-in check token is needed for the Google sign-in.");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cid,
    redirect_uri: redirectUri,
    scope: CALENDAR_EVENTS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// One-time sign-in check token (CSRF protection for the callback):
// created when the connect starts, stored in KV, and consumed —
// deleted — by the callback. A callback without a live state token is
// refused. The token is random and carries no identity; it only proves
// the browser that came back from Google is the one that started the
// connect from the dashboard.
async function createState() {
  const state = crypto.randomBytes(32).toString("hex");
  await kvSet(`google:state:${state}`, { createdAt: Date.now() });
  return state;
}

async function consumeState(state) {
  const key = `google:state:${String(state || "")}`;
  const saved = await kvGet(key);
  await kvDel(key); // single-use: gone whether it was valid or not
  if (!saved || !saved.createdAt) return false;
  if (Date.now() - Number(saved.createdAt) > STATE_TTL_MS) return false;
  return true;
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String((data && (data.error_description || data.error)) || "").slice(0, 200);
    const err = new Error(
      detail ? `Google refused the sign-in (${detail}).` : `Google refused the sign-in (HTTP ${res.status}).`
    );
    err.status = 502;
    err.googleError = data && data.error;
    throw err;
  }
  return data;
}

// Swap the ?code= Google sent back for tokens. The redirect URI must be
// byte-identical to the one in the authorization URL.
async function exchangeCode({ code, redirectUri }) {
  if (!googleConfigured()) throw notConfigured();
  if (!code) throw new Error("Google did not send a sign-in code.");
  return postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

// Keep the tokens in KV, server-side only. Google only returns a
// refresh token on the first consent (or when prompt=consent forces
// one), so a code exchange that brings no refresh token keeps the one
// already stored. The stored record never leaves the server —
// getStatus() below is the only thing the dashboard ever sees.
async function storeTokens(tok) {
  const previous = (await kvGet(TOKENS_KEY)) || {};
  const refreshToken = String((tok && tok.refresh_token) || previous.refreshToken || "").trim();
  if (!refreshToken) {
    throw new Error("Google did not return a lasting sign-in — try connecting again.");
  }
  const record = {
    accessToken: String((tok && tok.access_token) || ""),
    refreshToken,
    expiresAt: Date.now() + Math.max(0, Number((tok && tok.expires_in) || 0)) * 1000,
    scope: String((tok && tok.scope) || previous.scope || CALENDAR_EVENTS_SCOPE),
    connectedAt: previous.connectedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await kvSet(TOKENS_KEY, record);
  return record;
}

async function getStoredTokens() {
  return (await kvGet(TOKENS_KEY)) || null;
}

async function refreshAccessToken(refreshToken) {
  if (!googleConfigured()) throw notConfigured();
  try {
    return await postForm(GOOGLE_TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err.googleError === "invalid_grant") {
      const e = needsReconnect();
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

// A usable access token: the stored one while it still has life, else a
// fresh one minted from the refresh token and saved back. Throws
// NEEDS_RECONNECT when there is nothing stored or Google has revoked
// the permission — the dashboard then shows the Connect button again.
async function getAccessToken() {
  const stored = await getStoredTokens();
  if (!stored || !stored.refreshToken) throw needsReconnect();
  if (stored.accessToken && stored.expiresAt && stored.expiresAt - Date.now() > ACCESS_TOKEN_SKEW_MS) {
    return stored.accessToken;
  }
  let tok;
  try {
    tok = await refreshAccessToken(stored.refreshToken);
  } catch (err) {
    if (err.code === "GOOGLE_NEEDS_RECONNECT") {
      // Google revoked the permission — forget the tokens here too, so
      // the dashboard shows Connect again instead of a dead connection.
      await kvDel(TOKENS_KEY);
    }
    throw err;
  }
  const updated = {
    ...stored,
    accessToken: String(tok.access_token || ""),
    expiresAt: Date.now() + Math.max(0, Number(tok.expires_in || 0)) * 1000,
    updatedAt: new Date().toISOString(),
  };
  await kvSet(TOKENS_KEY, updated);
  return updated.accessToken;
}

// What the dashboard may see: connected or not, and when — never any token.
async function getStatus() {
  const stored = await getStoredTokens();
  return {
    configured: googleConfigured(),
    connected: Boolean(stored && stored.refreshToken),
    connectedAt: (stored && stored.connectedAt) || null,
    scope: (stored && stored.scope) || null,
  };
}

// Disconnect: tell Google the tokens are dead (best-effort — a revoke
// that fails still ends with the tokens deleted here), then forget them.
async function disconnect() {
  const stored = await getStoredTokens();
  if (stored) {
    for (const token of [stored.refreshToken, stored.accessToken]) {
      if (!token) continue;
      try {
        await fetch(`${GOOGLE_REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST" });
      } catch { /* revoke is best-effort; the delete below is what counts */ }
    }
  }
  await kvDel(TOKENS_KEY);
  return { connected: false };
}

// Mint one fresh Meet link: a Calendar event on the connected Google
// account with a Meet conference attached. Called by the consult booking
// flow (lib/bookings.js mintConsultMeetLink) the moment a video
// consultation is paid, and by the admin meet-test action. No real event
// is created by the connect flow itself.
async function createMeetEvent({ accessToken, summary, description, startISO, endISO, attendeeEmail }) {
  if (!accessToken) throw new Error("A Google access token is needed to make a Meet link.");
  if (!startISO || !endISO) throw new Error("A start and end time are needed to make a Meet link.");
  const body = {
    summary: String(summary || "Video consultation — In2Skin"),
    description: String(description || ""),
    start: { dateTime: startISO, timeZone: "America/Toronto" },
    end: { dateTime: endISO, timeZone: "America/Toronto" },
    attendees: attendeeEmail ? [{ email: String(attendeeEmail) }] : [],
    conferenceData: {
      createRequest: {
        requestId: `in2skin-${crypto.randomBytes(12).toString("hex")}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
  const res = await fetch(`${GOOGLE_CALENDAR_EVENTS_URL}?conferenceDataVersion=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String((data && data.error && (data.error.message || data.error.status)) || "").slice(0, 200);
    const err = new Error(detail ? `Google could not make the Meet link (${detail}).` : `Google could not make the Meet link (HTTP ${res.status}).`);
    err.status = 502;
    throw err;
  }
  return {
    eventId: data.id || null,
    meetLink: (data.conferenceData && data.conferenceData.entryPoints
      && data.conferenceData.entryPoints.find((e) => e.entryPointType === "video")
      && data.conferenceData.entryPoints.find((e) => e.entryPointType === "video").uri)
      || data.hangoutLink || null,
    htmlLink: data.htmlLink || null,
  };
}

// Delete one Calendar event made by createMeetEvent — the other half of
// the per-consult link: a cancelled or deleted video consultation takes
// its Meet event with it, and a moved one deletes the old event after
// the new one is minted. An event that is already gone (404/410) counts
// as deleted, not an error. Any other failure throws.
async function deleteMeetEvent({ accessToken, eventId }) {
  if (!accessToken) throw new Error("A Google access token is needed to delete a Meet event.");
  if (!eventId) throw new Error("A calendar event id is needed to delete a Meet event.");
  const res = await fetch(`${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok || res.status === 404 || res.status === 410) return { deleted: true };
  const data = await res.json().catch(() => ({}));
  const detail = String((data && data.error && (data.error.message || data.error.status)) || "").slice(0, 200);
  const err = new Error(detail ? `Google could not delete the Meet event (${detail}).` : `Google could not delete the Meet event (HTTP ${res.status}).`);
  err.status = 502;
  throw err;
}

module.exports = {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_CALENDAR_EVENTS_URL,
  CALENDAR_EVENTS_SCOPE,
  CALLBACK_PATH,
  TOKENS_KEY,
  googleConfigured,
  notConfigured,
  needsReconnect,
  redirectUriFor,
  buildAuthUrl,
  createState,
  consumeState,
  exchangeCode,
  storeTokens,
  getStoredTokens,
  refreshAccessToken,
  getAccessToken,
  getStatus,
  disconnect,
  createMeetEvent,
  deleteMeetEvent,
};
