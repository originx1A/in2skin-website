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
const { kvGet, kvSet, kvDel } = require("./kv");
const { sendEmail } = require("./email");
const {
  money, findService, parseDateLocal, dateKey, timesFor, parseTime,
  slotTaken, QUIET_PREMIUM_CENTS,
  normalizeAddons, durationForBooking, baseCentsFor,
  dayIsFull, finishCheckDue, countsTowardCap,
} = require("./schedule");
const { getMeetLink, studioForDate } = require("./studio");
const { getAccessToken, createMeetEvent, deleteMeetEvent } = require("./google");
const {
  deductReferral, issueReferralCredit, markClientPaid, getReferralByCode,
  normalizeReferralCode, getOrCreateReferral, getReferralByEmailOrPhone,
  noteReferral, attendeeOf,
} = require("./referrals");
const { torontoNow, torontoDateKey } = require("./transfer");
const { adminEmails } = require("./auth");
const { notifyPush } = require("./push");

const SITE_URL = (process.env.SITE_URL || "https://boltonfacials.com").replace(/\/$/, "");
const PHONE_DISPLAY = "(289) 212-4124"; // live Ringbreeze number — forwards to the studio's phone (forwarding set up in Retell)

// Consultation (Tony Nov 19, 2026): 20 minutes with the studio, $30 flat,
// paid up front, credited in full toward any treatment once the
// consultation is done. TWO formats, one service: a video call on Google
// Meet, or a walk-in face consultation at the studio. The $30 is earned
// the moment the consultation happens; the credit is issued when the studio
// marks it Completed, and once the credit is used on a treatment it stays
// used — cancelling that treatment refunds only the cash paid for it,
// never the $30.
const CONSULT_ID = "consultation";
const CONSULT_CREDIT_CENTS = 3000;
const CONSULT_FORMATS = ["video", "in-person"];
// The format of a consultation booking: "video" (Google Meet) or
// "in-person" (at the studio). Anything else — including a missing format
// on an old record — reads as video, the original format.
function consultFormatOf(input) {
  return input && input.format === "in-person" ? "in-person" : "video";
}
function consultName(format) {
  return format === "in-person" ? "In-Person Consultation" : "Video Consultation";
}
// Visible credit line (Tony Nov 19, 2026): when a treatment booking used
// a consultation credit, the booking SHOWS it — the confirmation email,
// the hold email, the walk-in confirmation and the dashboard all carry
// this line, so the client and the studio both see the $30 applied.
function consultCreditLine(booking) {
  if (!booking || booking.giftKind !== "consult-credit" || !(booking.giftAppliedCents > 0)) return "";
  return `<p><strong>${money(booking.giftAppliedCents)} consultation credit applied</strong> — your consultation with the studio covered ${money(booking.giftAppliedCents)} of this treatment.</p>`;
}
// The "(includes …)" suffix on a Paid / To-pay line: a consultation
// credit reads as a consultation credit, not a gift certificate.
function appliedCreditText(booking) {
  if (!booking || !(booking.giftAppliedCents > 0)) return "";
  return booking.giftKind === "consult-credit"
    ? ` (includes ${money(booking.giftAppliedCents)} consultation credit)`
    : ` (includes ${money(booking.giftAppliedCents)} from gift certificate ${booking.giftCode})`;
}

/* ---------------- fresh Meet link per video consultation ---------------- */
// Fresh Meet link (Tony Nov 20, 2026): every video consultation gets its
// OWN link, minted on the connected Google account through the Calendar
// API — never a shared link, never pasted. The link + the calendar event
// id live on the booking record, so the confirmation email, the reminder,
// the move email and the dashboard all use the same link.
const MEET_LINK_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

// The video link for a consultation booking: this booking's own minted
// link first, the old pasted standing link only as a fallback for
// bookings made before auto-minting. Anything that isn't a video
// consultation never gets a link.
async function meetLinkFor(booking) {
  if (!booking || booking.service !== CONSULT_ID || consultFormatOf(booking) !== "video") return "";
  if (booking.meetLink) return booking.meetLink;
  return getMeetLink();
}

// Wall-clock start/end for a booking, as "YYYY-MM-DDTHH:MM:00" —
// createMeetEvent reads them in America/Toronto, so no UTC offset math
// is needed here (and none would survive a daylight-saving change).
function consultMeetWindow(booking) {
  const startMin = parseTime(booking.time);
  if (startMin == null) return null;
  const mins = durationForBooking(booking.service, booking.addons || []);
  const endMin = startMin + mins;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { startISO: `${booking.date}T${hhmm(startMin)}:00`, endISO: `${booking.date}T${hhmm(endMin)}:00` };
}

// One Calendar event for this video consultation, at the booking's
// current day + time. Returns the { meetLink, eventId } Google gave
// back, or null when Google answered without a usable link.
async function createConsultEvent(booking, accessToken) {
  const window = consultMeetWindow(booking);
  if (!window) return null;
  const who = attendeeOf(booking);
  const created = await createMeetEvent({
    accessToken,
    summary: `Video consultation — ${who.name || "In2Skin"}`,
    description: `In2Skin video consultation with ${who.name || ""} — ${fmtDateLong(booking.date)} at ${booking.time}.`,
    startISO: window.startISO,
    endISO: window.endISO,
    attendeeEmail: who.email || booking.email || "",
  });
  if (!created.meetLink || !MEET_LINK_RE.test(created.meetLink) || !created.eventId) return null;
  return created;
}

// Mint the booking's own Meet link (idempotent: a booking that already
// has one keeps it). A mint failure NEVER throws and never blocks the
// booking — the confirmation still goes out saying the link is coming,
// and the booking is flagged so the studio notification can say so.
async function mintConsultMeetLink(booking) {
  if (!booking || booking.service !== CONSULT_ID || consultFormatOf(booking) !== "video") return null;
  if (booking.meetLink && booking.meetEventId) return booking.meetLink;
  try {
    const accessToken = await getAccessToken();
    const created = await createConsultEvent(booking, accessToken);
    if (!created) {
      console.error("[bookings:meet-link] Google answered without a usable link or event id");
      booking.meetLinkFailed = true;
      await kvSet(`booking:${booking.id}`, booking);
      return null;
    }
    booking.meetLink = created.meetLink;
    booking.meetEventId = created.eventId;
    booking.meetLinkFailed = false;
    await kvSet(`booking:${booking.id}`, booking);
    return booking.meetLink;
  } catch (e) {
    console.error("[bookings:meet-link]", e);
    booking.meetLinkFailed = true;
    try { await kvSet(`booking:${booking.id}`, booking); } catch { /* the flag is advisory; the booking itself must not fail */ }
    return null;
  }
}

// Delete the booking's minted Meet event, best-effort: a failure is
// logged only and never blocks a cancel, delete, or move. The link
// fields stay on the record as an audit trail.
async function deleteConsultMeetEvent(booking) {
  if (!booking || !booking.meetEventId) return false;
  try {
    const accessToken = await getAccessToken();
    await deleteMeetEvent({ accessToken, eventId: booking.meetEventId });
    return true;
  } catch (e) {
    console.error("[bookings:meet-link] delete failed", e);
    return false;
  }
}

// A moved video consultation keeps its calendar event in step: mint the
// new event FIRST, then delete the old one — so a mint failure leaves
// the client with their working (old) link instead of none. Only runs
// when the booking already has an event; a consultation that never got
// a link mints one when it is paid, not when it is moved.
async function remintConsultMeetLink(booking) {
  if (!booking || booking.service !== CONSULT_ID || consultFormatOf(booking) !== "video") return null;
  if (!booking.meetEventId) return null;
  try {
    const accessToken = await getAccessToken();
    const created = await createConsultEvent(booking, accessToken);
    if (!created) {
      console.error("[bookings:meet-link] remint answered without a usable link — keeping the old event");
      return booking.meetLink || null;
    }
    const oldEventId = booking.meetEventId;
    booking.meetLink = created.meetLink;
    booking.meetEventId = created.eventId;
    booking.meetLinkFailed = false;
    await kvSet(`booking:${booking.id}`, booking);
    try {
      await deleteMeetEvent({ accessToken, eventId: oldEventId });
    } catch (e) {
      console.error("[bookings:meet-link] old event delete failed after remint", e);
    }
    return booking.meetLink;
  } catch (e) {
    console.error("[bookings:meet-link] remint failed — keeping the old event", e);
    return booking.meetLink || null;
  }
}

function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(10).toString("hex");
}

function fmtDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// Hours from now (Toronto wall clock) until a booking starts — for the
// consultation refund rule (24+ hours ahead: the $30 is refundable).
function hoursUntilBooking(booking) {
  if (!booking || !parseDateLocal(booking.date)) return null;
  const { mins } = torontoNow();
  const today = torontoDateKey();
  const startMin = parseTime(booking.time);
  if (startMin == null) return null;
  const d0 = new Date(today + "T00:00:00");
  const d1 = new Date(booking.date + "T00:00:00");
  const dayDiff = Math.round((d1.getTime() - d0.getTime()) / 86400000);
  return (dayDiff * 1440 + (startMin - mins)) / 60;
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

// Remove a booking from one day's index (used when a booking moves days).
async function removeBookingFromDate(bookingId, dateStr) {
  const key = `bookings:date:${dateStr}`;
  const ids = (await kvGet(key)) || [];
  const next = ids.filter((id) => id !== bookingId);
  if (next.length !== ids.length) await kvSet(key, next);
}

// Delete a booking for good (admin only — the studio removing a test or
// unneeded booking). Removes the record and its day index. Does NOT touch
// gift/voucher codes, referral credits, or payment records attached to it —
// a cancelled booking already restored those at cancel time, and a paid
// booking's payment stays in Reports via the payments list.
async function deleteBooking(id) {
  const booking = await getBooking(id);
  if (!booking) return null;
  // A deleted record must not leave a live Meet event behind.
  await deleteConsultMeetEvent(booking);
  await kvDel(`booking:${id}`);
  await removeBookingFromDate(id, booking.date);
  return booking;
}

// What the client still owes on a booking (never negative).
function balanceDue(booking) {
  return Math.max(0, (booking.amountCents || 0) - (booking.amountPaidCents || 0));
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

/* ---------------- finish check (Tony Nov 19, 2026) ---------------- */
// About an hour into an appointment the dashboard asks the studio "are you done
// yet?" — a Yes tap starts the reset clock from the real finish time, so the
// next slot opens at the right time instead of a guessed one. The
// dashboard's 30-second poll drives it: it lists the due checks, fires
// the pop-up once per check, and the studio answers Done / Not yet.
async function dueFinishChecks() {
  const today = torontoDateKey();
  const { mins } = torontoNow();
  const nowMs = Date.now();
  const bookings = await listBookingsForDate(today);
  return bookings
    .filter((b) => finishCheckDue(b, today, mins, nowMs))
    .map((b) => ({
      bookingId: b.id,
      name: b.forWhom === "friend" && b.guestName ? b.guestName : b.name,
      serviceLabel: b.serviceLabel || b.serviceName || "In2Skin visit",
      time: b.time,
      notified: Boolean(b.finishNotifiedAt),
    }));
}

// Fire the pop-up once for a due check. The flag is set before the push
// so a second dashboard polling in the same moment does not double-send.
async function notifyFinishCheck(bookingId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.finishNotifiedAt) return null;
  booking.finishNotifiedAt = new Date().toISOString();
  await kvSet(`booking:${booking.id}`, booking);
  const who = booking.forWhom === "friend" && booking.guestName ? booking.guestName : booking.name;
  await notifyPush({
    type: "finish-check",
    title: "Finished with your appointment?",
    body: `${booking.serviceLabel || booking.serviceName || "In2Skin visit"} — ${who || ""}, ${booking.time || ""}. Tap Done when the room is free.`,
  });
  return booking;
}

// the studio tapped "Done" — the room is free from right now (Toronto time),
// so the next booking can start an hour from this minute.
async function markFinishDone(bookingId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.finishedAt) return null;
  const { mins } = torontoNow();
  booking.finishedAt = new Date().toISOString();
  booking.actualEndMin = mins;
  await kvSet(`booking:${booking.id}`, booking);
  return booking;
}

// the studio tapped "Not yet" — ask again in 15 minutes.
async function snoozeFinishCheck(bookingId, mins = 15) {
  const booking = await getBooking(bookingId);
  if (!booking) return null;
  booking.finishSnoozedUntil = new Date(Date.now() + mins * 60 * 1000).toISOString();
  await kvSet(`booking:${booking.id}`, booking);
  return booking;
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

// Delete a gift certificate / voucher for good — removes the record, its
// place in the gift:all index, and the checkout-session link. Used by the
// admin panel (a test code, or a code issued by mistake). The value is gone;
// a deleted code can never be redeemed.
async function deleteGift(rawCode) {
  const gift = await getGift(rawCode);
  if (!gift) return false;
  await kvDel(`gift:${gift.code}`);
  const all = (await kvGet("gift:all")) || [];
  await kvSet("gift:all", all.filter((c) => c !== gift.code));
  if (gift.checkoutSessionId) await kvDel(`gift:session:${gift.checkoutSessionId}`);
  return true;
}

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
  // Fresh Meet link (Tony Nov 20, 2026): a paid video consultation
  // mints its own link the moment payment lands — before the
  // confirmation email goes out, so the email carries the real link.
  // A mint failure never blocks the booking (see mintConsultMeetLink).
  await mintConsultMeetLink(booking);
  await sendBookingConfirmation(booking);
  // Studio notification (Tony Nov 19, 2026): the studio + Tony get an email the
  // moment a booking is paid. Guarded by a once-flag so the webhook + status
  // page double-call can never send it twice; $0 consultations are excluded.
  if (!booking.studioPaidNotified && booking.status === "paid" && (booking.amountPaidCents || 0) > 0) {
    booking.studioPaidNotified = true;
    await kvSet(`booking:${booking.id}`, booking);
    await notifyStudioBooking(booking, "paid");
  }
  return booking;
}

// Studio notifications (Tony Nov 19, 2026): the studio + Tony get an email the
// moment a booking is made and the moment one is paid. Caller messages
// already email the studio on arrival (api/transfer-status); bookings
// never did. An email failure never throws — a missed email is logged only.
async function notifyStudioBooking(booking, kind) {
  try {
    const to = adminEmails();
    if (!to.length) return false;
    const when = fmtDateLong(booking.date) + " at " + (booking.time || "");
    const who = booking.forWhom === "friend" && booking.guestName ? booking.guestName : booking.name;
    const service = booking.serviceLabel || booking.serviceName || "In2Skin visit";
    const amount = money(booking.amountCents || 0);
    const statusLine = booking.status === "paid" ? "Paid in full"
      : booking.status === "consultation" ? "Consultation — no payment due"
      : "Awaiting payment (30-minute hold)";
    const subject = kind === "paid"
      ? `Booking paid — ${who}, ${amount} — ${service}`
      : `New booking — ${who}, ${service}, ${when}`;
    const html = `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">${kind === "paid" ? "Booking paid" : "New booking"}</h2>`
      + `<ul><li><strong>${who}</strong> — ${service}</li>`
      + `<li>When: ${when}${booking.type === "after" ? " (Private Hours)" : ""}</li>`
      + `<li>Amount: ${amount} · ${statusLine}</li>`
      + `<li>Phone: ${booking.guestPhone || booking.phone || "—"}</li>`
      + `<li>Email: ${booking.guestEmail || booking.email || "—"}</li>`
      + `<li>Booked via: ${booking.via === "agent" ? "phone agent" : booking.via === "admin" ? "walk-in (dashboard)" : "website"}</li></ul>`
      + (booking.meetLinkFailed ? `<p><strong>The video link could not be made automatically</strong> — please send the client a Meet link before the call.</p>` : "")
      + `<p>See it on the studio dashboard: <a href="${SITE_URL}/admin/dashboard.html">${SITE_URL}/admin/dashboard.html</a></p><p>— In2Skin, Bolton</p>`;
    const emailed = await sendEmail({ to, subject, html });
    // Same moment, same places as the email: a pop-up on the studio
    // phone + a dashboard event (chime + banner while it is open).
    // Never throws, never delays the email's answer.
    await notifyPush({
      type: kind === "paid" ? "paid" : "booking",
      title: kind === "paid" ? "Booking paid" : "New booking",
      body: kind === "paid" ? `${amount} — ${service}, ${who}` : `${service} — ${who}, ${when}`,
    });
    return emailed;
  } catch (e) {
    console.error("[bookings:studio-notify]", e);
    return false;
  }
}

// Put back everything a booking consumed, because the treatment never
// happened — nothing is consumed until the treatment is done.
//   includePlainGift: a no-show FORFEITS a plain gift certificate's used
//     value (locked rule: a no-show restores voucher value only), so the
//     no-show path passes false. A cancellation restores both — the client
//     freed the slot in advance, so their gift value goes back on the code.
async function restoreBookingValue(booking, { includePlainGift, note }) {
  const now = new Date().toISOString();
  if (booking.giftCode && booking.giftDeducted && booking.giftAppliedCents) {
    const gift = await getGift(booking.giftCode);
    // A consultation credit is CONSUMED the moment it is used on a
    // treatment (Tony Nov 19, 2026): cancelling or no-showing that
    // treatment refunds only the cash paid for it — the $30 stays earned,
    // so the credit is never put back, on either path.
    if (gift && gift.kind !== "consult-credit" && (gift.kind === "voucher" || includePlainGift)) {
      gift.balanceCents = Math.min(gift.originalCents, gift.balanceCents + booking.giftAppliedCents);
      logGiftUse(gift, {
        bookingId: booking.id, amountCents: -booking.giftAppliedCents, date: now,
        note: note || "value restored",
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

// the studio cancels a booking from the admin panel. Only an upcoming booking
// (pending / unpaid / paid / consultation) can be cancelled. The slot frees
// immediately (slotTaken ignores cancelled bookings) and everything the
// booking consumed goes back — gift/voucher value and referral credit —
// because the treatment never happened. The client gets a polite email.
async function cancelBooking(booking, reason) {
  if (!booking) return null;
  const now = new Date().toISOString();
  booking.status = "cancelled";
  booking.cancelledAt = now;
  if (reason) booking.cancelReason = String(reason).trim().slice(0, 200);
  // Clawback facts for the email (Tony Nov 19, 2026): a treatment that
  // used a consultation credit refunds only the cash paid for it — the
  // credit stays used. A consultation cancelled 24+ hours ahead has its
  // $30 refundable; inside 24 hours it is the studio's call.
  let consultCreditCents = 0;
  if (booking.giftCode && booking.giftDeducted && booking.giftAppliedCents) {
    const gift = await getGift(booking.giftCode);
    if (gift && gift.kind === "consult-credit") consultCreditCents = booking.giftAppliedCents;
  }
  const hoursUntil = booking.service === CONSULT_ID ? hoursUntilBooking(booking) : null;
  await restoreBookingValue(booking, { includePlainGift: true, note: "cancelled — value restored" });
  await kvSet(`booking:${booking.id}`, booking);
  // The video call dies with the booking — take its Meet event off
  // the studio's calendar too. Best-effort: a failure never blocks the
  // cancellation or the email.
  await deleteConsultMeetEvent(booking);
  const emailed = await sendCancellationEmail(booking, { consultCreditCents, hoursUntil });
  return { booking, emailed };
}

async function sendCancellationEmail(booking, opts) {
  const who = attendeeOf(booking);
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const first = String(who.name || "").split(" ")[0] || "there";
  const o = opts || {};
  let refundLine = "";
  if (booking.service === CONSULT_ID) {
    // The $30 is refundable when the consultation is cancelled 24+ hours
    // ahead (or free to reschedule); inside 24 hours the studio decides.
    refundLine = o.hoursUntil != null && o.hoursUntil >= 24
      ? `<p>Your $30 consultation fee will be refunded to your card — the studio will send that through.</p>`
      : `<p>Because this is less than 24 hours before your consultation, please call the studio at ${PHONE_DISPLAY} about the $30 — we will sort it with you.</p>`;
  } else if (o.consultCreditCents > 0) {
    // The consultation credit stays used: the refund is only the cash
    // actually paid for this treatment.
    refundLine = `<p>The refund for this treatment is the <strong>${money(booking.amountPaidCents || 0)}</strong> you paid — your $30 consultation credit was used for this booking and stays used, because your consultation already happened.</p>`;
  }
  return sendEmail({
    to,
    subject: `Your In2Skin appointment on ${fmtDateLong(booking.date)} has been cancelled`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your appointment has been cancelled</h2>`,
      `<p>Hi ${first},</p>`,
      `<p>We're sorry — your <strong>${booking.serviceName}</strong> appointment on <strong>${fmtDateLong(booking.date)} at ${booking.time}</strong> has been cancelled${booking.cancelReason ? ` (${booking.cancelReason})` : ""}.</p>`,
      refundLine,
      o.consultCreditCents > 0
        ? `<p>Any other gift or referral value used for this booking has been put back, so you can book again with it.</p>`
        : `<p>Any gift certificate or voucher value used for this booking has been put back on the code, so you can book again with it.</p>`,
      `<p>We'd love to find you another time — book online at <a href="${SITE_URL}/#book">boltonfacials.com</a> or call ${PHONE_DISPLAY}.</p>`,
      `<p>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
}

// the studio marks a booking's outcome in the admin panel. The system cannot
// know on its own whether a client showed up — the studio taps Completed or
// No-show. Completing a booking voids its voucher if the balance is $0
// (the voucher dies when the treatment is done). A no-show puts a
// voucher's deducted value back on the code, so the friend can rebook —
// nothing is consumed until the treatment is done.
async function markBookingOutcome(booking, outcome) {
  if (!booking) return null;
  const now = new Date().toISOString();
  // The dashboard sends "complete"; the lib's own callers (and the
  // voucher tests) say "completed". Both mean the same thing — a
  // booking the studio marked done. (Before this fix the dashboard's
  // "complete" matched neither branch, so nothing happened at all:
  // no status change, no voucher void, no consultation credit.)
  const done = outcome === "completed" || outcome === "complete";
  if (done) {
    booking.status = "completed";
    booking.outcomeAt = now;
    if (booking.giftCode) {
      const gift = await getGift(booking.giftCode);
      if (gift && gift.kind === "voucher" && gift.balanceCents <= 0) {
        gift.status = "void";
        await kvSet(`gift:${gift.code}`, gift);
      }
    }
    // A completed consultation earns its $30 credit (Tony Nov 19,
    // 2026): issued here, when the studio marks it done — never before, so a
    // consultation that is cancelled or no-showed can never leave a
    // credit behind to claw back. A no-show issues nothing.
    await issueConsultCredit(booking);
  } else if (outcome === "no-show") {
    booking.status = "no-show";
    booking.outcomeAt = now;
    await restoreBookingValue(booking, { includePlainGift: false, note: "no-show — value restored" });
  }
  await kvSet(`booking:${booking.id}`, booking);
  return booking;
}

/* ---------------- consultation credit (Tony Nov 19, 2026) ---------------- */
// The $30 consultation fee is earned once the consultation happens, and
// the $30 credit is issued when the studio marks the consultation Completed —
// never before, so a consultation that is cancelled or no-showed can
// never leave a credit behind to claw back. The credit is a gift-code
// record (kind "consult-credit", $30, never expires) so it rides the
// existing redemption path: the client enters the code when booking a
// treatment and the balance comes off. Once used it stays used —
// restoreBookingValue never puts a consult-credit back (see above).
// Idempotent: a booking that already has a credit code issues nothing.
async function issueConsultCredit(booking) {
  if (!booking || booking.service !== CONSULT_ID) return null;
  if (booking.consultCreditCode) return null;
  const paidCents = booking.amountPaidCents || 0;
  if (paidCents <= 0) return null; // paid with a gift code — no new credit
  const who = attendeeOf(booking);
  // Once per client (Tony Nov 19, 2026): no second credit, ever — even
  // if the studio books a second consultation herself as a walk-in. The
  // booking block stops online/agent repeats; this stops the credit
  // when the consultation itself was the studio's call.
  const em = String(who.email || "").trim().toLowerCase();
  const ph = String(who.phone || "").replace(/[^0-9]/g, "");
  const priorCredit = (await listGifts()).find((g) => g.kind === "consult-credit"
    && ((em && String(g.holderEmail || "").trim().toLowerCase() === em)
      || (ph && String(g.holderPhone || "").replace(/[^0-9]/g, "") === ph)));
  if (priorCredit) return null;
  const creditCents = Math.min(paidCents, CONSULT_CREDIT_CENTS);
  const code = newGiftCode();
  const createdAt = new Date().toISOString();
  const record = {
    code,
    kind: "consult-credit",
    balanceCents: creditCents,
    originalCents: creditCents,
    buyerName: who.name || booking.name || "",
    buyerEmail: who.email || booking.email || "",
    recipientName: who.name || booking.name || "",
    recipientEmail: who.email || booking.email || "",
    holderName: who.name || booking.name || "",
    holderEmail: who.email || booking.email || "",
    message: "Consultation credit — toward any treatment.",
    voucherFor: null,
    voucherLabel: "",
    suggestedUseBy: null,
    uses: [],
    status: "active",
    createdAt,
    expiresAt: null, // the dollar value never expires
    checkoutSessionId: null,
  };
  await kvSet(`gift:${code}`, record);
  const all = (await kvGet("gift:all")) || [];
  if (!all.includes(code)) {
    all.push(code);
    await kvSet("gift:all", all);
  }
  booking.consultCreditCode = code;
  booking.consultCreditCents = creditCents;
  await kvSet(`booking:${booking.id}`, booking);
  if (who.email) {
    await sendEmail({
      to: who.email,
      subject: `Your $30 In2Skin consultation credit — ${code}`,
      html: [
        `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your consultation credit is here</h2>`,
        `<p>Hi ${String(who.name || "").split(" ")[0] || "there"},</p>`,
        `<p>Your ${consultName(consultFormatOf(booking))} is done — thank you. Your $30 is now a <strong>$30 credit toward any treatment</strong>:</p>`,
        `<p style="font-size:28px;letter-spacing:.12em;text-align:center;background:#F3EAD3;border:1px solid #D3C29E;border-radius:8px;padding:18px 10px;margin:20px 0;"><strong>${code}</strong></p>`,
        `<p>Book online at <a href="${SITE_URL}/#book">boltonfacials.com</a> or call ${PHONE_DISPLAY} and give the code when you book — the $30 comes off your treatment. The dollar value never expires, and any balance left after a visit stays on the code.</p>`,
        `<p>— In2Skin, Bolton</p>`,
      ].join("\n"),
    });
  }
  return record;
}
// excluding the booking itself, and the date index moves with it.
// Switching between Regular and Private Hours changes the total by $15 —
// the difference becomes a balance due (or an overpayment) on the booking.
// A pending booking still has a card link out for its old amount, so its
// type cannot change until that link is cancelled or paid.
async function moveBooking(booking, { date, time, type, bufferMins, blocks }) {
  if (!booking) return null;
  const svc = findService(booking.service);
  if (!svc) { const e = new Error("That treatment is no longer offered."); e.status = 400; throw e; }
  const bad = (msg, status) => { const e = new Error(msg); e.status = status || 400; return e; };
  const newType = type === "after" ? "after" : "regular";
  if (!parseDateLocal(date)) throw bad("Please choose a valid day.");
  const todayStr = torontoDateKey();
  const maxDay = new Date(todayStr + "T00:00:00");
  maxDay.setDate(maxDay.getDate() + 60);
  if (date < todayStr) throw bad("That day has already passed — please choose a later day.");
  if (date > dateKey(maxDay)) throw bad("Bookings open up to 60 days ahead — please choose an earlier day.");
  if (!timesFor(date, newType, booking.service).includes(time)) throw bad("That time is not available for this kind of appointment.");
  if (date === todayStr) {
    const { mins } = torontoNow();
    if (parseTime(time) <= mins) throw bad("That time has already passed today — please choose a later time.");
  }
  const dayBookings = (await listBookingsForDate(date)).filter((x) => x.id !== booking.id);
  if (slotTaken(dayBookings, parseTime(time), durationForBooking(booking.service, booking.addons), { bufferMins, blocks })) {
    throw bad("That time was just taken — please choose another time.", 409);
  }
  // Consultations share the 4-a-day cap with treatments (A4).
  if (countsTowardCap(booking.service) && dayIsFull(dayBookings)) {
    throw bad("That day is fully booked — the studio takes four appointments a day. Please choose another day.", 409);
  }
  const baseCents = baseCentsFor(booking.service, booking.addons, newType);
  const newAmountCents = Math.max(0, baseCents
    - (booking.firstVisitDiscountCents || 0)
    - (booking.giftAppliedCents || 0)
    - (booking.referralAppliedCents || 0));
  if (booking.status === "pending" && newAmountCents !== booking.amountCents) {
    throw bad(`This booking still has a card payment link out for ${money(booking.amountCents)} — move it without changing Regular / Private Hours, or cancel it and book again.`);
  }
  const oldDate = booking.date;
  const oldTime = booking.time;
  booking.date = date;
  booking.time = time;
  booking.type = newType;
  booking.amountCents = newAmountCents;
  booking.movedAt = new Date().toISOString();
  if (oldDate !== date) await removeBookingFromDate(booking.id, oldDate);
  await saveBooking(booking);
  // A moved video consultation re-mints its Meet event for the new
  // time, so the link in the move email matches the calendar. A
  // consultation that never had a link keeps waiting for payment.
  await remintConsultMeetLink(booking);
  const emailed = await sendMoveEmail(booking, oldDate, oldTime);
  return { booking, emailed };
}

async function sendMoveEmail(booking, oldDate, oldTime) {
  const who = attendeeOf(booking);
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const first = String(who.name || "").split(" ")[0] || "there";
  const due = balanceDue(booking);
  const over = Math.max(0, (booking.amountPaidCents || 0) - (booking.amountCents || 0));
  // A moved video consultation carries its (new) link; one that never
  // got a link yet still says it is coming.
  const format = consultFormatOf(booking);
  const meetLink = await meetLinkFor(booking);
  const videoBlock = booking.service !== CONSULT_ID || format !== "video" ? "" : meetLink
    ? `<p><strong>Your video call:</strong> tap this link at your new appointment time — <a href="${meetLink}">${meetLink}</a>. No app needed — it opens in your browser.</p>`
    : `<p><strong>Your video link is coming</strong> — the studio will email it to you before your consultation.</p>`;
  return sendEmail({
    to,
    subject: `Your In2Skin appointment moved — ${booking.serviceName}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your appointment has moved</h2>`,
      `<p>Hi ${first},</p>`,
      `<p>Your <strong>${booking.serviceName}</strong> appointment has moved:</p>`,
      `<ul><li>Was: ${fmtDateLong(oldDate)} at ${oldTime}</li>`,
      `<li>Now: <strong>${fmtDateLong(booking.date)} at ${booking.time}</strong>${booking.type === "after" ? " (Private Hours)" : ""}</li>`,
      `<li>In2Skin · Bolton, Ontario</li>`,
      `<li>New total: <strong>${money(booking.amountCents)}</strong>${due > 0 ? ` — <strong>${money(due)} is due</strong>, payable at your visit` : ""}${over > 0 ? ` — you have already paid ${money(over)} more than the new total, and that will be settled at your visit` : ""}</li></ul>`,
      videoBlock,
      `<p>Need to move it again? Please call at least 24 hours ahead (${PHONE_DISPLAY}) — there is no charge to reschedule.</p>`,
      `<p>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
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

/* ---------------- consultation requests ---------------- */
// After-hours consultations are request-only (Tony Nov 19, 2026):
// the client asks for an evening or early morning, the studio accepts or
// declines in the dashboard, and the client hears back either way.
// After-hours price is $30 flat — no $15 Private Hours premium.
const CONSULT_REQ_KEY = "consult-reqs:all";

function newConsultRequestId() {
  return "crq_" + crypto.randomBytes(10).toString("hex");
}

async function createConsultRequest(input) {
  const b = input || {};
  const bad = (msg, status) => { const e = new Error(msg); e.status = status || 400; return e; };
  if (!parseDateLocal(b.date)) throw bad("Please choose a day.");
  const todayStr = torontoDateKey();
  const minStr = addDaysKey(todayStr, 1);
  const maxStr = addDaysKey(todayStr, 60);
  if (b.date < minStr) throw bad("Requests start from tomorrow — please choose a later day.");
  if (b.date > maxStr) throw bad("Requests open up to 60 days ahead — please choose an earlier day.");
  if (!timesFor(b.date, "after", CONSULT_ID).includes(b.time)) throw bad("That time is not available in the evenings or early mornings — pick one of the times shown, or a regular-hours time instead.");
  if (!b.name || !String(b.name).trim()) throw bad("Please add your name so we know who is coming.");
  if (!b.phone || String(b.phone).replace(/[^0-9]/g, "").length < 10) throw bad("Please add a phone number so we can reach you about your appointment.");
  if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) throw bad("Please add a valid email — the studio's answer and your confirmation go there.");
  // The format rides on the request (Tony Nov 19, 2026): video call or
  // in person at the studio. An invalid format is refused, not guessed.
  if (b.format != null && b.format !== "" && !CONSULT_FORMATS.includes(b.format)) throw bad("Pick video or in person for your consultation.");
  const format = consultFormatOf(b);
  // First-time clients only (Tony Nov 19, 2026): one consultation per
  // client, ever — same rule as a direct booking, enforced here so a
  // returning client never even reaches the studio's dashboard as a request.
  const prior = await getReferralByEmailOrPhone(b.email, b.phone);
  if (prior) throw bad("You've already had your consultation with the studio — book your treatment directly.");
  const req = {
    id: newConsultRequestId(),
    service: CONSULT_ID,
    serviceName: consultName(format),
    format,
    date: b.date,
    time: b.time,
    type: "after",
    name: String(b.name).trim(),
    phone: String(b.phone).trim(),
    email: String(b.email).trim(),
    status: "requested",
    bookingId: null,
    createdAt: new Date().toISOString(),
  };
  await kvSet(`consult-req:${req.id}`, req);
  const all = (await kvGet(CONSULT_REQ_KEY)) || [];
  all.unshift(req.id);
  await kvSet(CONSULT_REQ_KEY, all);
  // Studio notification: email + pop-up, same as any booking.
  try {
    await sendEmail({
      to: adminEmails(),
      subject: `${consultName(format)} request — ${req.name}, ${fmtDateLong(req.date)} at ${req.time}`,
      html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">${consultName(format)} request</h2><p><strong>${req.name}</strong> asked for a ${format === "in-person" ? "in-person consultation at the studio" : "video consultation"} (evening / early morning):</p><ul><li>${fmtDateLong(req.date)} at ${req.time}</li><li>Phone: ${req.phone}</li><li>Email: ${req.email}</li></ul><p>Say yes or no on the studio dashboard: <a href="${SITE_URL}/admin/dashboard.html">${SITE_URL}/admin/dashboard.html</a></p><p>— In2Skin, Bolton</p>`,
    });
    await notifyPush({ type: "consult-request", title: `${consultName(format)} request`, body: `${req.name} — ${fmtDateLong(req.date)} at ${req.time}. Say yes or no on the dashboard.` });
  } catch (e) { console.error("[consult-request:notify]", e); }
  return req;
}

async function listConsultRequests() {
  const ids = (await kvGet(CONSULT_REQ_KEY)) || [];
  const out = [];
  for (const id of ids) {
    const r = await kvGet(`consult-req:${id}`);
    if (r) out.push(r);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

async function getConsultRequest(id) {
  if (!id) return null;
  return kvGet(`consult-req:${id}`);
}

// the studio said yes: book it as an unpaid after-hours consultation (the slot
// holds until the studio cancels it — an unpaid booking never expires on its
// own) and email the client a $30 card pay link. The client pays to lock
// it in; the pay link settles into the booking and flips it to paid, and
// the video link arrives with the confirmation email. The $30 is flat —
// no Private Hours premium on a consultation. The request is marked
// accepted BEFORE the pay link is made, so a Stripe failure leaves a
// real booking the studio can send a link for from the dashboard — never a
// half-answered request.
async function acceptConsultRequest(id, { date, time, bufferMins, blocks }) {
  const req = await getConsultRequest(id);
  if (!req) { const e = new Error("That request is gone."); e.status = 404; throw e; }
  if (req.status !== "requested") { const e = new Error("That request was already answered."); e.status = 400; throw e; }
  const useDate = date || req.date;
  const useTime = time || req.time;
  if (bufferMins == null || blocks == null) {
    ({ bufferMins, blocks } = await studioForDate(useDate));
  }
  const booking = await buildBooking({
    service: CONSULT_ID,
    format: req.format || "video",
    date: useDate, time: useTime, type: "after",
    name: req.name, phone: req.phone, email: req.email,
  }, { bufferMins, blocks, allowToday: true, via: "admin" });
  booking.status = "unpaid";
  booking.amountPaidCents = 0;
  await saveBooking(booking);
  req.status = "accepted";
  req.bookingId = booking.id;
  req.decidedAt = new Date().toISOString();
  await kvSet(`consult-req:${req.id}`, req);
  const pay = await createPayLink({
    amountCents: booking.amountCents,
    clientName: req.name, contact: req.email, method: "email",
    serviceLabel: consultName(req.format), bookingId: booking.id,
  });
  booking.paylinkId = pay.id;
  await saveBooking(booking);
  await sendEmail({
    to: req.email,
    subject: `The studio said yes — your ${consultName(req.format).toLowerCase()}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">The studio said yes</h2>`,
      `<p>Hi ${String(req.name || "").split(" ")[0] || "there"},</p>`,
      `<p>Your <strong>${consultName(req.format)}</strong> is on: <strong>${fmtDateLong(booking.date)} at ${booking.time}</strong>.</p>`,
      `<p>Pay the <strong>$30</strong> here to lock it in: <a href="${pay.url}">${pay.url}</a>. ${req.format === "in-person" ? "See you at the studio — In2Skin, Bolton." : "Your video link arrives by email once you've paid — no app needed, it opens in your browser."}</p>`,
      `<p>Have ready: a bare face (no makeup if you can)${req.format === "in-person" ? "" : ", good light facing you"}, and the products you use now.</p>`,
      `<p>Your $30 becomes a $30 credit toward any treatment once your consultation is done.</p>`,
      `<p>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
  return { request: req, booking, payUrl: pay.url };
}

async function declineConsultRequest(id) {
  const req = await getConsultRequest(id);
  if (!req) { const e = new Error("That request is gone."); e.status = 404; throw e; }
  if (req.status !== "requested") { const e = new Error("That request was already answered."); e.status = 400; throw e; }
  req.status = "declined";
  req.decidedAt = new Date().toISOString();
  await kvSet(`consult-req:${req.id}`, req);
  await sendEmail({
    to: req.email,
    subject: `About your ${consultName(req.format).toLowerCase()} request — ${fmtDateLong(req.date)} at ${req.time}`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">About your ${consultName(req.format).toLowerCase()} request</h2>`,
      `<p>Hi ${String(req.name || "").split(" ")[0] || "there"},</p>`,
      `<p>Thank you for asking — the studio can't do <strong>${fmtDateLong(req.date)} at ${req.time}</strong> for a ${consultName(req.format).toLowerCase()}.</p>`,
      `<p>Regular hours are Monday–Saturday, 10:00 AM–4:00 PM — book one of those times online at <a href="${SITE_URL}/#book">boltonfacials.com</a>, or call ${PHONE_DISPLAY} and the studio will find you a time.</p>`,
      `<p>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
  return req;
}

function addDaysKey(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Shared booking creation — the public wizard and the admin walk-in form
// use this one path, so pricing (gift / referral / Private Hours) and
// slot rules can never drift apart.
//   input: { service, date, time, type, forWhom, name, phone, email,
//            guestName, guestPhone, guestEmail, giftCode, referredBy }
//   opts: { bufferMins, blocks, allowToday, via }
//     allowToday — the public wizard books from tomorrow; the admin panel
//     may book/move to today (a walk-in is standing in the studio).
// Throws an Error with .status (400/409) on any bad input. Returns the
// booking record — NOT saved; the caller saves it and handles payment.
async function buildBooking(input, opts) {
  const b = input || {};
  const o = opts || {};
  const bad = (msg, status) => { const e = new Error(msg); e.status = status || 400; return e; };
  const svc = findService(b.service);
  if (!svc) throw bad("Please choose a treatment.");
  // Add-ons (Tony Nov 17, 2026; lengths per the studio Nov 19, 2026): the four
  // enhancements attach to any treatment — and any one of them can also BE
  // the booking itself (some people just come for the reflexology). No
  // standalone restriction.
  const addons = normalizeAddons(b.addons);
  // Needling is one treatment (Tony Nov 19, 2026): microneedling and
  // NANO needling are the same thing, just the needle size — a booking
  // picks one or the other, never both. The studio picks the size at the visit.
  // (Microneedling as an add-on id is already refused by normalizeAddons.)
  if (svc.id === "microneedling" && addons.includes("nano-needling")) {
    throw bad("Needling is one treatment — pick microneedling or NANO needling, not both. The studio picks the needle size that's best for your face at the visit.");
  }
  // A consultation is just the consultation — no add-ons, and it is for
  // the person on the call or at the visit, never a friend booking.
  if (svc.id === CONSULT_ID && addons.length) {
    throw bad("A consultation is just the consultation — pick your add-ons with your treatment.");
  }
  if (svc.id === CONSULT_ID && b.forWhom === "friend") {
    throw bad("A consultation is for you — the person coming books it.");
  }
  // The format (Tony Nov 19, 2026): video call or in person at the
  // studio. An invalid format is refused, not guessed.
  if (svc.id === CONSULT_ID && b.format != null && b.format !== "" && !CONSULT_FORMATS.includes(b.format)) {
    throw bad("Pick video or in person for your consultation.");
  }
  const format = svc.id === CONSULT_ID ? consultFormatOf(b) : null;
  // First-time clients only (Tony Nov 19, 2026): one consultation per
  // client, ever. A client who has booked with the studio before — any
  // treatment, or a past consultation — books their treatment directly
  // instead. Enforced by email + phone against the referral index every
  // booking creates (one record per client, made at their first booking).
  // the studio's own walk-ins bypass it — the studio's judgment, the studio's call.
  if (svc.id === CONSULT_ID && o.via !== "admin") {
    const prior = await getReferralByEmailOrPhone(b.email, b.phone);
    if (prior) throw bad("You've already had your consultation with the studio — book your treatment directly.");
  }
  const totalMins = durationForBooking(svc.id, addons);
  const addonNames = addons.map((id) => findService(id).name);
  const serviceLabel = svc.id === CONSULT_ID ? consultName(format) : (addonNames.length ? `${svc.name} + ${addonNames.join(" + ")}` : svc.name);
  const type = b.type === "after" ? "after" : "regular";
  // Early mornings and evenings are by request through the studio — never
  // bookable online. Only the studio herself (admin walk-in) books them.
  if (type === "after" && o.via !== "admin") {
    throw bad("Early mornings and evenings are by request — call (289) 212-4124 or email bookings@boltonfacials.com and the studio will set it up.");
  }
  if (!parseDateLocal(b.date)) throw bad("Please choose a day.");
  const todayStr = torontoDateKey();
  const minStr = o.allowToday ? todayStr : addDaysKey(todayStr, 1);
  const maxStr = addDaysKey(todayStr, 60);
  if (b.date < minStr) throw bad(o.allowToday ? "That day has already passed — please choose a later day." : "Bookings start from tomorrow — please choose a later day.");
  if (b.date > maxStr) throw bad("Bookings open up to 60 days ahead — please choose an earlier day.");
  if (!timesFor(b.date, type, svc.id).includes(b.time)) throw bad("That time is not available for this kind of appointment.");
  if (b.date === todayStr) {
    const { mins } = torontoNow();
    if (parseTime(b.time) <= mins) throw bad("That time has already passed today — please choose a later time.");
  }
  if (!b.name || !String(b.name).trim()) throw bad("Please add your name so we know who is coming.");
  if (!b.phone || String(b.phone).replace(/[^0-9]/g, "").length < 10) throw bad("Please add a phone number so we can reach you about your appointment.");
  // Email is optional (Tony Nov 17, 2026) — validate the format only when
  // one is given. The voice-agent hold path keeps email required (it needs
  // somewhere to send the pay link) — see api/book.js handleAgentHold.
  // A video consultation always needs one: the Meet link goes there.
  const emailGiven = String(b.email || "").trim();
  if (emailGiven && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailGiven)) throw bad("That email doesn't look right — check it, or leave it blank.");
  if (svc.id === CONSULT_ID && format === "video" && !emailGiven) throw bad("Please add an email — your video link goes there.");
  if (b.forWhom === "friend") {
    if (!b.guestName || !String(b.guestName).trim()) throw bad("Please add your friend's name so we know who is coming.");
    if (!b.guestPhone || String(b.guestPhone).replace(/[^0-9]/g, "").length < 10) throw bad("Please add your friend's phone so we can reach them about the appointment.");
    const guestEmailGiven = String(b.guestEmail || "").trim();
    if (guestEmailGiven && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmailGiven)) throw bad("Your friend's email doesn't look right — check it, or leave it blank.");
  }

  const dayBookings = await listBookingsForDate(b.date);
  if (slotTaken(dayBookings, parseTime(b.time), totalMins, { bufferMins: o.bufferMins, blocks: o.blocks })) {
    throw bad("That time was just taken — please choose another time.", 409);
  }
  // Four appointments a day, whatever they are (Tony Nov 19, 2026) —
  // early mornings and evenings count too. Consultations share the
  // cap with treatments (A4).
  if (countsTowardCap(svc.id) && dayIsFull(dayBookings)) {
    throw bad("That day is fully booked — the studio takes four appointments a day. Please choose another day, or call (289) 212-4124 and the studio will find you a time.", 409);
  }

  // Who sent them? A referral code from a share link (?ref=CODE) or typed
  // in — it must belong to a real referrer, or the booking is refused.
  let referredBy = null;
  if (b.referredBy && String(b.referredBy).trim()) {
    const rc = normalizeReferralCode(b.referredBy);
    if (!(await getReferralByCode(rc))) {
      throw bad("That referral code was not found — check the code, or leave it blank.");
    }
    referredBy = rc;
  }

  // Price: base + $15 Private Hours premium, less gift-certificate
  // balance, less referral credit. One code per booking, entered in the
  // gift-code field: a gift code applies its balance; a referral code
  // (the referrer's own) applies their credit after the gift balance
  // would — and makes a Reflexology booking free if they have a free
  // add-on banked.
  // The $10 first-visit offer was dropped (Tony Nov 19, 2026) — the $30
  // consultation credit is the one first-visit offer. The field is still
  // recorded as 0 so old bookings keep their recorded value.
  const firstVisitDiscountCents = 0;
  let baseCents = baseCentsFor(svc.id, addons, type);
  let giftCode = null;
  let giftAppliedCents = 0;
  let giftKind = null;
  let referralCode = null;
  let referralAppliedCents = 0;
  let freeReflexologyApplied = false;
  if (b.giftCode && String(b.giftCode).trim()) {
    const gift = await getGift(b.giftCode);
    if (gift) {
      if (!gift.balanceCents || gift.balanceCents <= 0) throw bad("That gift code has no balance left.");
      // A consultation credit pays for a treatment, never another
      // consultation — or one $30 would buy consultations forever.
      if (gift.kind === "consult-credit" && svc.id === CONSULT_ID) {
        throw bad("That credit is for a treatment — it can't pay for another consultation.");
      }
      giftCode = gift.code;
      giftKind = gift.kind || null;
      giftAppliedCents = Math.min(gift.balanceCents, Math.max(0, baseCents));
    } else {
      const rc = normalizeReferralCode(b.giftCode);
      const referralRecord = rc ? await getReferralByCode(rc) : null;
      if (!referralRecord) throw bad("That code was not found — check the code and try again.");
      const em = String(b.email || "").trim().toLowerCase();
      const ph = String(b.phone).replace(/[^0-9]/g, "");
      const owns = (referralRecord.email && referralRecord.email === em)
        || (referralRecord.phone && referralRecord.phone === ph);
      if (!owns) throw bad("That referral code belongs to another client — only the client who earned it can use it.");
      referralCode = referralRecord.code;
      if (svc.id === "reflexology" && (referralRecord.freeReflexology || 0) > 0) {
        freeReflexologyApplied = true;
        baseCents -= svc.priceNum * 100; // the treatment itself is free; the Private Hours premium still applies
      } else if (addons.includes("reflexology") && (referralRecord.freeReflexology || 0) > 0) {
        freeReflexologyApplied = true;
        baseCents -= findService("reflexology").priceNum * 100; // the reflexology add-on is free; the Private Hours premium still applies
      }
      referralAppliedCents = Math.min(referralRecord.creditCents || 0, Math.max(0, baseCents));
    }
  }
  const amountCents = Math.max(0, baseCents - giftAppliedCents - referralAppliedCents);

  // Every client gets ONE personal referral code automatically at booking —
  // the code of the person coming (the guest on a friend booking).
  const attendee = b.forWhom === "friend"
    ? { name: b.guestName, email: b.guestEmail, phone: b.guestPhone }
    : { name: b.name, email: b.email, phone: b.phone };
  const myRef = await getOrCreateReferral(attendee);

  const booking = {
    id: newId("bk"),
    service: svc.id,
    serviceName: svc.id === CONSULT_ID ? consultName(format) : svc.name,
    serviceLabel,
    format,
    addons,
    addonNames,
    servicePriceLabel: svc.priceLabel,
    minsLabel: svc.mins > 0 ? `${totalMins} minutes` : "By consultation",
    date: b.date,
    time: b.time,
    type,
    forWhom: b.forWhom === "friend" ? "friend" : "me",
    name: String(b.name).trim(),
    phone: String(b.phone).trim(),
    email: String(b.email || "").trim(),
    guestName: b.guestName ? String(b.guestName).trim() : null,
    guestPhone: b.guestPhone ? String(b.guestPhone).trim() : null,
    guestEmail: b.guestEmail ? String(b.guestEmail).trim() : null,
    firstVisitDiscountCents,
    giftCode,
    giftAppliedCents,
    giftKind,
    giftDeducted: false,
    referralCode,
    referralAppliedCents,
    referralDeducted: false,
    freeReflexologyApplied,
    freeReflexologyDeducted: false,
    referredBy,
    myReferralCode: myRef.code,
    amountCents,
    amountPaidCents: 0,
    status: "pending",
    via: o.via || "web",
    emailSent: false,
    createdAt: new Date().toISOString(),
  };
  if (referredBy) await noteReferral(booking);
  return booking;
}

// Stripe Checkout for a booking (public wizard + admin walk-in pay link).
// Returns the session; the caller saves checkoutSessionId / checkoutUrl.
// The consultation's checkout names the service plainly (Tony Nov 19,
// 2026): "Video Consultation — In2Skin" / "In-Person Consultation —
// In2Skin", "Payment for Video Consultation · In2Skin, Bolton, Ontario"
// (or In-Person). The card statement descriptor is IN2SKIN
// on every booking checkout — the consult uses the same one. A treatment
// paid with a consultation credit says so on the checkout page.
async function createBookingCheckout(booking) {
  const { getStripe } = require("./stripe");
  const stripe = getStripe();
  const isConsult = booking.service === CONSULT_ID;
  const format = consultFormatOf(booking);
  const giftSuffix = booking.giftAppliedCents
    ? booking.giftKind === "consult-credit"
      ? ` · ${money(booking.giftAppliedCents)} consultation credit ${booking.giftCode}`
      : ` · ${money(booking.giftAppliedCents)} from gift certificate ${booking.giftCode}`
    : "";
  const productName = isConsult
    ? `${consultName(format)} — In2Skin`
    : `${booking.serviceLabel || booking.serviceName} — ${booking.date} at ${booking.time}${booking.type === "after" ? " (Private Hours)" : ""}`;
  const productDescription = isConsult
    ? `Payment for ${consultName(format)} · In2Skin, Bolton, Ontario — ${booking.date} at ${booking.time}${giftSuffix}${booking.referralAppliedCents ? ` · ${money(booking.referralAppliedCents)} from referral credit ${booking.referralCode}` : ""}`
    : `In2Skin · Bolton, Ontario${giftSuffix}${booking.referralAppliedCents ? ` · ${money(booking.referralAppliedCents)} from referral credit ${booking.referralCode}` : ""}${booking.freeReflexologyApplied ? " · free reflexology add-on" : ""}`;
  return stripe.checkout.sessions.create({
    mode: "payment",
    currency: "cad",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "cad",
        unit_amount: booking.amountCents,
        product_data: {
          name: productName,
          description: productDescription,
        },
      },
    }],
    payment_intent_data: { statement_descriptor: "IN2SKIN" },
    ...(booking.email ? { customer_email: booking.email } : {}),
    metadata: {
      type: "booking",
      bookingId: booking.id,
      giftCode: booking.giftCode || "",
      giftAppliedCents: String(booking.giftAppliedCents || 0),
      referralCode: booking.referralCode || "",
      referralAppliedCents: String(booking.referralAppliedCents || 0),
    },
    success_url: `${SITE_URL}/booked.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/#book`,
  });
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

async function getPayment(id) {
  if (!id) return null;
  return kvGet(`payment:${id}`);
}

// Delete a pay-on-the-spot payment record for good (Tony Nov 19, 2026 —
// the studio needs to clear test payments from the dashboard herself).
// Removes the record + its place in the payments:all index. Booking-linked
// payments are NOT deleted here — they are the audit trail for money already
// in a booking's amountPaidCents; the booking itself is deleted (or
// cancelled) from the calendar instead. The caller archives the record
// FIRST (see archiveDeleted in api/admin/data.js) — a payment is only
// ever deleted after a backup copy exists.
async function deletePayment(id) {
  const p = await getPayment(id);
  if (!p) return false;
  await kvDel(`payment:${id}`);
  const ids = (await kvGet("payments:all")) || [];
  await kvSet("payments:all", ids.filter((x) => x !== id));
  return true;
}

// Pay-on-the-spot link — the dashboard form and the admin "send a pay link"
// for a booking balance share this one path.
//   amountCents is what the client owes. NEVER pass a booking's gift code
//   here: the gift balance was already taken off the booking total, and
//   passing it would deduct it a second time.
// Returns { url, stripeUrl, id, paid, giftAppliedCents, sms } — or
// { paid: true, ... } when a gift code covers the whole amount.
async function createPayLink({ amountCents, clientName, contact, method, serviceLabel, giftCode, bookingId }) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  const amount = Math.round(Number(amountCents));
  if (!amount || amount < 100) throw bad("Please enter the amount owed — $1 or more.");
  if (!clientName || !String(clientName).trim()) throw bad("Please add the client's name.");
  const m = ["text", "email", "qr"].includes(method) ? method : "text";
  const ct = String(contact || "").trim();
  if (m === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ct)) throw bad("Please add the client's email — the payment link is sent there.");
  if (m === "text" && ct.replace(/[^0-9]/g, "").length < 10) throw bad("Please add the client's mobile number — the payment link is texted there.");

  // Optional gift code: its balance comes off what is owed.
  let gift = null;
  let giftAppliedCents = 0;
  if (giftCode && String(giftCode).trim()) {
    gift = await getGift(giftCode);
    if (!gift) throw bad("That gift code was not found — check the code and try again.");
    if (!gift.balanceCents || gift.balanceCents <= 0) throw bad("That gift code has no balance left.");
    giftAppliedCents = Math.min(gift.balanceCents, amount);
  }
  const dueCents = amount - giftAppliedCents;
  const id = newId("pl");
  const label = String(serviceLabel || "In2Skin visit").slice(0, 200);
  const name = String(clientName).trim();

  if (dueCents <= 0) {
    // Fully covered by the gift code — no payment link needed.
    gift.balanceCents = Math.max(0, gift.balanceCents - giftAppliedCents);
    logGiftUse(gift, {
      bookingId: id, amountCents: giftAppliedCents,
      date: new Date().toISOString(), usedBy: name, note: "pay on the spot",
    });
    await kvSet(`gift:${gift.code}`, gift);
    await kvSet(`paylink:${id}`, {
      id, amountCents: amount, dueCents: 0, clientName: name, contact: ct, method: m,
      serviceLabel: label, giftCode: gift.code, giftAppliedCents, paid: true,
      bookingId: bookingId || null, createdAt: new Date().toISOString(),
    });
    return { paid: true, id, giftAppliedCents, amountCents: amount };
  }

  const { getStripe } = require("./stripe");
  const stripe = getStripe();
  const link = await stripe.paymentLinks.create({
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "cad",
        unit_amount: dueCents,
        product_data: { name: `${label} — In2Skin`, description: `Payment for ${name} · In2Skin, Bolton, Ontario` },
      },
    }],
    payment_intent_data: { statement_descriptor: "IN2SKIN" },
    metadata: { type: "payspot", paylinkId: id, giftCode: gift ? gift.code : "", giftAppliedCents: String(giftAppliedCents), bookingId: bookingId || "" },
    // After the client pays, Stripe sends them back here (not to the link
    // page) so pay-paid.html can confirm the payment even if the webhook
    // never fires — the webhook never fired for the Nov 17 test payment.
    after_completion: { type: "redirect", redirect: { url: `${SITE_URL}/pay-paid.html?id=${id}&session_id={CHECKOUT_SESSION_ID}` } },
  });
  const url = `${SITE_URL}/pay?id=${id}`;
  await kvSet(`paylink:${id}`, {
    id, amountCents: amount, dueCents, clientName: name, contact: ct, method: m,
    serviceLabel: label, giftCode: gift ? gift.code : null, giftAppliedCents,
    stripeUrl: link.url, stripePaymentLinkId: link.id, paid: false,
    bookingId: bookingId || null, createdAt: new Date().toISOString(),
  });

  let sms = null;
  if (m === "email") {
    await sendEmail({
      to: ct,
      subject: `Your In2Skin payment link — ${money(dueCents)}`,
      html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin payment link</h2><p>Hi ${name.split(" ")[0] || "there"},</p><p>Here is your secure payment link for <strong>${label}</strong> — <strong>${money(dueCents)}</strong>${giftAppliedCents ? ` (${money(giftAppliedCents)} was covered by your gift certificate)` : ""}:</p><p><a href="${url}">${url}</a></p><p>Pay by Visa, Mastercard, Amex or Apple Pay on your own phone. The charge shows as <strong>IN2SKIN</strong> on your card statement, and your receipt arrives the moment you pay.</p><p>— In2Skin, Bolton</p>`,
    });
  } else if (m === "text") {
    // Resend sends email only — there is no SMS provider wired up yet.
    sms = "not_configured";
  }
  return { url, stripeUrl: link.url, id, giftAppliedCents, sms };
}

// Mark a pay-on-the-spot link paid from a Stripe checkout session — the
// shared settle step for BOTH the webhook (/api/stripe-webhook) and the GET
// fallback (/api/pay?session_id=...). The webhook never fired for the Nov 17
// test payment (zero invocations in the Vercel logs), so the link cannot
// depend on it alone; the pay-paid.html redirect replays this same step.
// Idempotent: a session already recorded on the link returns the record
// without recording the payment, the gift deduction, or the booking add a
// second time — so a webhook that arrives after the fallback (or vice versa)
// is a harmless no-op. Returns the paylink record, or null when the link
// in the session metadata does not exist.
async function markPaylinkPaid(session) {
  const meta = (session && session.metadata) || {};
  const rec = await kvGet(`paylink:${meta.paylinkId}`);
  if (!rec) return null;
  if (rec.paid && rec.checkoutSessionId === session.id) return rec;
  if (meta.giftCode && meta.giftAppliedCents && !rec.giftDeducted) {
    const gift = await getGift(meta.giftCode);
    if (gift) {
      gift.balanceCents = Math.max(0, gift.balanceCents - Number(meta.giftAppliedCents));
      logGiftUse(gift, {
        bookingId: rec.id, amountCents: Number(meta.giftAppliedCents),
        date: new Date().toISOString(), usedBy: rec.clientName || "",
        note: "pay on the spot",
      });
      await kvSet(`gift:${gift.code}`, gift);
    }
    rec.giftDeducted = true;
  }
  rec.paid = true;
  rec.paidAt = new Date().toISOString();
  rec.checkoutSessionId = session.id;
  await kvSet(`paylink:${rec.id}`, rec);
  await recordPayment({
    id: newId("pay"),
    kind: "pay-spot",
    amountCents: session.amount_total || rec.dueCents,
    clientName: rec.clientName,
    serviceLabel: rec.serviceLabel,
    method: "card",
    paylinkId: rec.id,
    bookingId: rec.bookingId || null,
    checkoutSessionId: session.id,
    createdAt: new Date().toISOString(),
  });
  // A pay link sent for a booking balance: the money lands on the booking,
  // and a booking that was waiting on payment becomes paid (gift + referral
  // settle once, via finalizePaidBooking). A booking already marked paid can
  // still owe a balance — a move to Private Hours raises the total by $15 —
  // so the amount is added for any booking that is not closed, and only
  // unpaid/pending flip to paid.
  if (rec.bookingId) {
    const booking = await getBooking(rec.bookingId);
    if (booking && !["completed", "cancelled", "no-show"].includes(booking.status)) {
      booking.amountPaidCents = (booking.amountPaidCents || 0) + (session.amount_total || rec.dueCents);
      booking.paymentMethod = "card";
      if (booking.amountPaidCents >= (booking.amountCents || 0) && (booking.status === "unpaid" || booking.status === "pending")) {
        booking.status = "paid";
        await kvSet(`booking:${booking.id}`, booking);
        await finalizePaidBooking(booking);
      } else {
        await kvSet(`booking:${booking.id}`, booking);
      }
    }
  }
  if (rec.contact && rec.contact.includes("@")) {
    await sendEmail({
      to: rec.contact,
      subject: `Your In2Skin receipt — ${money(session.amount_total || rec.dueCents)} paid`,
      html: `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Paid — thank you</h2><p>Hi ${String(rec.clientName || "").split(" ")[0] || "there"},</p><p>Your payment of <strong>${money(session.amount_total || rec.dueCents)}</strong> for <strong>${rec.serviceLabel}</strong> at In2Skin is confirmed. The charge shows as <strong>IN2SKIN</strong> on your card statement.</p><p>— In2Skin, Bolton</p>`,
    });
  }
  return rec;
}

// Deduct a gift balance once (guarded by booking.giftDeducted).


/* ---------------- emails ---------------- */

function bookingEmailHtml(b, meetLink) {
  const who = b.forWhom === "friend" && b.guestName ? b.guestName : b.name;
  const isConsult = b.service === CONSULT_ID;
  const format = consultFormatOf(b);
  // Video consultation only: the link (or "coming") + what to have ready.
  // Never a fake link — if no Meet link is set yet, the
  // email says it is coming. An in-person consultation gets no link —
  // it happens at the studio.
  const videoBlock = !isConsult || format !== "video" ? "" : meetLink
    ? `<p><strong>Your video call:</strong> tap this link at your appointment time — <a href="${meetLink}">${meetLink}</a>. No app needed — it opens in your browser.</p><p>Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`
    : `<p><strong>Your video link is coming</strong> — the studio will email it to you before your consultation. Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`;
  // The $30 becomes a credit once the consultation is done — but only
  // when real money was paid for it (a gift code covering the consult
  // earns no new credit).
  const creditLine = !isConsult || (b.amountPaidCents || 0) <= 0 ? ""
    : `<p>Your $30 becomes a <strong>$30 credit toward any treatment</strong> once your consultation is done — the studio will email you the code after your call.</p>`;
  const lines = [
    `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin booking is confirmed</h2>`,
    `<p>Hi ${String(who || "").split(" ")[0] || "there"},</p>`,
    `<p>Your appointment is booked in:</p>`,
    `<ul><li><strong>${b.serviceLabel || b.serviceName}</strong> — ${b.minsLabel || ""}</li>`,
    `<li>${fmtDateLong(b.date)} at ${b.time}${b.type === "after" ? " (Private Hours)" : ""}</li>`,
    isConsult
      ? format === "video"
        ? `<li>On video — tap your video link at your appointment time</li>`
        : `<li>In person at In2Skin · Bolton, Ontario — directions are shared when you book</li>`
      : `<li>In2Skin · Bolton, Ontario — directions are shared when you book</li>`,
    `<li>Paid: <strong>${money(b.amountPaidCents || 0)}</strong>${appliedCreditText(b)}</li></ul>`,
    videoBlock,
    consultCreditLine(b),
    creditLine,
    `<p>The charge shows as <strong>IN2SKIN</strong> on your card statement.</p>`,
    b.serviceName === "Chemical Peels"
      ? `<p>Your peel is booked at the $125 starting price — the exact price ($125–$475) is confirmed at your consultation, and any balance is settled at your visit.</p>` : "",
    b.serviceName === "Microneedling"
      ? `<p>Your needling is booked at $65 — the studio picks the needle size (micro or nano) that's best for your face at the visit.</p>` : "",
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
  const format = consultFormatOf(booking);
  const meetLink = await meetLinkFor(booking);
  const videoBlock = booking.service !== CONSULT_ID || format !== "video" ? "" : meetLink
    ? `<p><strong>Your video call:</strong> tap this link at your appointment time — <a href="${meetLink}">${meetLink}</a>. No app needed — it opens in your browser. Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`
    : `<p><strong>Your video link is coming</strong> — the studio will email it to you before your consultation. Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`;
  const lines = [
    `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your In2Skin appointment is held</h2>`,
    `<p>Hi ${who},</p>`,
    `<p>We are holding this time for you:</p>`,
    `<ul><li><strong>${booking.serviceLabel || booking.serviceName}</strong> — ${booking.minsLabel || ""}</li>`,
    `<li>${fmtDateLong(booking.date)} at ${booking.time}${booking.type === "after" ? " (Private Hours)" : ""}</li>`,
    `<li>In2Skin · Bolton, Ontario</li>`,
    `<li>To pay: <strong>${money(booking.amountCents || 0)}</strong>${appliedCreditText(booking)} — the charge shows as <strong>IN2SKIN</strong> on your card statement.</li></ul>`,
    videoBlock,
    consultCreditLine(booking),
    checkoutUrl
      ? `<p><a href="${checkoutUrl}" style="display:inline-block;background:#2F4A2C;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;">Confirm and pay</a></p><p>This hold lasts <strong>30 minutes</strong> — if you do not confirm and pay within 30 minutes, the time opens back up and you will need to book again.</p>${booking.service === CONSULT_ID && format === "video" ? "" : `<p>Prefer to pay at your visit? Call ${PHONE_DISPLAY} and confirm with the studio — that locks it in too.</p>`}`
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

// Walk-in booked as "pay later": the appointment is real and holds the
// slot; payment is due at the visit. (When the studio records the payment, the
// normal confirmation email goes out via finalizePaidBooking.)
async function sendWalkInConfirmation(booking) {
  const who = attendeeOf(booking);
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const first = String(who.name || "").split(" ")[0] || "there";
  const format = consultFormatOf(booking);
  const meetLink = await meetLinkFor(booking);
  const videoBlock = booking.service !== CONSULT_ID || format !== "video" ? "" : meetLink
    ? `<p><strong>Your video call:</strong> tap this link at your appointment time — <a href="${meetLink}">${meetLink}</a>. No app needed — it opens in your browser. Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`
    : `<p><strong>Your video link is coming</strong> — the studio will email it to you before your consultation. Have ready: a bare face (no makeup if you can), good light facing you, and the products you use now.</p>`;
  // A video consultation is paid by card link; an in-person one is paid
  // at the studio like any treatment — same $30 either way.
  const dueLine = booking.service === CONSULT_ID
    ? format === "video"
      ? (balanceDue(booking) <= 0
        ? `<li><strong>No payment due</strong> — this one is on us.</li></ul>`
        : `<li>Amount due: <strong>${money(balanceDue(booking))}</strong> — the studio will send you a secure card link to pay, or you can settle it at your first treatment.</li></ul>`)
      : `<li>Amount due at your visit: <strong>${money(balanceDue(booking))}</strong>${appliedCreditText(booking)}</li></ul>`
    : `<li>Amount due at your visit: <strong>${money(balanceDue(booking))}</strong>${appliedCreditText(booking)}</li></ul>`;
  const payLine = booking.service === CONSULT_ID && format === "video"
    ? `<p>Pay by card on your own phone — the charge shows as <strong>IN2SKIN</strong> on your card statement.</p>`
    : `<p>Pay at the studio by cash, e-transfer, or card on your own phone — the charge shows as <strong>IN2SKIN</strong> on your card statement.</p>`;
  return sendEmail({
    to,
    subject: `Your In2Skin booking — ${booking.serviceName}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your appointment is booked</h2>`,
      `<p>Hi ${first},</p>`,
      `<p>Your appointment is booked in:</p>`,
      `<ul><li><strong>${booking.serviceLabel || booking.serviceName}</strong> — ${booking.minsLabel || ""}</li>`,
      `<li>${fmtDateLong(booking.date)} at ${booking.time}${booking.type === "after" ? " (Private Hours)" : ""}</li>`,
      `<li>In2Skin · Bolton, Ontario</li>`,
      dueLine,
      videoBlock,
      consultCreditLine(booking),
      payLine,
      `<p>Need to move your appointment? Please call at least 24 hours ahead (${PHONE_DISPLAY}) and we will find you a new time — there is no charge to reschedule.</p>`,
      booking.myReferralCode ? `<p><strong>Your personal referral code: ${booking.myReferralCode}</strong> — share it with a friend: <a href="${SITE_URL}/?ref=${booking.myReferralCode}">boltonfacials.com/?ref=${booking.myReferralCode}</a>. When three friends book and pay in full with your code, you earn $15 treatment credit and a free reflexology add-on. No cash value — credit is for treatments only.</p>` : "",
      `<p>We look forward to welcoming you.<br/>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
}

/* ---------------- consultation reminders ---------------- */
// The 1-hour-before reminder. Vercel Hobby crons run at most once a day,
// so no cron can send these — the dashboard's 30-second poll drives them
// instead (see sendDueConsultReminders, called from the counts view):
// while the studio's dashboard is open, every poll sweeps today's paid
// consultations due within ~75 minutes. The confirmation email already
// carries the link, so a missed reminder (dashboard closed) loses
// nothing — the client still has the link.
async function sendConsultReminder(booking) {
  const who = attendeeOf(booking);
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const format = consultFormatOf(booking);
  const meetLink = await meetLinkFor(booking);
  const first = String(who.name || "").split(" ")[0] || "there";
  const ok = await sendEmail({
    to,
    subject: `Your ${format === "video" ? "video " : ""}consultation is in an hour — ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: [
      `<h2 style="font-family:Georgia,serif;color:#2F4A2C;">Your ${format === "video" ? "video " : ""}consultation is in an hour</h2>`,
      `<p>Hi ${first},</p>`,
      `<p>Your <strong>${consultName(format)}</strong> with the studio is at <strong>${booking.time} today</strong>.</p>`,
      format === "video"
        ? meetLink
          ? `<p>Tap this link at your appointment time — <a href="${meetLink}">${meetLink}</a>. No app needed — it opens in your browser.</p>`
          : `<p>Your video link is coming — check your email for it, or call ${PHONE_DISPLAY} if it hasn't arrived.</p>`
        : `<p>See you at the studio — In2Skin, Bolton.</p>`,
      `<p>Have ready: a bare face (no makeup if you can)${format === "video" ? ", good light facing you" : ""}, and the products you use now.</p>`,
      `<p>Need to move it? Please call at least 24 hours ahead (${PHONE_DISPLAY}) — there is no charge to reschedule.</p>`,
      `<p>— In2Skin, Bolton</p>`,
    ].join("\n"),
  });
  if (ok) {
    booking.reminderSentAt = new Date().toISOString();
    await kvSet(`booking:${booking.id}`, booking);
  }
  return ok;
}

// Sweep today's paid/unpaid consultations starting within the next
// 75 minutes (and not already past by more than 20) that haven't had a
// reminder yet. Never throws — a reminder failure must never break the
// dashboard poll that calls it.
async function sendDueConsultReminders() {
  try {
    const today = torontoDateKey();
    const { mins } = torontoNow();
    const bookings = await listBookingsForDate(today);
    for (const b of bookings) {
      if (!b || b.service !== CONSULT_ID) continue;
      if (!["paid", "unpaid"].includes(b.status)) continue;
      if (b.reminderSentAt) continue;
      const startMin = parseTime(b.time);
      if (startMin == null) continue;
      const inMins = startMin - mins;
      if (inMins > 75 || inMins < -20) continue;
      await sendConsultReminder(b);
    }
  } catch (e) {
    console.error("[consult-reminder]", e);
  }
}

async function sendBookingConfirmation(booking) {
  if (booking.emailSent) return false;
  const to = [booking.email];
  if (booking.forWhom === "friend" && booking.guestEmail && booking.guestEmail !== booking.email) to.push(booking.guestEmail);
  const meetLink = await meetLinkFor(booking);
  const ok = await sendEmail({
    to,
    subject: `Your In2Skin booking is confirmed — ${booking.serviceName}, ${fmtDateLong(booking.date)} at ${booking.time}`,
    html: bookingEmailHtml(booking, meetLink),
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
  SITE_URL, PHONE_DISPLAY, CONSULT_ID, CONSULT_CREDIT_CENTS, CONSULT_FORMATS,
  consultFormatOf, consultName, consultCreditLine, appliedCreditText,
  newId, fmtDateLong, hoursUntilBooking,
  saveBooking, getBooking, removeBookingFromDate, deleteBooking, balanceDue,
  listBookingsForDate, listBookingsRange,
  dueFinishChecks, notifyFinishCheck, markFinishDone, snoozeFinishCheck,
  newGiftCode, normalizeGiftCode, getGift, deductGift, ensureGiftCode, deleteGift,
  logGiftUse, giftDisplayStatus, listGifts, finalizePaidBooking, markBookingOutcome,
  restoreBookingValue, cancelBooking, moveBooking,
  buildBooking, createBookingCheckout, createPayLink, markPaylinkPaid,
  recordPayment, listPayments, getPayment, deletePayment,
  sendBookingConfirmation, sendGiftCertificate, sendGiftReceipt, sendHoldEmail,
  sendCancellationEmail, sendMoveEmail, sendWalkInConfirmation,
  sendVoucherCertificate, voucherCertificateHtml, notifyStudioBooking,
  bookingEmailHtml, issueConsultCredit, sendConsultReminder, sendDueConsultReminders,
  meetLinkFor, mintConsultMeetLink, deleteConsultMeetEvent, remintConsultMeetLink,
  createConsultRequest, listConsultRequests, getConsultRequest,
  acceptConsultRequest, declineConsultRequest,
};
