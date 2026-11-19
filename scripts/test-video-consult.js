// Video consultation tests — 20 minutes, $30, first-time clients only,
// credited in full toward a later treatment (Tony Nov 19, 2026).
// TWO formats, one service: video call on Google Meet, or a walk-in
// face consultation at the studio. Only video bookings get the Meet link.
// When a treatment uses the $30 credit, the booking SHOWS it — the
// confirmation email and the dashboard both carry the line.
// Run: node scripts/test-video-consult.js
// Uses an in-memory KV stub + stubbed Stripe/auth (no Stripe/KV/Resend needed).
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
// --- Stripe stub with checkout + pay-link capture ---
let lastCheckoutArgs = null;
let retrieveMetadata = {};
const stripePath = require.resolve("../lib/stripe");
require.cache[stripePath] = {
  exports: {
    getStripe: () => ({
      checkout: {
        sessions: {
          create: async (args) => { lastCheckoutArgs = args; return { id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" }; },
          retrieve: async () => ({ payment_status: "paid", amount_total: 3000, metadata: retrieveMetadata, payment_intent: "pi_test" }),
        },
      },
      paymentLinks: { create: async () => ({ id: "plink_test_1", url: "https://pay.stripe.test/plink_test_1" }) },
      webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    }),
  },
};

process.env.RESEND_API_KEY = "re_test";
process.env.AGENT_API_KEY = "test-agent-key";

// --- capture outgoing email (Resend) ---
const sentEmails = [];
global.fetch = async (url, opts) => {
  sentEmails.push({ url: String(url), body: opts && opts.body ? String(opts.body) : "" });
  return { ok: true, json: async () => ({}) };
};

const { kvGet, kvSet } = require("../lib/kv");
const sched = require("../lib/schedule");
const studio = require("../lib/studio");
const transfer = require("../lib/transfer");
const B = require("../lib/bookings");
const dataHandler = require("../api/admin/data");
const availability = require("../api/availability");
const book = require("../api/book");

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
function mockReq({ method = "GET", headers = {}, body = null, query = {} } = {}) {
  return { method, headers, body, query };
}
async function callAdmin(body, query = {}) {
  const res = mockRes();
  await dataHandler(mockReq({ method: body ? "POST" : "GET", body, query }), res);
  return res;
}
async function callBook(body, headers = {}) {
  const res = mockRes();
  await book(mockReq({ method: "POST", headers, body }), res);
  return res;
}
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
// A future weekday (requests and bookings never run on Sundays).
function futureWeekday(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
// "2:30 PM" style label for a Toronto wall-clock minute count.
function fmtMins(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return h12 + ":" + String(m).padStart(2, "0") + " " + (h24 < 12 ? "AM" : "PM");
}
const consultBase = (over) => Object.assign({
  service: "consultation", date: futureWeekday(5), time: "2:00 PM", type: "regular",
  name: "New Client", phone: "(905) 555-0300", email: "newclient@test.example", first: "yes",
}, over || {});
const webBody = (over) => Object.assign(consultBase(over), {
  website: "", formLoadedAt: String(Date.now() - 10000),
});
const agentBody = (over) => Object.assign({
  via: "agent", service: "consultation", date: futureWeekday(8), time: "2:00 PM",
  type: "regular", name: "Agent Client", phone: "(905) 555-0308", email: "agentclient@test.example", first: "yes",
}, over || {});
function emailsTo(email) {
  return sentEmails.filter((e) => e.body.includes(email));
}
function lastEmailTo(email) {
  const all = emailsTo(email);
  return all.length ? all[all.length - 1].body : "";
}
// The last email to someone whose SUBJECT contains a fragment — the
// studio notification also carries the client's address in its body, so
// a plain lastEmailTo can return the studio copy instead of the client's.
function lastEmailToWithSubject(email, subjectPart) {
  const all = sentEmails.filter((e) => e.body.includes(email) && e.body.includes(subjectPart));
  return all.length ? all[all.length - 1].body : "";
}
async function mintGift(code, cents) {
  const rec = {
    code, kind: "gift", balanceCents: cents, originalCents: cents,
    buyerName: "Test", buyerEmail: "test@test.example",
    recipientName: "Test", recipientEmail: "test@test.example",
    holderName: "Test", holderEmail: "test@test.example",
    message: "", voucherFor: null, voucherLabel: "", suggestedUseBy: null,
    uses: [], status: "active", createdAt: new Date().toISOString(),
    expiresAt: null, checkoutSessionId: null,
  };
  await kvSet(`gift:${code}`, rec);
  const all = (await kvGet("gift:all")) || [];
  if (!all.includes(code)) { all.push(code); await kvSet("gift:all", all); }
  return rec;
}
async function consultCreditsFor(email, phone) {
  const em = String(email || "").trim().toLowerCase();
  const ph = String(phone || "").replace(/[^0-9]/g, "");
  return (await B.listGifts()).filter((g) => g.kind === "consult-credit"
    && ((em && String(g.holderEmail || "").trim().toLowerCase() === em)
      || (ph && String(g.holderPhone || "").replace(/[^0-9]/g, "") === ph)));
}

async function run() {
  // ---------- 1. pricing core ----------
  const svc = sched.findService("consultation");
  assert.ok(svc, "consultation is in the pricing core");
  assert.equal(svc.mins, 20, "consult is 20 minutes");
  assert.equal(svc.priceNum, 30, "consult is $30");
  assert.equal(sched.countsTowardCap("consultation"), false, "consult never counts toward the 4-a-day cap");
  assert.equal(sched.countsTowardCap("classic-facial"), true, "treatments still count toward the cap");
  assert.equal(sched.baseCentsFor("consultation", [], "after"), 3000, "after-hours consult is $30 flat — no $15 premium");
  assert.equal(sched.baseCentsFor("classic-facial", [], "after"), 10000, "after-hours facial still carries the premium");

  // ---------- 2. Meet link (studio setting) ----------
  await assert.rejects(studio.setMeetLink("not-a-link"), /doesn't look like a Google Meet link/, "a non-Meet link is refused");
  assert.equal(await studio.setMeetLink("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij", "a Meet link saves");
  assert.equal(await studio.getMeetLink(), "https://meet.google.com/abc-defg-hij", "the Meet link reads back");
  assert.equal(await studio.setMeetLink(""), "", "clearing the Meet link works");
  await studio.setMeetLink("https://meet.google.com/abc-defg-hij");
  let res = await callAdmin({ view: "settings", action: "meet-link", link: "https://meet.google.com/xyz-abcd-efg" });
  assert.equal(res.statusCode, 200, "admin meet-link save -> 200");
  assert.equal(res.body.meetLink, "https://meet.google.com/xyz-abcd-efg", "admin meet-link round-trips");
  res = await callAdmin(null, { view: "settings" });
  assert.equal(res.body.meetLink, "https://meet.google.com/xyz-abcd-efg", "settings GET carries the Meet link");
  await studio.setMeetLink("https://meet.google.com/abc-defg-hij");

  // ---------- 3. web booking: $30 flat, checkout wording ----------
  res = await callBook(webBody({}));
  assert.equal(res.statusCode, 200, "web consult -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.ok(res.body.url, "web consult returns a checkout url");
  const pd = lastCheckoutArgs.line_items[0].price_data;
  assert.equal(pd.unit_amount, 3000, "web consult checkout is $30");
  assert.equal(pd.product_data.name, "Video Consultation — In2Skin", "checkout names the service plainly");
  assert.ok(pd.product_data.description.startsWith("Payment for Video Consultation · In2Skin, Bolton, Ontario"), "checkout description follows the pattern, got " + pd.product_data.description);
  assert.equal(lastCheckoutArgs.payment_intent_data.statement_descriptor, "IN2SKIN", "statement descriptor is IN2SKIN");

  // ---------- 4. buildBooking rules: no add-ons, no friend, no first-visit ----------
  await assert.rejects(
    B.buildBooking(consultBase({ addons: ["reflexology"] }), { bufferMins: 60, blocks: [], via: "web" }),
    /just the consultation/,
    "add-ons are refused on a consult",
  );
  await assert.rejects(
    B.buildBooking(consultBase({ forWhom: "friend", guestName: "Sam", guestPhone: "(905) 555-0399" }), { bufferMins: 60, blocks: [], via: "web" }),
    /for you/,
    "friend bookings are refused on a consult",
  );
  let b = await B.buildBooking(consultBase({ date: futureWeekday(11), first: "yes", name: "Rules Client", phone: "(905) 555-0311", email: "rules@test.example" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(b.amountCents, 3000, "first-visit offer never applies to a consult, got " + b.amountCents);
  assert.equal(b.minsLabel, "20 minutes", "consult is 20 minutes");
  assert.equal(b.firstVisitDiscountCents, 0, "no first-visit discount recorded");

  // ---------- 5. the cap: 4 treatments on a day, consults still fit ----------
  // Four 20-minute reflexology visits, hourly — each blocks 20 + 25
  // overrun, so hourly fits even with the buffer at 0 for the check.
  const dCap = futureWeekday(14);
  for (const [i, t] of ["10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM"].entries()) {
    const tb = await B.buildBooking({
      service: "reflexology", date: dCap, time: t, type: "regular",
      name: "Cap Client " + i, phone: "(905) 555-04" + i + "0", email: "cap" + i + "@test.example", first: "no",
    }, { bufferMins: 0, blocks: [], via: "web" });
    await B.saveBooking(tb);
  }
  const dayBookings = await B.listBookingsForDate(dCap);
  assert.equal(sched.dayIsFull(dayBookings), true, "4 treatments fills the day");
  b = await B.buildBooking({
    service: "consultation", date: dCap, time: "2:00 PM", type: "regular",
    name: "Gap Client", phone: "(905) 555-0450", email: "gapclient@test.example", first: "yes",
  }, { bufferMins: 0, blocks: [], via: "web" });
  assert.equal(b.amountCents, 3000, "consult books on a treatment-full day");
  res = mockRes();
  await availability(mockReq({ query: { date: dCap, service: "classic-facial", type: "regular" } }), res);
  assert.deepEqual(res.body.times, [], "treatments see no times on a full day");
  res = mockRes();
  await availability(mockReq({ query: { date: dCap, service: "consultation", type: "regular" } }), res);
  assert.ok(res.body.times.includes("3:00 PM"), "consults still see the gaps, got " + JSON.stringify(res.body.times));
  res = mockRes();
  await availability(mockReq({ query: { from: dCap, to: dCap, service: "consultation" } }), res);
  assert.ok(res.body.dates[dCap].regular.free > 0, "range shows free consult slots on a full treatment day");
  res = mockRes();
  await availability(mockReq({ query: { from: dCap, to: dCap, service: "classic-facial" } }), res);
  assert.equal(res.body.dates[dCap].regular.free, 0, "range shows no free treatment slots on a full day");

  // ---------- 6. agent hold: same $30, same checkout wording ----------
  res = await callBook(agentBody({}), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 200, "agent consult hold -> 200, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.hold, true, "agent hold returns hold:true");
  assert.equal(res.body.amountCents, 3000, "agent consult hold is $30");
  assert.equal(lastCheckoutArgs.line_items[0].price_data.product_data.name, "Video Consultation — In2Skin", "agent checkout names the service");
  assert.equal(lastCheckoutArgs.payment_intent_data.statement_descriptor, "IN2SKIN", "agent checkout descriptor is IN2SKIN");
  res = await callBook(agentBody({ first: "yes" }), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 400, "second agent hold for the same client -> 400 (first-time-only backstop)");
  assert.match(res.body.error, /already had your consultation/, "agent repeat is refused with the plain wording");
  await assert.rejects(
    B.buildBooking(agentBody({ name: "Another Client", phone: "(905) 555-0309", email: "another@test.example" }), { bufferMins: 60, blocks: [], via: "agent" }),
    /just taken/,
    "a fresh client sees the held slot as taken",
  );
  res = await callBook(agentBody({ date: futureWeekday(17), addons: ["reflexology"] }), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 400, "agent consult with add-ons -> 400");
  res = await callBook(agentBody({ date: futureWeekday(17), email: "" }), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 400, "agent consult without email -> 400 (the link goes there)");

  // ---------- 7. first-time block: both formats, every path ----------
  const bClient = { name: "Been Before", phone: "(905) 555-0700", email: "beenbefore@test.example" };
  const bTreat = await B.buildBooking({
    service: "classic-facial", date: futureWeekday(20), time: "10:00 AM", type: "regular",
    name: bClient.name, phone: bClient.phone, email: bClient.email, first: "no",
  }, { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(bTreat);
  res = await callBook(webBody({ name: bClient.name, phone: bClient.phone, email: bClient.email, date: futureWeekday(21) }));
  assert.equal(res.statusCode, 400, "returning client, web video consult -> 400");
  assert.match(res.body.error, /already had your consultation/, "plain wording on the web block");
  res = await callBook(webBody({ format: "in-person", email: "", name: bClient.name, phone: bClient.phone, date: futureWeekday(21) }));
  assert.equal(res.statusCode, 400, "returning client, web in-person consult -> 400");
  res = await callBook(agentBody({ name: bClient.name, phone: bClient.phone, email: bClient.email, date: futureWeekday(21) }), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 400, "returning client, agent video consult -> 400");
  res = await callBook(agentBody({ format: "in-person", name: bClient.name, phone: bClient.phone, email: bClient.email, date: futureWeekday(21) }), { "x-agent-key": "test-agent-key" });
  assert.equal(res.statusCode, 400, "returning client, agent in-person consult -> 400");
  res = await callBook({ consultRequest: true, service: "consultation", format: "video", date: futureWeekday(22), time: "6:00 PM", name: bClient.name, phone: bClient.phone, email: bClient.email, website: "", formLoadedAt: String(Date.now() - 10000) });
  assert.equal(res.statusCode, 400, "returning client, consult request -> 400");
  res = await callBook(webBody({ name: "Different Name", phone: bClient.phone, email: "other@test.example", date: futureWeekday(21) }));
  assert.equal(res.statusCode, 400, "same phone, different email -> still blocked");
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "video", date: futureWeekday(21), time: "2:00 PM", type: "regular", name: bClient.name, phone: bClient.phone, email: bClient.email, first: "no", payment: "no-charge" });
  assert.equal(res.statusCode, 200, "admin walk-in bypasses the first-time block, got " + res.statusCode + " " + JSON.stringify(res.body));
  assert.equal(res.body.booking.format, "video", "walk-in stores the format");

  // ---------- 8. after-hours requests: video + in person ----------
  const reqClient = { name: "Request Client", phone: "(905) 555-0800", email: "request@test.example" };
  res = await callBook({ consultRequest: true, service: "consultation", format: "video", date: futureWeekday(23), time: "6:00 PM", name: reqClient.name, phone: reqClient.phone, email: reqClient.email, website: "", formLoadedAt: String(Date.now() - 10000) });
  assert.equal(res.statusCode, 200, "video consult request -> 200, got " + JSON.stringify(res.body));
  assert.equal(res.body.format, "video", "request stores the format");
  const reqId = res.body.requestId;
  res = await callAdmin({ view: "consult-requests", action: "accept", id: reqId });
  assert.equal(res.statusCode, 200, "accept -> 200, got " + JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "unpaid", "accepted request is an unpaid booking (no 30-min hold)");
  assert.equal(res.body.booking.amountCents, 3000, "accepted request is $30");
  assert.equal(res.body.booking.format, "video", "accepted booking keeps the format");
  assert.equal(res.body.booking.serviceName, "Video Consultation", "accepted booking names the format");
  assert.ok(res.body.payUrl.includes("/pay?id=pl_"), "accept emails a card pay link, got " + res.body.payUrl);
  const acceptEmail = lastEmailTo(reqClient.email);
  assert.ok(acceptEmail.includes("Sarah said yes"), "accept email says yes");
  assert.ok(acceptEmail.includes("video link arrives by email"), "video accept email says the link comes after payment");
  assert.ok(!acceptEmail.includes("meet.google.com"), "video accept email has no link yet — it comes with the confirmation after payment");
  res = await callAdmin({ view: "consult-requests", action: "accept", id: reqId });
  assert.equal(res.statusCode, 400, "accept twice -> 400");
  res = await callBook({ consultRequest: true, service: "consultation", format: "video", date: futureWeekday(26), time: "6:00 PM", name: "Decline Client", phone: "(905) 555-0801", email: "decline@test.example", website: "", formLoadedAt: String(Date.now() - 10000) });
  assert.equal(res.statusCode, 200, "second request -> 200");
  res = await callAdmin({ view: "consult-requests", action: "decline", id: res.body.requestId });
  assert.equal(res.statusCode, 200, "decline -> 200");
  assert.ok(lastEmailTo("decline@test.example").includes("can't do"), "decline email tells the client plainly");
  res = await callBook({ consultRequest: true, service: "consultation", format: "in-person", date: futureWeekday(27), time: "6:00 PM", name: "In Person Request", phone: "(905) 555-0802", email: "inpersonreq@test.example", website: "", formLoadedAt: String(Date.now() - 10000) });
  assert.equal(res.statusCode, 200, "in-person consult request -> 200");
  res = await callAdmin({ view: "consult-requests", action: "accept", id: res.body.requestId });
  assert.equal(res.statusCode, 200, "accept in-person request -> 200");
  assert.equal(res.body.booking.format, "in-person", "in-person request books in person");
  assert.equal(res.body.booking.serviceName, "In-Person Consultation", "in-person booking names the format");
  const inPersonAcceptEmail = lastEmailTo("inpersonreq@test.example");
  assert.ok(!inPersonAcceptEmail.includes("meet.google.com"), "in-person accept email has no video link");
  assert.ok(inPersonAcceptEmail.includes("See you at the studio"), "in-person accept email says where to go");

  // ---------- 9. credit flow: issued on completion, both formats ----------
  const eClient = { name: "Credit Client", phone: "(905) 555-0900", email: "credit@test.example" };
  let eConsult = await B.buildBooking(consultBase({ name: eClient.name, phone: eClient.phone, email: eClient.email, date: futureWeekday(29) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(eConsult);
  eConsult.status = "paid";
  eConsult.amountPaidCents = 3000;
  await B.saveBooking(eConsult);
  await B.markBookingOutcome(eConsult, "complete");
  let eCredits = await consultCreditsFor(eClient.email, eClient.phone);
  assert.equal(eCredits.length, 1, "one credit after a completed video consult");
  assert.equal(eCredits[0].balanceCents, 3000, "credit is $30");
  assert.equal(eCredits[0].expiresAt, null, "credit never expires");
  const eCode = eCredits[0].code;
  assert.ok(lastEmailTo(eClient.email).includes(eCode), "the credit code is emailed to the client");
  eConsult = await B.getBooking(eConsult.id);
  await B.markBookingOutcome(eConsult, "complete");
  eCredits = await consultCreditsFor(eClient.email, eClient.phone);
  assert.equal(eCredits.length, 1, "no second credit on repeat completion");
  assert.equal(eCredits[0].code, eCode, "the same code, not a new one");
  const nClient = { name: "No Show", phone: "(905) 555-0901", email: "noshow@test.example" };
  let nConsult = await B.buildBooking(consultBase({ name: nClient.name, phone: nClient.phone, email: nClient.email, date: futureWeekday(32) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(nConsult);
  nConsult.status = "paid";
  nConsult.amountPaidCents = 3000;
  await B.saveBooking(nConsult);
  await B.markBookingOutcome(nConsult, "no-show");
  assert.equal((await consultCreditsFor(nClient.email, nClient.phone)).length, 0, "a no-show earns no credit — Sarah keeps the $30");
  await mintGift("IN2SKIN-GIFT30", 3000);
  const gClient = { name: "Gift Client", phone: "(905) 555-0902", email: "giftclient@test.example" };
  let gConsult = await B.buildBooking(consultBase({ name: gClient.name, phone: gClient.phone, email: gClient.email, date: futureWeekday(35), giftCode: "IN2SKIN-GIFT30" }), { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(gConsult.amountCents, 0, "gift covers the consult in full");
  await B.saveBooking(gConsult);
  gConsult.status = "paid";
  gConsult.amountPaidCents = 0;
  await B.saveBooking(gConsult);
  await B.markBookingOutcome(gConsult, "complete");
  assert.equal((await consultCreditsFor(gClient.email, gClient.phone)).length, 0, "a gift-covered consult earns no new credit");
  await assert.rejects(
    B.buildBooking(consultBase({ name: "Second Consult", phone: "(905) 555-0903", email: "second@test.example", date: futureWeekday(36), giftCode: eCode }), { bufferMins: 60, blocks: [], via: "web" }),
    /can't pay for another consultation/,
    "consult-credit on a consult is refused",
  );
  const fClient = { name: "Face Client", phone: "(905) 555-0904", email: "face@test.example" };
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "in-person", date: futureWeekday(37), time: "2:00 PM", type: "regular", name: fClient.name, phone: fClient.phone, email: fClient.email, first: "no", payment: "cash" });
  assert.equal(res.statusCode, 200, "in-person walk-in -> 200");
  assert.equal(res.body.booking.serviceName, "In-Person Consultation", "walk-in names the format");
  let fConsult = await B.getBooking(res.body.booking.id);
  await B.markBookingOutcome(fConsult, "complete");
  const fCredits = await consultCreditsFor(fClient.email, fClient.phone);
  assert.equal(fCredits.length, 1, "one credit after a completed in-person consult");
  assert.ok(lastEmailTo(fClient.email).includes("In-Person Consultation is done"), "the credit email names the format");

  // ---------- 10. clawbacks + the visible credit line ----------
  const c1 = { name: "Cancel Early", phone: "(905) 555-1000", email: "cancelearly@test.example" };
  let c1b = await B.buildBooking(consultBase({ name: c1.name, phone: c1.phone, email: c1.email, date: futureWeekday(41) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(c1b);
  c1b.status = "paid";
  c1b.amountPaidCents = 3000;
  await B.saveBooking(c1b);
  await B.cancelBooking(c1b, "changed my mind");
  assert.ok(lastEmailTo(c1.email).includes("will be refunded to your card"), "cancel 24h+ out: refund wording");
  const c2 = { name: "Cancel Late", phone: "(905) 555-1001", email: "cancellate@test.example" };
  let c2b = await B.buildBooking(consultBase({ name: c2.name, phone: c2.phone, email: c2.email, date: futureWeekday(42) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(c2b);
  c2b.status = "paid";
  c2b.amountPaidCents = 3000;
  c2b.date = transfer.torontoDateKey();
  c2b.time = fmtMins(transfer.torontoNow().mins + 120);
  await B.saveBooking(c2b);
  await B.cancelBooking(c2b, "something came up");
  assert.ok(lastEmailTo(c2.email).includes("call Sarah"), "cancel under 24h: client is told to call Sarah about the $30");
  // the treatment that uses the credit SHOWS it — confirmation + dashboard
  let treat = await B.buildBooking({
    service: "classic-facial", date: futureWeekday(47), time: "10:00 AM", type: "regular",
    name: eClient.name, phone: eClient.phone, email: eClient.email, first: "yes", giftCode: eCode,
  }, { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(treat.amountCents, 4500, "Classic $85 − $10 first visit − $30 credit = $45, got " + treat.amountCents);
  assert.equal(treat.giftKind, "consult-credit", "the booking records the credit kind");
  assert.equal(treat.giftAppliedCents, 3000, "the booking records the $30 applied");
  await B.saveBooking(treat);
  await B.createBookingCheckout(treat);
  assert.ok(lastCheckoutArgs.line_items[0].price_data.product_data.description.includes("consultation credit"), "checkout names the consultation credit");
  treat.status = "paid";
  treat.amountPaidCents = 4500;
  await B.saveBooking(treat);
  await B.finalizePaidBooking(treat);
  const treatEmail = lastEmailToWithSubject(eClient.email, "Your In2Skin booking is confirmed");
  assert.ok(treatEmail.includes("$30 consultation credit applied"), "confirmation email shows the $30 credit applied");
  assert.ok(treatEmail.includes("(includes $30 consultation credit)"), "confirmation email Paid line names the credit");
  retrieveMetadata = { bookingId: treat.id };
  const getRes = mockRes();
  await book(mockReq({ method: "GET", query: { session_id: "cs_test_1" } }), getRes);
  assert.equal(getRes.statusCode, 200, "booking-status GET -> 200");
  assert.equal(getRes.body.paid, true, "booking-status says paid");
  assert.equal(getRes.body.booking.giftKind, "consult-credit", "booking-status carries the credit kind");
  assert.equal(getRes.body.booking.giftAppliedCents, 3000, "booking-status carries the $30 applied");
  res = await callAdmin(null, { from: futureWeekday(47), to: futureWeekday(47) });
  const dashTreat = (res.body.bookings || []).find((x) => x.id === treat.id);
  assert.ok(dashTreat, "dashboard lists the treatment booking");
  assert.equal(dashTreat.giftKind, "consult-credit", "dashboard data carries the credit kind");
  assert.equal(dashTreat.giftAppliedCents, 3000, "dashboard data carries the $30 applied");
  treat = await B.getBooking(treat.id);
  await B.cancelBooking(treat, "changed my mind");
  eCredits = await consultCreditsFor(eClient.email, eClient.phone);
  assert.equal(eCredits[0].balanceCents, 0, "the credit stays used after the treatment is cancelled");
  assert.ok(lastEmailTo(eClient.email).includes("stays used"), "cancel email says the credit stays used");
  await mintGift("IN2SKIN-PLAIN50", 5000);
  let pTreat = await B.buildBooking({
    service: "classic-facial", date: futureWeekday(50), time: "10:00 AM", type: "regular",
    name: "Plain Gift", phone: "(905) 555-1002", email: "plaingift@test.example", first: "no", giftCode: "IN2SKIN-PLAIN50",
  }, { bufferMins: 60, blocks: [], via: "web" });
  assert.equal(pTreat.giftKind, "gift", "a plain gift records its kind");
  await B.saveBooking(pTreat);
  pTreat.status = "paid";
  pTreat.amountPaidCents = pTreat.amountCents;
  await B.saveBooking(pTreat);
  await B.finalizePaidBooking(pTreat);
  pTreat = await B.getBooking(pTreat.id);
  await B.cancelBooking(pTreat, "changed my mind");
  assert.equal((await B.getGift("IN2SKIN-PLAIN50")).balanceCents, 5000, "a plain gift balance comes back on cancel");
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "video", date: futureWeekday(53), time: "2:00 PM", type: "regular", name: eClient.name, phone: eClient.phone, email: eClient.email, first: "no", payment: "cash" });
  assert.equal(res.statusCode, 200, "second walk-in consult -> 200 (Sarah's call)");
  let e2 = await B.getBooking(res.body.booking.id);
  await B.markBookingOutcome(e2, "complete");
  eCredits = await consultCreditsFor(eClient.email, eClient.phone);
  assert.equal(eCredits.length, 1, "still exactly one credit — no second credit, ever");

  // ---------- 11. the 1-hour reminder: video gets the link, in person gets the studio ----------
  const todayKey = transfer.torontoDateKey();
  const nowMins = transfer.torontoNow().mins;
  const rClient = { name: "Reminder Client", phone: "(905) 555-1100", email: "reminder@test.example" };
  let rConsult = await B.buildBooking(consultBase({ name: rClient.name, phone: rClient.phone, email: rClient.email, date: futureWeekday(54) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(rConsult);
  rConsult.status = "paid";
  rConsult.amountPaidCents = 3000;
  rConsult.date = todayKey;
  rConsult.time = fmtMins(nowMins + 30);
  await B.saveBooking(rConsult);
  const beforeCount = emailsTo(rClient.email).length;
  await B.sendDueConsultReminders();
  let rEmails = emailsTo(rClient.email);
  assert.equal(rEmails.length, beforeCount + 1, "one reminder goes out for a consult in 30 minutes");
  assert.ok(rEmails[rEmails.length - 1].body.includes("https://meet.google.com/abc-defg-hij"), "video reminder carries the Meet link");
  assert.ok(rEmails[rEmails.length - 1].body.includes("in an hour"), "reminder says it is in an hour");
  rConsult = await B.getBooking(rConsult.id);
  assert.ok(rConsult.reminderSentAt, "reminderSentAt is set so it never sends twice");
  await B.sendDueConsultReminders();
  assert.equal(emailsTo(rClient.email).length, beforeCount + 1, "the second sweep sends nothing");
  const r2 = await B.buildBooking(consultBase({ name: "Far Client", phone: "(905) 555-1101", email: "far@test.example", date: futureWeekday(55) }), { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(r2);
  r2.status = "paid";
  r2.amountPaidCents = 3000;
  r2.date = todayKey;
  r2.time = fmtMins(nowMins + 120);
  await B.saveBooking(r2);
  const t2 = await B.buildBooking({ service: "classic-facial", date: futureWeekday(55), time: "10:00 AM", type: "regular", name: "Treatment Client", phone: "(905) 555-1102", email: "treatment@test.example", first: "no" }, { bufferMins: 60, blocks: [], via: "web" });
  await B.saveBooking(t2);
  t2.status = "paid";
  t2.amountPaidCents = t2.amountCents;
  t2.date = todayKey;
  t2.time = fmtMins(nowMins + 30);
  await B.saveBooking(t2);
  await B.sendDueConsultReminders();
  assert.equal(emailsTo("far@test.example").length, 0, "a consult 2 hours out gets no reminder yet");
  assert.equal(emailsTo("treatment@test.example").length, 0, "a treatment gets no consult reminder");
  const ipClient = { name: "In Person Reminder", phone: "(905) 555-1103", email: "inpersonrem@test.example" };
  let ipConsult = await B.buildBooking(consultBase({ format: "in-person", name: ipClient.name, phone: ipClient.phone, email: ipClient.email, date: futureWeekday(56) }), { bufferMins: 60, blocks: [], via: "admin" });
  await B.saveBooking(ipConsult);
  ipConsult.status = "paid";
  ipConsult.amountPaidCents = 3000;
  ipConsult.date = todayKey;
  ipConsult.time = fmtMins(nowMins + 30);
  await B.saveBooking(ipConsult);
  await B.sendDueConsultReminders();
  const ipEmails = emailsTo(ipClient.email);
  assert.equal(ipEmails.length, 1, "one reminder for the in-person consult");
  assert.ok(!ipEmails[0].body.includes("meet.google.com"), "in-person reminder has no video link");
  assert.ok(ipEmails[0].body.includes("See you at the studio"), "in-person reminder says where to go");

  // ---------- 12. walk-in no-charge: Tony's free VIDEO test pass ----------
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "video", date: futureWeekday(58), time: "2:00 PM", type: "regular", name: "Tony", phone: "(416) 902-6122", email: "tony@test.example", first: "no", payment: "no-charge" });
  assert.equal(res.statusCode, 200, "Tony's free test consult books -> 200, got " + JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "paid", "no-charge consult is paid in full");
  assert.equal(res.body.booking.amountCents, 0, "no-charge consult is $0");
  assert.equal(res.body.booking.format, "video", "Tony's test pass is a video consult");
  const tonyEmail = lastEmailTo("tony@test.example");
  assert.ok(tonyEmail.includes("https://meet.google.com/abc-defg-hij"), "Tony's confirmation carries the Meet link");
  assert.ok(tonyEmail.includes("Your video call"), "Tony's confirmation names the video call");
  let tonyBooking = await B.getBooking(res.body.booking.id);
  await B.markBookingOutcome(tonyBooking, "complete");
  assert.equal((await consultCreditsFor("tony@test.example", "(416) 902-6122")).length, 0, "a free consult earns no credit — nothing was paid");
  // in-person walk-in, pay later — confirmation says pay at the studio, no link
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "in-person", date: futureWeekday(59), time: "2:00 PM", type: "regular", name: "Walk In Person", phone: "(905) 555-1200", email: "walkin@test.example", first: "no", payment: "later" });
  assert.equal(res.statusCode, 200, "in-person walk-in -> 200, got " + JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "unpaid", "pay-later walk-in is unpaid until the visit");
  const walkInEmail = lastEmailToWithSubject("walkin@test.example", "Your In2Skin booking — In-Person Consultation");
  assert.ok(walkInEmail.includes("Amount due at your visit"), "in-person walk-in confirmation says pay at the visit");
  assert.ok(walkInEmail.includes("Pay at the studio"), "in-person walk-in confirmation names the studio payment");
  assert.ok(!walkInEmail.includes("meet.google.com"), "in-person walk-in confirmation has no video link");
  // and the same booking works with no email at all (email is optional in person)
  res = await callAdmin({ view: "bookings", action: "walk-in", service: "consultation", format: "in-person", date: futureWeekday(59), time: "4:00 PM", type: "regular", name: "No Email Person", phone: "(905) 555-1201", email: "", first: "no", payment: "later" });
  assert.equal(res.statusCode, 200, "in-person walk-in without email -> 200, got " + JSON.stringify(res.body));
  assert.equal(res.body.booking.status, "unpaid", "no-email walk-in is unpaid until the visit");

  console.log("video-consult tests: passed (parts 1 + 2)");
}

run().catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
