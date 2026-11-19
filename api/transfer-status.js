// GET /api/transfer-status — the voice agent's live check: may it transfer
// this call to Sarah right now? No sign-in needed: the answer is just
// yes/no plus a clock reading, no private data. On any error the agent
// takes a message instead of transferring. The response also carries
// transferMode ("agent_then_transfer" | "message_only" | "ring_me_first"),
// the legacy agentMode ("agent" | "direct"), and the period
// ("regular" | "private_hours" | "off") — and NEVER the forward-to number.
//
// POST /api/transfer-status — two callers, told apart by header:
//   x-agent-key (AGENT_API_KEY) → the voice agent's take_message: a caller
//     left a message (name, number, reason). Stored in KV, emailed to the
//     studio (Sarah's message list, or the studio emails), pop-up on her
//     phone. One callId makes at most one message.
//   x-retell-signature → Retell's inbound-call webhook (call_started /
//     call_ended / call_analyzed). The signature is HMAC-SHA256 of the raw
//     body, keyed by RETELL_WEBHOOK_SECRET (or AGENT_API_KEY when that is
//     unset — Retell signs with the API key). call_started answers with
//     dynamic_variables for the call (transfer allowed? which mode? the
//     forward-to number — only while a transfer is allowed). call_ended /
//     call_analyzed is the safety net: if a transfer failed, the call
//     failed, or a callback was promised but no message exists for the
//     call, a "Missed call" message is saved, emailed, and pushed so
//     nobody slips through. Every call is also written to the Recent
//     calls log (transcript / recording links stay in the admin view).
//
// Raw body is required for the Retell signature, so this function opts
// out of Vercel's JSON body parsing (see config below) and reads the
// body itself — the same path serves the agent's take_message.
const crypto = require("crypto");
const { getSettings, transferStatus, messageRecipients } = require("../lib/transfer");
const { saveMessage, findByCallId, deliverCallerMessage } = require("../lib/messages");
const { upsertCall } = require("../lib/calls");
const { adminEmails } = require("../lib/auth");

// The body, however it arrives: Vercel (bodyParser off) hands us a
// readable stream; tests hand us an already-parsed object. Returns
// { raw: Buffer, json: object }.
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      return { raw: Buffer.from(JSON.stringify(req.body)), json: req.body };
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
    try { return { raw, json: JSON.parse(raw.toString("utf8")) || {} }; }
    catch { return { raw, json: {} }; }
  }
  if (typeof req.on === "function") {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on("data", (c) => chunks.push(c));
      req.on("end", resolve);
      req.on("error", reject);
    });
    const raw = Buffer.concat(chunks);
    try { return { raw, json: raw.length ? JSON.parse(raw.toString("utf8")) : {} }; }
    catch { return { raw, json: {} }; }
  }
  return { raw: Buffer.from(""), json: {} };
}

function webhookSecret() {
  return process.env.RETELL_WEBHOOK_SECRET || process.env.AGENT_API_KEY || "";
}

// HMAC-SHA256 of the raw body, hex — Retell's x-retell-signature.
// Accepts a bare hex digest or a "sha256=" prefixed one.
function signatureValid(raw, signature) {
  const secret = webhookSecret();
  if (!secret) return false;
  const given = String(signature || "").replace(/^sha256=/i, "").trim();
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expect = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(given.toLowerCase());
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function recipientsFor(settings) {
  return messageRecipients(settings) || adminEmails();
}

// Retell payloads nest the call differently per event; read defensively.
function callFields(payload) {
  const call = (payload && payload.call) || payload || {};
  const analysis = call.call_analysis || payload.call_analysis || {};
  return {
    callId: String(call.call_id || payload.call_id || "").trim(),
    from: String(call.from_number || call.from || payload.from_number || "").trim(),
    name: String(call.from_name || analysis.caller_name || "").trim(),
    disconnectReason: String(call.disconnection_reason || payload.disconnection_reason || "").trim(),
    callSuccessful: analysis.call_successful,
    summary: String(analysis.call_summary || call.summary || "").trim(),
    transcript: String(call.transcript || payload.transcript || "").trim(),
    transcriptUrl: call.transcript_url || call.transcriptUrl || payload.transcript_url || "",
    recordingUrl: call.recording_url || call.recordingUrl || payload.recording_url || "",
    durationSec: call.duration_ms != null ? Math.round(call.duration_ms / 1000)
      : (call.duration_seconds || call.duration || null),
  };
}

function callbackPromised(text) {
  return /call\s+(?:her|him|them|me|us|you)?\s*back|call\s+me\b|ring\s+me\s+back/i.test(String(text || ""));
}

function transferFailed(reason) {
  return /transfer|fail|error|dial/i.test(String(reason || ""));
}

async function handleRetellWebhook(payload) {
  const event = String(payload.event || payload.type || "").trim();
  const f = callFields(payload);
  if (event === "call_started") {
    const settings = await getSettings();
    const status = transferStatus(settings);
    await upsertCall({
      callId: f.callId, from: f.from, name: f.name,
      startedAt: new Date().toISOString(), outcome: "started",
    });
    // dynamic_variables for the call: the forward-to number rides along
    // ONLY while a transfer is allowed — never when it isn't.
    const vars = {
      transfer_allowed: status.transferAllowed,
      transfer_mode: status.transferMode,
      agent_mode: status.agentMode,
      period: status.period,
      studio_now: status.now,
    };
    if (status.transferAllowed) vars.forward_to = settings.forwardTo;
    return { status: 200, body: { dynamic_variables: vars } };
  }
  if (event === "call_ended" || event === "call_analyzed") {
    const existing = await findByCallId(f.callId);
    const text = `${f.summary} ${f.transcript}`;
    const failed = transferFailed(f.disconnectReason) || f.callSuccessful === false;
    const promised = callbackPromised(text);
    let missedCallSaved = false;
    if (f.callId && !existing && (failed || promised)) {
      const reason = f.summary
        ? `Missed call — ${f.summary}`.slice(0, 1000)
        : "Missed call — the call ended before a message was taken.";
      const saved = await saveMessage({
        name: f.name || "Missed caller",
        phone: f.from,
        reason,
        callId: f.callId,
        source: "missed-call",
      });
      if (!saved.duplicate) {
        const settings = await getSettings();
        await deliverCallerMessage(saved, { to: recipientsFor(settings), missed: true });
        missedCallSaved = true;
      }
    }
    await upsertCall({
      callId: f.callId,
      from: f.from,
      name: f.name,
      endedAt: new Date().toISOString(),
      durationSec: f.durationSec,
      outcome: missedCallSaved ? "missed" : existing ? "message" : "ended",
      summary: f.summary,
      transcriptUrl: f.transcriptUrl,
      recordingUrl: f.recordingUrl,
    });
    return { status: 200, body: { ok: true, missedCallSaved } };
  }
  return { status: 200, body: { ok: true, ignored: true } };
}

async function handleTakeMessage(req, res, body) {
  const key = process.env.AGENT_API_KEY;
  if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
  if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
  const b = body || {};
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  const reason = String(b.reason || "").trim();
  if (!name) return res.status(400).json({ error: "Add the caller's name." });
  if (phone.replace(/[^0-9]/g, "").length < 7) return res.status(400).json({ error: "Add the caller's phone number." });
  const saved = await saveMessage({ name, phone, reason, callId: b.callId, source: "agent" });
  if (saved.duplicate) {
    return res.status(200).json({ ok: true, id: saved.id, emailed: false, duplicate: true });
  }
  const settings = await getSettings();
  const { emailed } = await deliverCallerMessage(saved, { to: recipientsFor(settings) });
  return res.status(200).json({ ok: true, id: saved.id, emailed });
}

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      // Retell's webhook carries its own signature; the agent's
      // take_message carries the agent key. Signature wins when both
      // are present (Retell never sends the agent key).
      if (req.headers["x-retell-signature"]) {
        if (!webhookSecret()) {
          return res.status(503).json({ error: "Retell webhook secret is not set." });
        }
        const { raw, json } = await readBody(req);
        if (!signatureValid(raw, req.headers["x-retell-signature"])) {
          return res.status(401).json({ error: "Retell signature not accepted." });
        }
        const out = await handleRetellWebhook(json);
        return res.status(out.status).json(out.body);
      }
      const { json } = await readBody(req);
      return handleTakeMessage(req, res, json);
    }
    const settings = await getSettings();
    return res.status(200).json(transferStatus(settings));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
