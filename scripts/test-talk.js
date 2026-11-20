// Unit tests for the dashboard Talk parser (pure part of admin/dashboard.html).
// Run: node scripts/test-talk.js
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "admin", "dashboard.html"), "utf8");
const m = html.match(/\/\/ talk-pure-BEGIN[^\n]*\n([\s\S]*?)\/\/ talk-pure-END/);
if (!m) { console.error("talk-pure block not found"); process.exit(1); }
const fns = new Function(m[1] + "\nreturn { parseTalk, talkWordsToNumber, talkParseDay, talkParseTimes, talkParseName, talkFindService, talkFindAmount, talkFindPhone, talkFindEmail, talkFindGiftCode, talkParseDateRange, talkTimeLabel };")();
const { parseTalk, talkWordsToNumber, talkParseDay, talkParseTimes, talkParseName, talkFindService, talkFindAmount, talkFindPhone, talkFindEmail, talkFindGiftCode, talkParseDateRange, talkTimeLabel } = fns;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log("FAIL:", label, "\n  got:     ", a, "\n  expected:", e); }
}
function fillsOf(r) { const o = {}; (r.fills || []).forEach((f) => { o[f.id] = f.check !== undefined ? f.check : f.value; }); return o; }

// Thursday 2026-11-19 is the base day for these cases.
const TODAY = "2026-11-19";

// --- word numbers ---
eq(talkWordsToNumber("eighty-five"), { value: 85, count: 2 }, "words eighty-five");
eq(talkWordsToNumber("one hundred twenty five"), { value: 125, count: 4 }, "words one hundred twenty five");
eq(talkWordsToNumber("one twenty five"), { value: 125, count: 3 }, "words one twenty five");
eq(talkWordsToNumber("sixty five"), { value: 65, count: 2 }, "words sixty five");
eq(talkFindAmount("pay link 65 dollars for alex"), 65, "amount digits");
eq(talkFindAmount("pay link eighty-five dollars for alex"), 85, "amount words");
eq(talkFindAmount("pay 125 for classic facial"), 125, "amount 125");

// --- days ---
eq(talkParseDay("tomorrow", TODAY), "2026-11-20", "day tomorrow");
eq(talkParseDay("today", TODAY), "2026-11-19", "day today");
eq(talkParseDay("friday", TODAY), "2026-11-20", "day friday");
eq(talkParseDay("next friday", TODAY), "2026-11-27", "day next friday");
eq(talkParseDay("november 20", TODAY), "2026-11-20", "day november 20");

// --- times ---
eq(talkParseTimes("2 to 5"), ["14:00", "17:00"], "times 2 to 5");
eq(talkParseTimes("at 2:30 pm"), ["14:30"], "times 2:30 pm");
eq(talkParseTimes("november 20 at 2"), ["14:00"], "times skips month day");
eq(talkParseTimes("9 to 12"), ["09:00", "12:00"], "times 9 to 12");
eq(talkParseTimes("7 to 9"), ["07:00", "09:00"], "times 7 to 9");
eq(talkParseTimes("6 to 9"), ["18:00", "21:00"], "times 6 to 9 bumps end to pm");

// --- names + services ---
eq(talkParseName("pay link 65 dollars for alex taylor"), "Alex Taylor", "name for alex taylor");
eq(talkParseName("book alex at 10"), "Alex", "name book alex");
eq(talkParseName("book a walk-in"), null, "name book a walk-in is null");
eq(talkFindService("pay 125 for classic facial"), "Classic Facial", "service classic");
eq(talkFindService("book microneedling tomorrow"), "Microneedling / NANO Needling", "service microneedling hears the combined needling name");

// --- full commands ---
let r = parseTalk("pay link 65 dollars for alex taylor", TODAY);
eq(r.ok, true, "pay ok");
eq(r.jump, "sec-spot", "pay jump");
eq(fillsOf(r), { spAmount: "65", spName: "Alex Taylor" }, "pay fills");

r = parseTalk("pay link eighty-five dollars for alex", TODAY);
eq(fillsOf(r), { spAmount: "85", spName: "Alex" }, "pay words fills");

r = parseTalk("pay 125 for classic facial", TODAY);
eq(fillsOf(r), { spAmount: "125", spLabel: "Classic Facial" }, "pay service fills");

r = parseTalk("block off tomorrow 2 to 5", TODAY);
eq(r.ok, true, "block ok");
eq(r.jump, "sec-settings", "block jump");
eq(fillsOf(r), { blkDate: "2026-11-20", blkStart: "14:00", blkEnd: "17:00" }, "block fills");

r = parseTalk("block off friday 9 to 12", TODAY);
eq(fillsOf(r), { blkDate: "2026-11-20", blkStart: "09:00", blkEnd: "12:00" }, "block friday fills");

r = parseTalk("book alex taylor tomorrow at 2 pm", TODAY);
eq(r.ok, true, "book ok");
eq(r.jump, "sec-walkin", "book jump");
eq(fillsOf(r), { wkName: "Alex Taylor", wkDate: "2026-11-20", wkTime: "14:00" }, "book fills");

r = parseTalk("book alex at 10", TODAY);
eq(fillsOf(r), { wkName: "Alex", wkTime: "10:00" }, "book short fills");

r = parseTalk("go to calendar", TODAY);
eq(r.ok, true, "jump ok");
eq(r.jump, "sec-calendar", "jump calendar");

r = parseTalk("show me the calendar", TODAY);
eq(r.ok, true, "jump show me the calendar");
eq(r.jump, "sec-calendar", "jump show me calendar target");

r = parseTalk("go to the referrals section", TODAY);
eq(r.ok, true, "jump go to the referrals section");
eq(r.jump, "sec-referrals", "jump referrals section target");

r = parseTalk("take me to payments", TODAY);
eq(r.ok, true, "jump take me to payments");
eq(r.jump, "sec-payments", "jump payments target");

r = parseTalk("open settings", TODAY);
eq(r.ok, true, "jump open settings");
eq(r.jump, "sec-settings", "jump settings target");

r = parseTalk("show me the bookings", TODAY);
eq(r.ok, true, "jump show me the bookings");
eq(r.jump, "sec-calendar", "jump bookings target");

r = parseTalk("go to the pay section", TODAY);
eq(r.ok, true, "jump go to the pay section");
eq(r.jump, "sec-spot", "jump pay section target");

// A longer "show me" phrase is a fill job, not a jump — the pay intent
// still fills the name and jumps to the Pay section itself.
r = parseTalk("show me the pay link for alex", TODAY);
eq(r.ok, true, "show me pay link is a fill");
eq(r.jump, "sec-spot", "show me pay link jump");
eq(fillsOf(r), { spName: "Alex" }, "show me pay link fills");

r = parseTalk("referral for alex taylor", TODAY);
eq(r.ok, true, "referral ok");
eq(fillsOf(r), { refName: "Alex Taylor" }, "referral fills");

r = parseTalk("pay link for alex", TODAY);
eq(r.ok, true, "pay name-only ok");
eq(fillsOf(r), { spName: "Alex" }, "pay name-only fills");

r = parseTalk("hello there", TODAY);
eq(r.ok, false, "gibberish not ok");

r = parseTalk("block off", TODAY);
eq(r.ok, false, "block with nothing not ok");

// --- phone / email / gift code (Talk expansion, Tony Nov 19) ---
eq(talkFindPhone("book alex nine oh five five five five oh one oh oh tomorrow at 2"), "(905) 555-0100", "phone digit words");
eq(talkFindPhone("call 905-555-0100"), "(905) 555-0100", "phone digits dashed");
eq(talkFindPhone("pay link 65 dollars for alex"), null, "phone amount is not a phone");
eq(talkFindPhone("book alex at 2"), null, "phone time is not a phone");
eq(talkFindEmail("book alex alex at example dot com tomorrow"), "alex@example.com", "email spoken");
eq(talkFindEmail("referral for alex alex@example.com"), "alex@example.com", "email typed");
eq(talkFindEmail("pay link 65 dollars for alex"), null, "email none");
eq(talkFindGiftCode("pay 65 for alex gift code in2skin abc123"), "IN2SKIN-ABC123", "gift code spoken");
eq(talkFindGiftCode("pay link 65 dollars for alex"), null, "gift code none");
eq(talkParseTimes("book alex 905-555-0100 tomorrow at 2"), ["14:00"], "times ignore phone digits");
eq(talkTimeLabel("14:00"), "2:00 PM", "time label 2pm");
eq(talkTimeLabel("10:00"), "10:00 AM", "time label 10am");
eq(talkTimeLabel("12:30"), "12:30 PM", "time label 12:30pm");

// --- date ranges ---
eq(talkParseDateRange("report from november 1 to november 15", TODAY), { from: "2026-11-01", to: "2026-11-15" }, "range nov 1-15");
eq(talkParseDateRange("report for this week", TODAY), { from: "2026-11-16", to: "2026-11-22" }, "range this week");
eq(talkParseDateRange("report for last week", TODAY), { from: "2026-11-09", to: "2026-11-15" }, "range last week");

// --- new intents ---
r = parseTalk("show payments for friday", TODAY);
eq(r.ok, true, "payments day ok");
eq(r.action, "payments", "payments action");
eq(r.day, "2026-11-20", "payments day");

r = parseTalk("show bookings for friday", TODAY);
eq(r.action, "calendar", "calendar action");
eq(r.day, "2026-11-20", "calendar day");

r = parseTalk("cancel alex taylor tomorrow", TODAY);
eq(r.action, "cancel", "cancel action");
eq(r.name, "Alex Taylor", "cancel name");
eq(r.day, "2026-11-20", "cancel day");

r = parseTalk("move alex to friday at 2", TODAY);
eq(r.action, "move", "move action");
eq(r.name, "Alex", "move name");
eq(r.day, "2026-11-20", "move day");
eq(r.time, "14:00", "move time");

r = parseTalk("mark alex complete", TODAY);
eq(r.action, "outcome", "outcome action");
eq(r.outcome, "complete", "outcome complete");
eq(r.name, "Alex", "outcome name");

r = parseTalk("alex didn't show", TODAY);
eq(r.action, "outcome", "outcome noshow action");
eq(r.outcome, "no-show", "outcome no-show");
eq(r.name, "Alex", "outcome noshow name");

r = parseTalk("record 65 dollars cash for alex", TODAY);
eq(r.action, "record-payment", "record action");
eq(r.amount, 65, "record amount");
eq(r.method, "cash", "record method");
eq(r.name, "Alex", "record name");

r = parseTalk("email alex saying thanks for coming today", TODAY);
eq(r.action, "email", "email action");
eq(r.name, "Alex", "email name");
eq(r.note, "thanks for coming today", "email note");

r = parseTalk("find alex taylor", TODAY);
eq(r.action, "find", "find action");
eq(r.name, "Alex Taylor", "find name");

r = parseTalk("set the gap to 90 minutes", TODAY);
eq(r.action, "gap", "gap action");
eq(r.minutes, 90, "gap minutes");

r = parseTalk("set the gap to 45 minutes", TODAY);
eq(r.ok, false, "gap invalid not ok");

r = parseTalk("pause transfers until 5", TODAY);
eq(r.action, "pause", "pause action");
eq(r.time, "17:00", "pause time");

r = parseTalk("calls go straight to me", TODAY);
eq(r.action, "mode", "mode action");
eq(r.mode, "direct", "mode direct");

r = parseTalk("report from november 1 to november 15", TODAY);
eq(r.action, "report", "report action");
eq(r.from, "2026-11-01", "report from");
eq(r.to, "2026-11-15", "report to");

r = parseTalk("block off the whole day tomorrow", TODAY);
eq(r.ok, true, "block whole day ok");
eq(fillsOf(r).blkDate, "2026-11-20", "block whole day date");
eq(fillsOf(r).blkAllDay, true, "block whole day check");

// walk-in extensions
r = parseTalk("book alex nine oh five five five five oh one oh oh tomorrow at 2 private hours paid cash", TODAY);
eq(fillsOf(r).wkPhone, "(905) 555-0100", "walkin phone fill");
eq(fillsOf(r).wkType, "after", "walkin private hours fill");
eq(fillsOf(r).wkPay, "cash", "walkin cash fill");

r = parseTalk("book alex alex at example dot com tomorrow at 2", TODAY);
eq(fillsOf(r).wkEmail, "alex@example.com", "walkin email fill");

r = parseTalk("referral for alex alex at example dot com", TODAY);
eq(fillsOf(r).refEmail, "alex@example.com", "referral email fill");

r = parseTalk("pay link 65 dollars for alex by text", TODAY);
eq(fillsOf(r).spMethod, "text", "pay method text fill");

console.log(`talk tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
