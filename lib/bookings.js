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
const {
  deductReferral, issueReferralCredit, markClientPaid, getReferralByCode, attendeeOf,
} = require("./referrals");

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

// Append a use entry to a gift record's history (mutation only — the
// caller saves the record). amountCents is positive when value is spent,
// negative when value is restored (e.g. a voucher no-show).
function logGiftUse(gift, entry) {
  gift.uses = gift.uses || [];
  gift.uses.push({
    bookingId: entry.bookingId || null,
    amountCents: entry.amountCents || 0,
    date: entry.date || new Date().toISOString(),
    usedBy: entry.usedBy || "",
    note: entry.note || "",
  });
  return gift;
}

function giftDisplayStatus(g) {
  if (g.status === "void") return "used up — void";
  if (!g.balanceCents || g.balanceCents <= 0) return "used up";
  if (g.balanceCents < g.originalCents) return "partially used";
  return "active";
}

async function listGifts() {
  const codes = (await kvGet("gift:all")) || [];
  const out = [];
  for (const code of codes) {
    const g = await kvGet(`gift:${code}`);
    if (g) out.push(g);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// Deduct a gift balance once (guarded by booking.giftDeducted).
async function deductGift(booking) {
  if (!booking.giftCode || !booking.giftAppliedCents || booking.giftDeducted) return 0;
  const gift = await getGift(booking.giftCode);
  if (!gift) return 0;
  gift.balanceCents = Math.max(0, gift.balanceCents - booking.giftAppliedCents);
  const client = attendeeOf(booking);
  logGiftUse(gift, {
    bookingId: booking.id, amountCents: booking.giftAppliedCents,
    date: new Date().toISOString(), usedBy: [client.name, client.email].filter(Boolean).join(" "),
  });
  // A voucher's leftover credit stays with the PERSON WHO USED it — the
  // redeemer, not the buyer. The holder is whoever last used the code.
  if (gift.kind === "voucher" && client.email) {
    gift.holderName = client.name || gift.holderName;
    gift.holderEmail = client.email;
  }
  await kvSet(`gift:${gift.code}`, gift);
  booking.giftDeducted = true;
  await kvSet(`booking:${booking.id}`, booking);
  return booking.giftAppliedCents;
}

// Everything that happens the moment a booking becomes paid, in one place —
// called from every paid path (the $0 booking path, the Stripe status page,
// the webhook) so none of them can drift apart. All steps are idempotent:
// a second call (webhook + status page) is a no-op.
async function finalizePaidBooking(booking) {
  await deductGift(booking);
  await deductReferral(booking);
  await issueReferralCredit(booking);
  await markClientPaid(booking);
  await kvSet(`booking:${booking.id}`, booking);
  await sendBookingConfirmation(booking);
  return booking;
}

// Sarah marks a booking's outcome in the admin panel. The system cannot
// know on its own whether a client showed up — she taps Completed or
// No-show. Completing a booking voids its voucher if the balance is $0
// (the voucher dies when the treatment is done). A no-show puts a
// voucher's deducted value back on the code, so the friend can rebook —
// nothing is consumed until the treatment is done.
async function markBookingOutcome(booking, outcome) {
  if (!booking) return null;
  const now = new Date().toISOString();
  if (outcome === "completed") {
    booking.status = "completed";
    booking.outcomeAt = now;
    if (booking.giftCode) {
      const gift = await getGift(booking.giftCode);
      if (gift && gift.kind === "voucher" && gift.balanceCents <= 0) {
        gift.status = "void";
        await kvSet(`gift:${gift.code}`, gift);
      }
    }
  } else if (outcome === "no-show") {
    booking.status = "no-show";
    booking.outcomeAt = now;
    if (booking.giftCode && booking.giftDeducted && booking.giftAppliedCents) {
      const gift = await getGift(booking.giftCode);
      if (gift && gift.kind === "voucher") {
        gift.balanceCents = Math.min(gift.originalCents, gift.balanceCents + booking.giftAppliedCents);
        logGiftUse(gift, {
          bookingId: booking.id, amountCents: -booking.giftAppliedCents, date: now,
          note: "no-show — value restored",
        });
        await kvSet(`gift:${gift.code}`, gift);
      }
      booking.giftDeducted = false;
    }
    if (booking.referralCode && (booking.referralDeducted || booking.freeReflexologyDeducted)) {
      const ref = await getReferralByCode(booking.referralCode);
      if (ref) {
        if (booking.referralDeducted && booking.referralAppliedCents) {
          ref.creditCents = (ref.creditCents || 0) + booking.referralAppliedCents;
          ref.creditUsedCents = Math.max(0, (ref.creditUsedCents || 0) - booking.referralAppliedCents);
          booking.referralDeducted = false;
        }
        if (booking.freeReflexologyDeducted) {
          ref.freeReflexology = (ref.freeReflexology || 0) + 1;
          booking.freeReflexologyDeducted = false;
        }
        ref.updatedAt = now;
        await kvSet(`ref:${ref.code}`, ref);
      }
    }
  }
  await kvSet(`booking:${booking.id}`, booking);
  return booking;
}

// Issue a gift code for a paid gift checkout session (idempotent: the
// gift:session key means a second call — webhook + status page — is a no-op).
// A voucher session (metadata kind:"voucher") carries voucherFor (the named
// treatment + add-ons), a voucherLabel, and a 120-day suggested use-by — the
// dollar value itself NEVER expires.
async function ensureGiftCode(session) {
  const meta = session.metadata || {};
  const existing = await kvGet(`gift:session:${session.id}`);
  if (existing) return existing;
  const code = newGiftCode();
  const kind = meta.kind === "voucher" ? "voucher" : "gift";
  let voucherFor = null;
  if (kind === "voucher" && meta.voucherFor) {
    try { voucherFor = JSON.parse(meta.voucherFor); } catch { voucherFor = null; }
  }
  const createdAt = new Date().toISOString();
  const record = {
    code,
    kind,
    balanceCents: Number(meta.amountCents || session.amount_total || 0),
    originalCents: Number(meta.amountCents || session.amount_total || 0),
    buyerName: meta.buyerName || "",
    buyerEmail: meta.buyerEmail || "",
    recipientName: meta.recipientName || "",
    recipientEmail: meta.recipientEmail || "",
    holderName: meta.recipientName || "",
    holderEmail: meta.recipientEmail || "",
    message: meta.message || "",
    voucherFor,
    voucherLabel: meta.voucherLabel || "",
    suggestedUseBy: kind === "voucher"
      ? new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null,
    uses: [],
    status: "active",
    createdAt,
    expiresAt: null, // gift codes NEVER expire
    checkoutSessionId: session.id,
  };
  await kvSet(`gift:${code}`, record);
  await kvSet(`gift:session:${session.id}`, record);
  const all = (await kvGet("gift:all")) || [];
  if (!all.includes(code)) {
    all.push(code);
    await kvSet("gift:all", all);
  }
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
    b.myReferralCode
      ? `<p><strong>Your personal referral code: ${b.myReferralCode}</strong> — share it with a friend: <a href="${SITE_URL}/?ref=${b.myReferralCode}">boltonfacials.com/?ref=${b.myReferralCode}</a>. When three friends book and pay in full with your code, you earn $15 treatment credit and a free reflexology add-on. No cash value — credit is for treatments only.</p>` : "",
    `<p>We look forward to welcoming you.<br/>— In2Skin, Bolton</p>`,
  ];
  return lines.join("\n");
}

// Hold confirmation (voice-agent bookings): the slot is held for 30 minutes
// and the client confirms + pays through the checkout link on their own phone.
async function sendHoldEmail(booking, checkoutUrl) {
  const who = String(booking.name || "").split(" ")[0] || "there";
  const lines = [
    `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin appointment is held</h2>`,
    `<p>Hi ${who},</p>`,
    `<p>We are holding this time for you:</p>`,
    `<ul><li><strong>${booking.serviceName}</strong> — ${booking.minsLabel || ""}</li>`,
    `<li>${fmtDateLong(booking.date)} at ${booking.time}${booking.type === "after" ? " (Private Hours)" : ""}</li>`,
    `<li>In2Skin · Bolton, Ontario</li>`,
    `<li>To pay: <strong>${money(booking.amountCents || 0)}</strong>${booking.firstVisitDiscountCents ? " (includes the $10 first-visit offer)" : ""} — the charge shows as <strong>IN2SKIN</strong> on your card statement.</li></ul>`,
    checkoutUrl
      ? `<p><a href="${checkoutUrl}" style="display:inline-block;background:#2F4A2C;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;">Confirm and pay</a></p><p>This hold lasts <strong>30 minutes</strong> — if you do not confirm and pay within 30 minutes, the time opens back up and you will need to book again.</p>`
      : `<p>No payment is due now — this is a consultation booking, and the studio will confirm it with you.</p>`,
    `<p>Need to move your appointment? Please call at least 24 hours ahead (${PHONE_DISPLAY}) and we will find you a new time — there is no charge to reschedule.</p>`,
    `<p>We look forward to welcoming you.<br/>— In2Skin, Bolton</p>`,
  ];
  return sendEmail({
    to: booking.email,
    subject: `Your In2Skin appointment is held — ${booking.serviceName}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: lines.join("\n"),
  });
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
  const isVoucher = gift.kind === "voucher";
  const label = isVoucher && gift.voucherLabel ? gift.voucherLabel : `${money(gift.originalCents)} gift certificate`;
  return sendEmail({
    to: gift.buyerEmail,
    subject: isVoucher
      ? `Your In2Skin treatment voucher receipt — ${label} for ${gift.recipientName || "your friend"}`
      : `Your In2Skin gift certificate receipt — ${money(gift.originalCents)} for ${gift.recipientName || "your friend"}`,
    html: isVoucher
      ? `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Thank you — your voucher is on its way</h2><p>Hi ${String(gift.buyerName || "").split(" ")[0] || "there"},</p><p>Your treatment voucher — <strong>Good for ${gift.voucherLabel}</strong> — for <strong>${gift.recipientName || "your friend"}</strong> is paid. The voucher code <strong>${gift.code}</strong> has been emailed to them at ${gift.recipientEmail}.</p><p>The charge shows as <strong>IN2SKIN</strong> on your card statement. No cash value. The dollar value never expires.</p><p>— In2Skin, Bolton</p>`
      : `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Thank you — your gift is on its way</h2><p>Hi ${String(gift.buyerName || "").split(" ")[0] || "there"},</p><p>Your <strong>${money(gift.originalCents)}</strong> In2Skin gift certificate for <strong>${gift.recipientName || "your friend"}</strong> is paid. The certificate code <strong>${gift.code}</strong> has been emailed to them at ${gift.recipientEmail}.</p><p>The charge shows as <strong>IN2SKIN</strong> on your card statement. Gift codes never expire.</p><p>— In2Skin, Bolton</p>`,
  });
}

// A treatment voucher certificate: "Good for [treatment]" — the named
// treatment, not an open amount. No cash value; 120 days suggested use-by;
// the dollar value never expires; any balance left stays with the person
// who used the voucher.
function voucherCertificateHtml(gift) {
  const useBy = gift.suggestedUseBy
    ? new Date(gift.suggestedUseBy + "T00:00:00").toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
    : "";
  return [
    `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;border:1px solid #D3C29E;border-radius:8px;padding:28px;background:#FDF8EC;">`,
    `<h2 style="color:#2F4A2C;margin:0 0 6px;">A gift for you — from ${gift.buyerName || "a friend"}</h2>`,
    `<p style="color:#5A5041;">${gift.message ? `“${gift.message}”` : "Enjoy some you-time at In2Skin, Bolton."}</p>`,
    `<p style="text-align:center;font-size:1.2rem;color:#2F4A2C;"><strong>Good for ${gift.voucherLabel || "your treatment"}</strong></p>`,
    `<p style="font-size:28px;letter-spacing:.12em;text-align:center;background:#F3EAD3;border:1px solid #D3C29E;border-radius:8px;padding:18px 10px;margin:20px 0;"><strong>${gift.code}</strong></p>`,
    `<p style="text-align:center;"><strong>${money(gift.originalCents)}</strong> toward your treatment at In2Skin · Bolton, Ontario</p>`,
    `<p style="color:#5A5041;">Book online at <a href="${SITE_URL}/#book">boltonfacials.com</a> or call ${PHONE_DISPLAY} and give the code when you book. We suggest enjoying it within 120 days${useBy ? ` (by ${useBy})` : ""} — but the dollar value never expires, and any balance left after your visit stays with you.</p>`,
    `<p style="color:#5A5041;">No cash value — use it for treatments or not at all.</p>`,
    `<p style="color:#5A5041;">— In2Skin, Bolton</p></div>`,
  ].join("\n");
}

async function sendVoucherCertificate(gift) {
  if (gift.certificateSent) return false;
  const ok = await sendEmail({
    to: gift.recipientEmail,
    subject: `A gift from ${gift.buyerName || "a friend"} — your In2Skin treatment voucher (${gift.voucherLabel || money(gift.originalCents)})`,
    html: voucherCertificateHtml(gift),
  });
  if (ok) {
    gift.certificateSent = true;
    await kvSet(`gift:${gift.code}`, gift);
    await kvSet(`gift:session:${gift.checkoutSessionId}`, gift);
  }
  return ok;
}

module.exports = {
  SITE_URL, PHONE_DISPLAY,
  newId, fmtDateLong,
  saveBooking, getBooking, listBookingsForDate, listBookingsRange,
  newGiftCode, normalizeGiftCode, getGift, deductGift, ensureGiftCode,
  logGiftUse, giftDisplayStatus, listGifts, finalizePaidBooking, markBookingOutcome,
  recordPayment, listPayments,
  sendBookingConfirmation, sendGiftCertificate, sendGiftReceipt, sendHoldEmail,
  sendVoucherCertificate, voucherCertificateHtml,
};
