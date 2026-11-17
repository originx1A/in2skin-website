// Email via Resend (free tier). From: bookings@boltonfacials.com.
// If RESEND_API_KEY is unset, sending is skipped (logged, never throws) so a
// missing email key can never break a booking or payment.
const FROM = process.env.EMAIL_FROM || "In2Skin <bookings@boltonfacials.com>";

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[email skipped — RESEND_API_KEY not set]", subject, "->", to);
    return false;
  }
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: recipients,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ""),
      }),
    });
    if (!res.ok) {
      console.error("[email failed]", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email error]", err.message);
    return false;
  }
}

module.exports = { sendEmail, FROM };
