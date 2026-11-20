// Google OAuth connect tests — one-time sign-in so every video
// consultation gets its own fresh Meet link (Tony Nov 20, 2026).
// Run: node scripts/test-google-connect.js
// Uses an in-memory KV stub + stubbed admin auth + stubbed Google
// endpoints (no Stripe/KV/Resend/Google needed).
const assert = require("assert");

// --- in-memory KV, stubbed before any lib loads ---
const mem = new Map();
mem.set("backup:lastMonthly", new Date().toISOString());
const kvPath = require.resolve("../lib/kv");
require.cache[kvPath] = {
  exports: {
    configured: () => true,
    kvGet: async (k) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : null),
    kvSet: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); },
    kvDel: async (k) => { mem.delete(k); },
    pipeline: async () => { throw new Error("pipeline not available in tests"); },
  },
};
// --- admin auth stub: every data.js call is signed in as the studio ---
const authPath = require.resolve("../lib/auth");
require.cache[authPath] = {
  exports: {
    requireAdmin: async () => ({ email: "sarah@test.example" }),
    adminEmails: () => ["sarah@test.example", "tony@test.example"],
  },
};

// --- Google endpoint stubs (token / revoke / calendar) ---
const fetchCalls = [];
let tokenHandler = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  fetchCalls.push({ url: u, opts: opts || {} });
  if (u.startsWith("https://oauth2.googleapis.com/token")) {
    if (tokenHandler) return tokenHandler(u, opts);
    return {
      ok: true, status: 200,
      json: async () => ({
        access_token: "ya29.test-access", refresh_token: "1//test-refresh",
        expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events", token_type: "Bearer",
      }),
    };
  }
  if (u.startsWith("https://oauth2.googleapis.com/revoke")) {
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (u.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
    return {
      ok: true, status: 200,
      json: async () => ({
        id: "evt_test_1", hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
        htmlLink: "https://calendar.google.com/event?eid=evt_test_1",
        conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/aaa-bbbb-ccc" }] },
      }),
    };
  }
  throw new Error("unexpected fetch: " + u);
};

process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const G = require("../lib/google");
const dataHandler = require("../api/admin/data");

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.redirect = (c, u) => { res.statusCode = c; res.headers.Location = u; return res; };
  return res;
}
function mockReq({ method = "GET", headers = {}, body = null, query = {} } = {}) {
  return { method, headers, body, query };
}
async function callAdmin(body, query = {}, headers = {}) {
  const res = mockRes();
  await dataHandler(mockReq({ method: body ? "POST" : "GET", headers, body, query }), res);
  return res;
}
const HOST = { host: "in2skin-website-git-cooper-google-connect-20261120-tony-demilios-projects.vercel.app" };

async function run() {
  // ---------- 1. scope: calendar events only, nothing else ----------
  assert.equal(
    G.CALENDAR_EVENTS_SCOPE,
    "https://www.googleapis.com/auth/calendar.events",
    "scope is calendar events only"
  );
  assert.equal(G.CALLBACK_PATH, "/api/google-callback", "callback path is the short public path");

  // ---------- 2. auth URL shape ----------
  const authUrl = G.buildAuthUrl({
    redirectUri: "https://preview.example/api/google-callback",
    state: "state123",
  });
  const u = new URL(authUrl);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth", "auth URL is Google's");
  assert.equal(u.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com", "auth URL carries the client ID");
  assert.equal(u.searchParams.get("redirect_uri"), "https://preview.example/api/google-callback", "auth URL carries the exact redirect URI");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events", "auth URL asks for calendar events only");
  assert.equal(u.searchParams.get("response_type"), "code", "auth URL asks for a code");
  assert.equal(u.searchParams.get("access_type"), "offline", "auth URL asks for a refresh token");
  assert.equal(u.searchParams.get("prompt"), "consent", "auth URL forces consent so a refresh token is issued");
  assert.equal(u.searchParams.get("state"), "state123", "auth URL carries the state token");

  // ---------- 3. redirect URI from the request host ----------
  assert.equal(
    G.redirectUriFor({ headers: { host: "in2skin-website-git-cooper-google-connect-20261120-tony-demilios-projects.vercel.app" } }),
    "https://in2skin-website-git-cooper-google-connect-20261120-tony-demilios-projects.vercel.app/api/google-callback",
    "preview host builds the preview callback URL"
  );
  assert.equal(
    G.redirectUriFor({ headers: { host: "www.boltonfacials.com" } }),
    "https://www.boltonfacials.com/api/google-callback",
    "live host builds the live callback URL"
  );
  assert.equal(
    G.redirectUriFor({ headers: { host: "boltonfacials.com" } }),
    "https://www.boltonfacials.com/api/google-callback",
    "apex host is normalised to www (the apex 308s to www everywhere)"
  );
  assert.throws(
    () => G.redirectUriFor({ headers: {} }),
    /Cannot tell which address/,
    "no host header fails cleanly instead of building a broken URL"
  );

  // ---------- 4. start, unconfigured -> 503 plain message ----------
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  let res = await callAdmin({ view: "google-connect", action: "start" }, {}, HOST);
  assert.equal(res.statusCode, 503, "start without keys -> 503");
  assert.match(res.body.error, /isn't set up yet/, "start without keys says plainly what is missing");
  assert.equal(res.body.authUrl, undefined, "start without keys returns no auth URL");
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

  // ---------- 5. start, configured -> auth URL + single-use state ----------
  res = await callAdmin({ view: "google-connect", action: "start" }, {}, HOST);
  assert.equal(res.statusCode, 200, "start with keys -> 200");
  assert.ok(String(res.body.authUrl || "").startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), "start returns a Google auth URL");
  assert.equal(
    res.body.redirectUri,
    "https://in2skin-website-git-cooper-google-connect-20261120-tony-demilios-projects.vercel.app/api/google-callback",
    "start reports the redirect URI the Cloud client must register"
  );
  const state = new URL(res.body.authUrl).searchParams.get("state");
  assert.ok(state && state.length >= 32, "start mints a state token");
  const savedState = mem.get(`google:state:${state}`);
  assert.ok(savedState && savedState.createdAt, "state token is stored in KV");

  // ---------- 6. status view ----------
  res = await callAdmin(null, { view: "google-connect" }, HOST);
  assert.equal(res.statusCode, 200, "status view -> 200");
  assert.equal(res.body.configured, true, "status says configured once keys are set");
  assert.equal(res.body.connected, false, "status says not connected before any sign-in");
  assert.equal(res.body.connectedAt, null, "status carries no connected date before sign-in");

  // ---------- 7. callback without code/state -> dashboard ?google=error ----------
  res = await callAdmin(null, { view: "google-callback" }, HOST);
  assert.equal(res.statusCode, 302, "callback without code/state redirects");
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=error#sec-settings", "callback without code/state -> ?google=error");

  // ---------- 8. callback with a bad state -> ?google=error ----------
  res = await callAdmin(null, { view: "google-callback", code: "authcode1", state: "no-such-state" }, HOST);
  assert.equal(res.statusCode, 302, "callback with a bad state redirects");
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=error#sec-settings", "callback with a bad state -> ?google=error");

  // ---------- 9. callback denied at Google -> ?google=denied, nothing stored ----------
  res = await callAdmin(null, { view: "google-callback", error: "access_denied", state }, HOST);
  assert.equal(res.statusCode, 302, "denied callback redirects");
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=denied#sec-settings", "denied callback -> ?google=denied");
  assert.equal(mem.get(G.TOKENS_KEY), undefined, "denied callback stores no tokens");
  assert.ok(mem.get(`google:state:${state}`), "denied callback does not burn the state (no exchange was attempted)");

  // ---------- 10. callback happy path -> ?google=connected, tokens stored ----------
  const callsBefore = fetchCalls.length;
  res = await callAdmin(null, { view: "google-callback", code: "authcode1", state }, HOST);
  assert.equal(res.statusCode, 302, "good callback redirects");
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=connected#sec-settings", "good callback -> ?google=connected");
  const stored = mem.get(G.TOKENS_KEY);
  assert.ok(stored, "good callback stores tokens");
  assert.equal(stored.refreshToken, "1//test-refresh", "refresh token is stored");
  assert.equal(stored.accessToken, "ya29.test-access", "access token is stored");
  assert.ok(stored.expiresAt > Date.now(), "stored access token has a future expiry");
  assert.ok(stored.connectedAt, "stored record carries the connected date");
  assert.equal(mem.get(`google:state:${state}`), undefined, "state is consumed — single-use");
  const tokenCall = fetchCalls.slice(callsBefore).find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
  assert.ok(tokenCall, "callback exchanges the code at Google's token endpoint");
  const tokenBody = new URLSearchParams(String(tokenCall.opts.body || ""));
  assert.equal(tokenBody.get("grant_type"), "authorization_code", "exchange uses the code grant");
  assert.equal(tokenBody.get("code"), "authcode1", "exchange sends the code Google gave");
  assert.equal(
    tokenBody.get("redirect_uri"),
    "https://in2skin-website-git-cooper-google-connect-20261120-tony-demilios-projects.vercel.app/api/google-callback",
    "exchange sends the exact redirect URI from the auth URL"
  );
  // Replay the same state: already consumed, so it must fail.
  res = await callAdmin(null, { view: "google-callback", code: "authcode2", state }, HOST);
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=error#sec-settings", "replaying a consumed state fails");

  // ---------- 11. status after connect + settings GET carries it ----------
  res = await callAdmin(null, { view: "google-connect" }, HOST);
  assert.equal(res.body.connected, true, "status says connected after sign-in");
  assert.equal(res.body.connectedAt, stored.connectedAt, "status carries the connected date");
  assert.equal(res.body.refreshToken, undefined, "status never leaks the refresh token");
  assert.equal(res.body.accessToken, undefined, "status never leaks the access token");
  res = await callAdmin(null, { view: "settings" }, HOST);
  assert.equal(res.statusCode, 200, "settings GET -> 200");
  assert.equal(res.body.google.connected, true, "settings GET carries the Google status");

  // ---------- 12. exchange failure -> ?google=error, nothing stored ----------
  await G.disconnect();
  tokenHandler = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: "invalid_grant", error_description: "Bad Request" }),
  });
  const state2 = await G.createState();
  res = await callAdmin(null, { view: "google-callback", code: "badcode", state: state2 }, HOST);
  assert.equal(res.headers.Location, "/admin/dashboard.html?google=error#sec-settings", "failed exchange -> ?google=error");
  assert.equal(mem.get(G.TOKENS_KEY), undefined, "failed exchange stores nothing");
  tokenHandler = null;

  // ---------- 13. exchange without a refresh token keeps the stored one ----------
  await G.storeTokens({ access_token: "ya29.first", refresh_token: "1//kept-refresh", expires_in: 3600 });
  const kept = await G.exchangeCode({ code: "authcode3", redirectUri: "https://preview.example/api/google-callback" });
  assert.ok(kept.access_token, "exchange still returns an access token");
  await G.storeTokens({ access_token: kept.access_token, expires_in: 3600 }); // no refresh_token this time
  assert.equal((await G.getStoredTokens()).refreshToken, "1//kept-refresh", "a code exchange without a refresh token keeps the stored one");

  // ---------- 14. getAccessToken: valid as-is, refresh when expired ----------
  assert.equal(await G.getAccessToken(), "ya29.test-access", "valid stored access token is returned as-is");
  const callsBeforeRefresh = fetchCalls.length;
  await G.storeTokens({ access_token: "ya29.stale", refresh_token: "1//kept-refresh", expires_in: -10 });
  const refreshed = await G.getAccessToken();
  assert.equal(refreshed, "ya29.test-access", "expired access token is refreshed from the refresh token");
  const refreshCall = fetchCalls.slice(callsBeforeRefresh).find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
  assert.ok(refreshCall, "refresh calls Google's token endpoint");
  assert.equal(new URLSearchParams(String(refreshCall.opts.body || "")).get("grant_type"), "refresh_token", "refresh uses the refresh grant");
  assert.equal((await G.getStoredTokens()).accessToken, "ya29.test-access", "refreshed access token is saved back");

  // ---------- 15. refresh refused (invalid_grant) -> tokens cleared, reconnect needed ----------
  tokenHandler = async (u, opts) => {
    if (String(opts.body || "").includes("grant_type=refresh_token")) {
      return { ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ access_token: "ya29.test-access", refresh_token: "1//test-refresh", expires_in: 3600, scope: G.CALENDAR_EVENTS_SCOPE }),
    };
  };
  await G.storeTokens({ access_token: "ya29.stale", refresh_token: "1//revoked", expires_in: -10 });
  await assert.rejects(G.getAccessToken(), (e) => e.code === "GOOGLE_NEEDS_RECONNECT", "revoked refresh token asks for a reconnect");
  assert.equal(mem.get(G.TOKENS_KEY), undefined, "revoked refresh token is cleared so the dashboard shows Connect again");
  tokenHandler = null;

  // ---------- 16. disconnect revokes + forgets ----------
  await G.storeTokens({ access_token: "ya29.test-access", refresh_token: "1//test-refresh", expires_in: 3600 });
  const revokeBefore = fetchCalls.length;
  res = await callAdmin({ view: "google-connect", action: "disconnect" }, {}, HOST);
  assert.equal(res.statusCode, 200, "disconnect -> 200");
  assert.equal(res.body.connected, false, "disconnect reports not connected");
  assert.equal(mem.get(G.TOKENS_KEY), undefined, "disconnect forgets the tokens");
  assert.ok(
    fetchCalls.slice(revokeBefore).some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke")),
    "disconnect tells Google to revoke the tokens"
  );
  res = await callAdmin(null, { view: "google-connect" }, HOST);
  assert.equal(res.body.connected, false, "status says not connected after disconnect");

  // ---------- 17. createMeetEvent: correct request, returns the Meet link ----------
  const meet = await G.createMeetEvent({
    accessToken: "ya29.test-access",
    summary: "Video consultation — In2Skin",
    description: "Consultation with Sarah.",
    startISO: "2026-11-23T14:00:00-05:00",
    endISO: "2026-11-23T14:20:00-05:00",
    attendeeEmail: "client@test.example",
  });
  assert.equal(meet.meetLink, "https://meet.google.com/aaa-bbbb-ccc", "minting returns the Meet link");
  assert.equal(meet.eventId, "evt_test_1", "minting returns the event id");
  const calCall = fetchCalls[fetchCalls.length - 1];
  assert.ok(calCall.url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"), "minting calls the Calendar API with conference data enabled");
  const calBody = JSON.parse(String(calCall.opts.body || "{}"));
  assert.equal(calBody.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet", "minting asks for a Meet conference");
  assert.equal(calBody.start.dateTime, "2026-11-23T14:00:00-05:00", "minting uses the consult start");
  assert.equal(calBody.end.dateTime, "2026-11-23T14:20:00-05:00", "minting uses the consult end");
  assert.deepEqual(calBody.attendees, [{ email: "client@test.example" }], "minting invites the client");
  await assert.rejects(
    G.createMeetEvent({ accessToken: "", startISO: "2026-11-23T14:00:00-05:00", endISO: "2026-11-23T14:20:00-05:00" }),
    /access token is needed/,
    "minting without a token fails plainly"
  );

  // ---------- 18. audit trail: the connect was logged ----------
  const auditIds = mem.get("audit:all") || [];
  assert.ok(auditIds.length >= 1, "admin actions were audited");
  const auditEntry = mem.get(`audit:${auditIds[0]}`);
  assert.ok(auditEntry && /google/.test(auditEntry.action), "the Google connect is in the audit log");

  console.log("google-connect: all tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
