// node tests/slots.test.js — start times every 30 min, 9:00–4:00; booking blocks start..start+visit+60 (hidden reset)
const assert = require("assert");
const S = require("../js/slots.js");
const labels = r => r.starts.map(x => x.label);
let n = 0; const t = (name, fn) => { fn(); n++; console.log("PASS", name); };
t("empty day: 9:00..4:00 every 30 min (15 starts)", () => { const l = labels(S.slotsForDay([], 60)); assert.strictEqual(l.length, 15); assert.strictEqual(l[0], "9:00 AM"); assert.strictEqual(l[1], "9:30 AM"); assert.strictEqual(l[14], "4:00 PM"); });
t("4 PM start allowed for a long visit", () => assert(labels(S.slotsForDay([], 120)).includes("4:00 PM")));
t("nothing after 4:00 PM", () => assert(S.slotsForDay([], 20).starts.every(x => x.min <= 960)));
t("55 min at 10:00 blocks until 11:55; 12:00 is next", () => {
  const l = labels(S.slotsForDay([{ start: 600, mins: 55 }], 30));
  assert(!l.includes("10:00 AM") && !l.includes("11:30 AM") && !l.includes("11:00 AM") && l.includes("12:00 PM") && !l.includes("11:30 AM"));
});
t("30 min at 10:00 frees 11:30", () => { const l = labels(S.slotsForDay([{ start: 600, mins: 30 }], 30)); assert(!l.includes("11:00 AM") && l.includes("11:30 AM")); });
t("1h at 10: 10:00..11:30 gone, 12:00 free", () => { const l = labels(S.slotsForDay([{ start: 600, mins: 60 }], 30)); assert(!l.includes("10:00 AM") && !l.includes("11:30 AM") && l.includes("12:00 PM")); });
t("2h at 1 PM: 1:00..3:30 gone, 4:00 free", () => { const l = labels(S.slotsForDay([{ start: 780, mins: 120 }], 30)); assert(!l.includes("1:00 PM") && !l.includes("2:30 PM") && !l.includes("3:30 PM") && l.includes("4:00 PM")); });
t("1h35 at 11 AM blocked by a 1 PM booking", () => assert(!labels(S.slotsForDay([{ start: 780, mins: 60 }], 95)).includes("11:00 AM")));
t("1h35 visit: 10:00 AM ends 12:35 incl. reset, fits before 1 PM", () => assert(labels(S.slotsForDay([{ start: 780, mins: 60 }], 95)).includes("10:00 AM")));
t("55-min visit: 11:00 fits before a 1 PM booking (ends 12:55 with reset), 11:30 does not", () => { const l = labels(S.slotsForDay([{ start: 780, mins: 60 }], 55)); assert(l.includes("11:00 AM") && !l.includes("11:30 AM")); });
console.log(n + " slot tests passed");
