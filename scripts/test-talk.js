// Unit tests for the dashboard Talk parser (pure part of admin/dashboard.html).
// Run: node scripts/test-talk.js
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "admin", "dashboard.html"), "utf8");
const m = html.match(/\/\/ talk-pure-BEGIN[^\n]*\n([\s\S]*?)\/\/ talk-pure-END/);
if (!m) { console.error("talk-pure block not found"); process.exit(1); }
const fns = new Function(m[1] + "\nreturn { parseTalk, talkWordsToNumber, talkParseDay, talkParseTimes, talkParseName, talkFindService, talkFindAmount };")();
const { parseTalk, talkWordsToNumber, talkParseDay, talkParseTimes, talkParseName, talkFindService, talkFindAmount } = fns;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log("FAIL:", label, "\n  got:     ", a, "\n  expected:", e); }
}
function fillsOf(r) { const o = {}; (r.fills || []).forEach((f) => { o[f.id] = f.value; }); return o; }

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
eq(talkFindService("book microneedling tomorrow"), "Microneedling", "service microneedling");

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

console.log(`talk tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
