// Shared booking + gift-certificate storage logic (Vercel KV).
// Keys:
//   booking:<id>                 booking record
//   bookings:date:<YYYY-MM-DD>   JSON array of booking ids for that day
//   gift:<CODE>                  gift certificate record (never expires)
//   gift:session:<checkout id>   code issued for a gift checkout session
//   paylink:<id>                 pay-on-the-spot record
//   payment:<id>                 completed payment record
//   payments:all                 JSON array of payment ids (newest last)
const crypto = require("crypto");
const { kvGet, kvSet } = require("./kv");
const { sendEmail } = require("./email");
const { money } = require("./schedule");

const SITE_URL = (process.env.SITE_URL || "https://boltonfacials.com").replace(/\/$/, "");
const PHONE_DISPLAY = "(289) 212-4124"; // live Ringbreeze number — forwards to Sarah's phone (forwarding set up in Retell)

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(10).toString("hex");
}

function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

/* ---------------- bookings ---------------- */

async function saveBooking(booking) {
  await kvSet(`booking:${booking.id}`, booking);
  const key = `bookings:date:${booking.date}`;
  const ids = (await kvGet(key)) || [];
  if (!ids.includes(booking.id)) {
    ids.push(booking.id);
    await kvSet(key, ids);
  }
  return booking;
}

async function getBooking(id) {
  if (!id) return null;
  return kvGet(`booking:${id}`);
}

async function listBookingsForDate(dateStr) {
  const ids = (await kvGet(`bookings:date:${dateStr}`)) || [];
  const out = [];
  for (const id of ids) {
    const b = await kvGet(`booking:${id}`);
    if (b) out.push(b);
  }
  return out.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

async function listBookingsRange(fromStr, toStr) {
  const out = [];
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(...(await listBookingsForDate(key)));
  }
  return out;
}

/* ---------------- gift certificates ---------------- */

const GIFT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newGiftCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += GIFT_ALPHABET[crypto.randomInt(GIFT_ALPHABET.length)];
  return "IN2SKIN-" + code;
}

function normalizeGiftCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[\s-]/g, "").replace(/^IN2SKIN/, "IN2SKIN-");
}

async function getGift(rawCode) {
  const code = normalizeGiftCode(rawCode);
  if (!code.startsWith("IN2SKIN-")) return null;
  return kvGet(`gift:${code}`);
}

// Deduct a gift balance once (guarded by booking.giftDeducted).
async function deductGift(booking) {
  if (!booking.giftCode || !booking.giftAppliedCents || booking.giftDeducted) return 0;
  const gift = await getGift(booking.giftCode);
  if (!gift) return 0;
  gift.balanceCents = Math.max(0, gift.balanceCents - booking.giftAppliedCents);
  await kvSet(`gift:${gift.code}`, gift);
  booking.giftDeducted = true;
  await kvSet(`booking:${booking.id}`, booking);
  return booking.giftAppliedCents;
}

// Issue a gift code for a paid gift checkout session (idempotent: the
// gift:session key means a second call — webhook + status page — is a no-op).
async function ensureGiftCode(session) {
  const meta = session.metadata || {};
  const existing = await kvGet(`gift:session:${session.id}`);
  if (existing) return existing;
  const code = newGiftCode();
  const record = {
    code,
    balanceCents: Number(meta.amountCents || session.amount_total || 0),
    originalCents: Number(meta.amountCents || session.amount_total || 0),
    buyerName: meta.buyerName || "",
    buyerEmail: meta.buyerEmail || "",
    recipientName: meta.recipientName || "",
    recipientEmail: meta.recipientEmail || "",
    message: meta.message || "",
    createdAt: new Date().toISOString(),
    expiresAt: null, // gift codes NEVER expire
    checkoutSessionId: session.id,
  };
  await kvSet(`gift:${code}`, record);
  await kvSet(`gift:session:${session.id}`, record);
  return record;
}

/* ---------------- payments ---------------- */

async function recordPayment(payment) {
  await kvSet(`payment:${payment.id}`, payment);
  const ids = (await kvGet("payments:all")) || [];
  if (!ids.includes(payment.id)) {
    ids.push(payment.id);
    await kvSet("payments:all", ids);
  }
  return payment;
}

async function listPayments(fromStr, toStr) {
  const ids = (await kvGet("payments:all")) || [];
  const out = [];
  for (const id of ids) {
    const p = await kvGet(`payment:${id}`);
    if (!p) continue;
    const day = (p.createdAt || "").slice(0, 10);
    if (fromStr && day < fromStr) continue;
    if (toStr && day > toStr) continue;
    out.push(p);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/* ---------------- emails ---------------- */

function bookingEmailHtml(b) {
  const who = b.forWhom === "friend" && b.guestName ? b.guestName : b.name;
  const lines = [
    `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin booking is confirmed</h2>`,
    `<p>Hi ${String(who || "").split(" ")[0] || "there"},</p>`,
    `<p>Your appointment is booked in:</p>`,
    `<ul><li><strong>${b.serviceName}</strong> — ${b.minsLabel || ""}</li>`,
    `<li>${fmtDateLong(b.date)} at ${b.time}${b.type === "after" ? " (Private Hours)" : ""}</li>`,
    `<li>In2Skin · Bolton, Ontario — directions are shared when you book</li>`,
    `<li>Paid: <strong>${money(b.amountPaidCents || 0)}</strong>${b.giftAppliedCents ? ` (includes ${money(b.giftAppliedCents)} from gift certificate ${b.giftCode})` : ""}${b.firstVisitDiscountCents ? " (includes the $10 first-visit offer)" : ""}</li></ul>`,
    `<p>The charge shows as <strong>IN2SKIN</strong> on your card statement.</p>`,
    b.serviceName === "Chemical Peels"
      ? `<p>Your peel is booked at the $95 starting price — the exact price ($95–$475) is confirmed at your consultation, and any balance is settled at your visit.</p>` : "",
    b.servicePriceLabel === "Custom"
      ? `<p>This is a consultation booking — the exact price is confirmed at your consultation. No payment was due now.</p>` : "",
    `<p>Need to move your appointment? Please call at least 24 hours ahead (${PHONE_DISPLAY}) and we will find you a new time — there is no charge to reschedule.</p>`,
    `<p>We look forward to welcoming you.<br/>— In2Skin, Bolton</p>`,
  ];
  return lines.join("\n");
}

async function sendBookingConfirmation(booking) {
  if (booking.emailSent) return false;
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const ok = await sendEmail({
    to,
    subject: `Your In2Skin booking is confirmed — ${booking.serviceName}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: bookingEmailHtml(booking),
  });
  if (ok) {
    booking.emailSent = true;
    await kvSet(`booking:${booking.id}`, booking);
  }
  return ok;
}

function giftCertificateHtml(gift) {
  return [
    `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;border:1px solid #D3C29E;border-radius:8px;padding:28px;background:#FDF8EC;">`,
    `<h2 style="color:#2F4A2C;margin:0 0 6px;">A gift for you — from ${gift.buyerName || "a friend"}</h2>`,
    `<p style="color:#5A5041;">${gift.message ? `“${gift.message}”` : "Enjoy some you-time at In2Skin, Bolton."}</p>`,
    `<p style="font-size:28px;letter-spacing:.12em;text-align:center;background:#F3EAD3;border:1px solid #D3C29E;border-radius:8px;padding:18px 10px;margin:20px 0;"><strong>${gift.code}</strong></p>`,
    `<p style="text-align:center;"><strong>${money(gift.originalCents)}</strong> toward any treatment at In2Skin · Bolton, Ontario</p>`,
    `<p style="color:#5A5041;">Book online at <a href="${SITE_URL}/#book">boltonfacials.com</a> or call ${PHONE_DISPLAY} and give the code when you book. This certificate never expires, and any balance left after a visit stays on the code.</p>`,
    `<p style="color:#5A5041;">— In2Skin, Bolton</p></div>`,
  ].join("\n");
}

async function sendGiftCertificate(gift) {
  if (gift.certificateSent) return false;
  const ok = await sendEmail({
    to: gift.recipientEmail,
    subject: `A gift from ${gift.buyerName || "a friend"} — your In2Skin gift certificate (${money(gift.originalCents)})`,
    html: giftCertificateHtml(gift),
  });
  if (ok) {
    gift.certificateSent = true;
    await kvSet(`gift:${gift.code}`, gift);
    await kvSet(`gift:session:${gift.checkoutSessionId}`, gift);
  }
  return ok;
}

async function sendGiftReceipt(gift) {
  if (!gift.buyerEmail) return false;
  return sendEmail({
    to: gift.buyerEmail,
    subject: `Your In2Skin gift certificate receipt — ${money(gift.originalCents)} for ${gift.recipientName || "your friend"}`,
    html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Thank you — your gift is on its way</h2><p>Hi ${String(gift.buyerName || "").split(" ")[0] || "there"},</p><p>Your <strong>${money(gift.originalCents)}</strong> In2Skin gift certificate for <strong>${gift.recipientName || "your friend"}</strong> is paid. The certificate code <strong>${gift.code}</strong> has been emailed to them at ${gift.recipientEmail}.</p><p>The charge shows as <strong>IN2SKIN</strong> on your card statement. Gift codes never expire.</p><p>— In2Skin, Bolton</p>`,
  });
}

module.exports = {
  SITE_URL, PHONE_DISPLAY,
  newId, fmtDateLong,
  saveBooking, getBooking, listBookingsForDate, listBookingsRange,
  newGiftCode, normalizeGiftCode, getGift, deductGift, ensureGiftCode,
  recordPayment, listPayments,
  sendBookingConfirmation, sendGiftCertificate, sendGiftReceipt,
};
