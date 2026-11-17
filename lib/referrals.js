// Referral program (Tony Nov 17, 2026 — rules locked):
//   Every three friends who book and pay in full earns the referrer $15
//   treatment credit + one free Reflexology add-on. NOT $15 per referral —
//   1–2 referrals earn nothing until the 3rd lands, and the reward repeats
//   every three (3 = $15 + free reflexology, 6 = another $15 + another one).
//   NO cash value, ever — the $15 is treatment credit only, never paid out
//   or refunded as cash.
//   Anti-gaming: credit issues only after the friend is a NEW client
//   (email/phone never booked before) who PAYS IN FULL. Nobody can refer
//   themselves. One credit per new client.
// Keys:
//   ref:<CODE>                  referrer record
//   ref:all                    JSON array of referral codes
//   ref:email:<lower email>    code for that client
//   ref:phone:<digits>         code for that client
//   ref:credited:<bookingId>   marker — credit already decided for that booking
//   client:paid:<lower email>  marker — that client has paid in full before
//   client:paid:phone:<digits> same, by phone
const crypto = require("crypto");
const { kvGet, kvSet } = require("./kv");

const REFERRAL_CREDIT_CENTS = 1500; // $15 treatment credit per reward
const REFERRALS_PER_REWARD = 3;     // reward lands every 3 paid referrals
const FREE_REFLEXOLOGY_PER_REWARD = 1;

function normalizeReferralCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[\s-]/g, "").replace(/^([A-Z]{2,12})(\d{4})$/, "$1-$2");
}

function newReferralCode(firstName) {
  const first = String(firstName || "Guest").split(" ")[0].replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 12) || "GUEST";
  return `${first}-${String(crypto.randomInt(1000, 10000))}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

async function getReferralByCode(rawCode) {
  const code = normalizeReferralCode(rawCode);
  if (!/^[A-Z]{2,12}-\d{4}$/.test(code)) return null;
  return kvGet(`ref:${code}`);
}

async function getReferralByEmailOrPhone(email, phone) {
  const em = normalizeEmail(email);
  const ph = normalizePhone(phone);
  if (em) {
    const code = await kvGet(`ref:email:${em}`);
    if (code) {
      const r = await getReferralByCode(code);
      if (r) return r;
    }
  }
  if (ph) {
    const code = await kvGet(`ref:phone:${ph}`);
    if (code) {
      const r = await getReferralByCode(code);
      if (r) return r;
    }
  }
  return null;
}

// Every client gets ONE personal code, created the first time they book.
// Same email or phone -> the same code, forever.
async function getOrCreateReferral({ name, email, phone }) {
  const existing = await getReferralByEmailOrPhone(email, phone);
  if (existing) return existing;
  const em = normalizeEmail(email);
  const ph = normalizePhone(phone);
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = newReferralCode(name);
    if (!(await kvGet(`ref:${candidate}`))) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not create a referral code — please try again.");
  const now = new Date().toISOString();
  const rec = {
    code,
    name: String(name || "").trim(),
    email: em,
    phone: ph,
    creditCents: 0,
    creditUsedCents: 0,
    freeReflexology: 0,
    paidCount: 0,
    referred: [], // { bookingId, name, email, phone, date, paid }
    createdAt: now,
    updatedAt: now,
  };
  await kvSet(`ref:${code}`, rec);
  if (em) await kvSet(`ref:email:${em}`, code);
  if (ph) await kvSet(`ref:phone:${ph}`, code);
  const all = (await kvGet("ref:all")) || [];
  if (!all.includes(code)) {
    all.push(code);
    await kvSet("ref:all", all);
  }
  return rec;
}

async function listReferrals() {
  const codes = (await kvGet("ref:all")) || [];
  const out = [];
  for (const code of codes) {
    const r = await kvGet(`ref:${code}`);
    if (r) out.push(r);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// The person coming to the appointment — the guest on a friend booking,
// the booker on a booking for themselves.
function attendeeOf(booking) {
  if (booking.forWhom === "friend" && booking.guestName) {
    return { name: booking.guestName, email: booking.guestEmail, phone: booking.guestPhone };
  }
  return { name: booking.name, email: booking.email, phone: booking.phone };
}

// A booking was created with a referral code: note it on the referrer's
// record (paid: false until the friend pays in full).
async function noteReferral(booking) {
  const code = normalizeReferralCode(booking.referredBy);
  if (!code) return false;
  const referrer = await getReferralByCode(code);
  if (!referrer) return false;
  const f = attendeeOf(booking);
  referrer.referred = referrer.referred || [];
  if (!referrer.referred.some((r) => r.bookingId === booking.id)) {
    referrer.referred.push({
      bookingId: booking.id, name: f.name || "", email: f.email || "",
      phone: f.phone || "", date: booking.date || "", paid: false,
    });
    referrer.updatedAt = new Date().toISOString();
    await kvSet(`ref:${referrer.code}`, referrer);
  }
  return true;
}

// Mark a client as having paid in full (the new-client check for referrals).
// Called for every paid booking — a client who paid once is never "new" again.
async function markClientPaid(booking) {
  if (!booking || booking.status !== "paid") return false;
  const f = attendeeOf(booking);
  const em = normalizeEmail(f.email);
  const ph = normalizePhone(f.phone);
  const now = new Date().toISOString();
  if (em && !(await kvGet(`client:paid:${em}`))) {
    await kvSet(`client:paid:${em}`, { at: now, bookingId: booking.id });
  }
  if (ph && !(await kvGet(`client:paid:phone:${ph}`))) {
    await kvSet(`client:paid:phone:${ph}`, { at: now, bookingId: booking.id });
  }
  return true;
}

// Issue referral credit at paid-marking. Idempotent: the ref:credited marker
// means a second call (webhook + status page) is a no-op. Runs only for a
// booking that is paid in full — consultation bookings earn nothing.
async function issueReferralCredit(booking) {
  if (!booking || booking.status !== "paid") return { issued: false, reason: "not-paid" };
  const code = normalizeReferralCode(booking.referredBy);
  if (!code) return { issued: false, reason: "no-referrer" };
  const markerKey = `ref:credited:${booking.id}`;
  if (await kvGet(markerKey)) return { issued: false, reason: "already" };
  const referrer = await getReferralByCode(code);
  if (!referrer) return { issued: false, reason: "unknown-code" };
  const f = attendeeOf(booking);
  const fEmail = normalizeEmail(f.email);
  const fPhone = normalizePhone(f.phone);
  const now = new Date().toISOString();
  // Nobody can refer themselves.
  const self = (fEmail && fEmail === normalizeEmail(referrer.email))
    || (fPhone && fPhone === normalizePhone(referrer.phone));
  if (self) {
    await kvSet(markerKey, { at: now, reason: "self" });
    return { issued: false, reason: "self" };
  }
  // Only a NEW client who pays in full earns credit.
  const paidBefore = (fEmail && (await kvGet(`client:paid:${fEmail}`)))
    || (fPhone && (await kvGet(`client:paid:phone:${fPhone}`)));
  if (paidBefore) {
    await kvSet(markerKey, { at: now, reason: "not-new" });
    return { issued: false, reason: "not-new" };
  }
  // Record the friend as a paid client now — one credit per new client,
  // and this booking can never earn credit again.
  if (fEmail) await kvSet(`client:paid:${fEmail}`, { at: now, bookingId: booking.id });
  if (fPhone) await kvSet(`client:paid:phone:${fPhone}`, { at: now, bookingId: booking.id });
  referrer.paidCount = (referrer.paidCount || 0) + 1;
  referrer.referred = referrer.referred || [];
  const entry = referrer.referred.find((r) => r.bookingId === booking.id);
  if (entry) entry.paid = true;
  else {
    referrer.referred.push({
      bookingId: booking.id, name: f.name || "", email: f.email || "",
      phone: f.phone || "", date: booking.date || "", paid: true,
    });
  }
  let awarded = false;
  if (referrer.paidCount % REFERRALS_PER_REWARD === 0) {
    referrer.creditCents = (referrer.creditCents || 0) + REFERRAL_CREDIT_CENTS;
    referrer.freeReflexology = (referrer.freeReflexology || 0) + FREE_REFLEXOLOGY_PER_REWARD;
    awarded = true;
  }
  referrer.updatedAt = now;
  await kvSet(`ref:${referrer.code}`, referrer);
  await kvSet(markerKey, { at: now, awarded, paidCount: referrer.paidCount });
  return {
    issued: true, awarded, paidCount: referrer.paidCount,
    creditCents: referrer.creditCents, freeReflexology: referrer.freeReflexology,
  };
}

// Deduct referral credit + a free reflexology once (guarded by the flags on
// the booking). Returns the credit cents deducted.
async function deductReferral(booking) {
  if (!booking || !booking.referralCode) return 0;
  const ref = await getReferralByCode(booking.referralCode);
  if (!ref) return 0;
  let deducted = 0;
  let changed = false;
  if (booking.referralAppliedCents && !booking.referralDeducted) {
    const amt = Math.min(ref.creditCents || 0, booking.referralAppliedCents);
    ref.creditCents = (ref.creditCents || 0) - amt;
    ref.creditUsedCents = (ref.creditUsedCents || 0) + amt;
    deducted = amt;
    booking.referralDeducted = true;
    changed = true;
  }
  if (booking.freeReflexologyApplied && !booking.freeReflexologyDeducted) {
    if ((ref.freeReflexology || 0) > 0) ref.freeReflexology -= 1;
    booking.freeReflexologyDeducted = true;
    changed = true;
  }
  if (changed) {
    ref.updatedAt = new Date().toISOString();
    await kvSet(`ref:${ref.code}`, ref);
    await kvSet(`booking:${booking.id}`, booking);
  }
  return deducted;
}

module.exports = {
  REFERRAL_CREDIT_CENTS, REFERRALS_PER_REWARD, FREE_REFLEXOLOGY_PER_REWARD,
  normalizeReferralCode, newReferralCode, normalizeEmail, normalizePhone,
  getReferralByCode, getReferralByEmailOrPhone, getOrCreateReferral, listReferrals,
  attendeeOf, noteReferral, markClientPaid, issueReferralCredit, deductReferral,
};
