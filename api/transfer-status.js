// GET /api/transfer-status — the voice agent's live check: may it transfer
// this call to Sarah right now? No sign-in needed: the answer is just
// yes/no plus a clock reading, no private data. On any error the agent
// takes a message instead of transferring. The response also carries
// agentMode ("agent" | "direct") — the agent reads it from this same check:
// "direct" means put every caller straight through while transfers are
// allowed; outside her hours it still takes a message.
//
// POST /api/transfer-status — the voice agent's take_message: a caller left
// a message (name, number, reason). Authenticated by the AGENT_API_KEY env
// var (header x-agent-key), the same check as the agent-hold path in
// api/book.js. Stores the message in KV and emails it to the studio
// (Sarah + Tony). Email never throws — a missing key just means no email.
const { getSettings, transferStatus } = require("../lib/transfer");
const { saveMessage } = require("../lib/messages");
const { notifyPush } = require("../lib/push");
const { sendEmail } = require("../lib/email");
const { adminEmails } = require("../lib/auth");

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const key = process.env.AGENT_API_KEY;
      if (!key) return res.status(503).json({ error: "AGENT_API_KEY is not set." });
      if (req.headers["x-agent-key"] !== key) return res.status(401).json({ error: "Agent key not accepted." });
      const b = req.body || {};
      const name = String(b.name || "").trim();
      const phone = String(b.phone || "").trim();
      const reason = String(b.reason || "").trim();
      if (!name) return res.status(400).json({ error: "Add the caller's name." });
      if (phone.replace(/[^0-9]/g, "").length < 7) return res.status(400).json({ error: "Add the caller's phone number." });
      const record = await saveMessage({ name, phone, reason, callId: b.callId });
      const to = adminEmails();
      let emailed = false;
      if (to.length) {
        const when = new Date(record.receivedAt).toLocaleString("en-CA", {
          timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
        });
        emailed = await sendEmail({
          to,
          subject: "New message from a caller — In2Skin",
          html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">New message from a caller</h2><p><strong>${escapeHtml(name)}</strong> called while the studio couldn't answer.</p><ul><li>Phone: <a href="tel:${phone.replace(/[^0-9+]/g, "")}">${escapeHtml(phone)}</a></li><li>Reason: ${escapeHtml(reason || "No reason given.")}</li><li>When: ${escapeHtml(when)} (Toronto time)</li></ul><p>Call them back at ${escapeHtml(phone)}, or see all messages on the studio dashboard.</p><p>— In2Skin, Bolton</p>`,
        });
      }
      // Same moment as the email: a pop-up on the studio phone +
      // a dashboard event (chime + banner while it is open).
      await notifyPush({
        type: "message",
        title: "New message from a caller",
        body: `${name} — ${reason || "No reason given."}`,
      });
      return res.status(200).json({ ok: true, id: record.id, emailed });
    }
    const settings = await getSettings();
    return res.status(200).json(transferStatus(settings));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
