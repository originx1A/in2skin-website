// Schedule tests — A3 slot rule (handoff Nov 20, 2026; ported from
// prototype/js/slots.js): starts every 30 min, 9:00 AM–4:00 PM; every
// booking blocks start + visit length + hidden 60-min reset; max 4 a
// day, consultations included (A4). Run: node scripts/test-schedule.js
const {
  findService, parseTime, durationFor, durationForBooking, baseCentsFor,
  normalizeAddons, slotTaken, freeTimes, BUFFER_MINS, MIN_GAP_MINS,
  MAX_BOOKINGS_PER_DAY, countActiveBookings, dayIsFull,
  finishCheckDue, timesFor, countsTowardCap,
} = require("../lib/schedule");

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log("FAIL:", name, "got", got, "want", want); }
  return ok;
}
function taken(bookings, time, svcId) {
  return slotTaken(bookings, parseTime(time), durationFor(findService(svcId)));
}
function takenMins(bookings, time, mins) {
  return slotTaken(bookings, parseTime(time), mins);
}
function takenWithAddons(bookings, time, svcId, addonIds) {
  return slotTaken(bookings, parseTime(time), durationForBooking(svcId, addonIds));
}
const B = (time, svcId, date, addons, extra) => Object.assign(
  { time, date: date || "2026-11-20", service: svcId, status: "paid", addons: addons || [] },
  extra || {},
);

check("BUFFER_MINS is 60", BUFFER_MINS, 60);
check("MIN_GAP_MINS is 60", MIN_GAP_MINS, 60);
check("MAX_BOOKINGS_PER_DAY is 4", MAX_BOOKINGS_PER_DAY, 4);
// 2026-11-20 is a Friday; 2026-11-22 is a Sunday.
check("empty Friday has 15 regular slots (9:00-4:00 every 30 min)", freeTimes("2026-11-20", "regular", []).length, 15);
check("first regular slot is 9:00 AM", freeTimes("2026-11-20", "regular", [])[0], "9:00 AM");
check("last regular slot is 4:00 PM", freeTimes("2026-11-20", "regular", []).slice(-1)[0], "4:00 PM");
check("Sunday has no regular times", timesFor("2026-11-22", "regular").length, 0);
check("Sunday has no after-hours times either", timesFor("2026-11-22", "after").length, 0);
check("Sunday has no free times", freeTimes("2026-11-22", "regular", []).length, 0);
// A Classic at 10:00 runs 55 min + 60-min reset (blocked to 11:55),
// so 11:00 and 11:30 are blocked and 12:00 is the next free start.
check("Classic 10:00 booked -> 11:00 Classic blocked", taken([B("10:00 AM", "classic-facial")], "11:00 AM", "classic-facial"), true);
check("Classic 10:00 booked -> 11:30 Classic blocked", taken([B("10:00 AM", "classic-facial")], "11:30 AM", "classic-facial"), true);
check("Classic 10:00 booked -> 12:00 Classic free", taken([B("10:00 AM", "classic-facial")], "12:00 PM", "classic-facial"), false);
check("Anti-Aging 10:00 booked -> 12:00 blocked", taken([B("10:00 AM", "anti-aging-facial")], "12:00 PM", "classic-facial"), true);
check("Anti-Aging 10:00 booked -> 12:30 free (block ends 12:20)", taken([B("10:00 AM", "anti-aging-facial")], "12:30 PM", "classic-facial"), false);
check("Anti-Aging 10:00 booked -> 1:00 PM free", taken([B("10:00 AM", "anti-aging-facial")], "1:00 PM", "classic-facial"), false);
check("20-min add-on 10:00 -> 11:00 Classic blocked", taken([B("10:00 AM", "reflexology")], "11:00 AM", "classic-facial"), true);
check("20-min add-on 10:00 -> 11:30 Classic free", taken([B("10:00 AM", "reflexology")], "11:30 AM", "classic-facial"), false);
check("Classic 12:00 booked -> new 11:00 Classic blocked", taken([B("12:00 PM", "classic-facial")], "11:00 AM", "classic-facial"), true);
check("Chemical peel 10:00 -> 11:30 blocked", taken([B("10:00 AM", "chemical-peels")], "11:30 AM", "classic-facial"), true);
check("Chemical peel 10:00 -> 12:00 free", taken([B("10:00 AM", "chemical-peels")], "12:00 PM", "classic-facial"), false);
check("Chemical peel alone is 55 min", durationForBooking("chemical-peels", []), 55);
check("Private Classic 7:00 -> 7:45 blocked", taken([B("7:00 AM", "classic-facial")], "7:45 AM", "classic-facial"), true);
check("Private Classic 7:00 -> 8:30 blocked", taken([B("7:00 AM", "classic-facial")], "8:30 AM", "classic-facial"), true);
check("Private Classic 7:00 -> 10:00 free", taken([B("7:00 AM", "classic-facial")], "10:00 AM", "classic-facial"), false);
// 60-min-reset discriminator: Classic 10:00 is blocked until 11:55,
// so a 12:00 add-on is free and an 11:30 add-on is blocked.
check("Classic 10:00 -> 12:00 add-on free", taken([B("10:00 AM", "classic-facial")], "12:00 PM", "reflexology"), false);
check("Classic 10:00 -> 11:30 add-on blocked", taken([B("10:00 AM", "classic-facial")], "11:30 AM", "reflexology"), true);
// Add-on 10:00 ends 10:20 + 60 reset blocks until 11:20.
check("Add-on 10:00 -> 11:00 add-on blocked", taken([B("10:00 AM", "reflexology")], "11:00 AM", "reflexology"), true);
check("Add-on 10:00 -> 11:30 add-on free", taken([B("10:00 AM", "reflexology")], "11:30 AM", "reflexology"), false);

// Booking add-ons (Tony Nov 17, 2026): treatment + each add-on's own
// length, reset wraps the whole appointment, premium once per visit.
check("Classic + Light is 75 min", durationForBooking("classic-facial", ["light-therapy"]), 75);
check("Classic + 2 add-ons is 95 min", durationForBooking("classic-facial", ["light-therapy", "reflexology"]), 95);
check("Microneedling + Light is 40 min (20 + 20)", durationForBooking("microneedling", ["light-therapy"]), 40);
check("Classic + Microdermabrasion is 75 min (55 + 20)", durationForBooking("classic-facial", ["microdermabrasion"]), 75);
check("Classic + Micro + Light is 95 min (55 + 20 + 20)", durationForBooking("classic-facial", ["microdermabrasion", "light-therapy"]), 95);
check("Classic + Light regular is $140", baseCentsFor("classic-facial", ["light-therapy"], "regular"), 14000);
check("Classic + Light Private Hours is $155 (premium once)", baseCentsFor("classic-facial", ["light-therapy"], "after"), 15500);
check("Classic + 2 add-ons Private Hours is $190", baseCentsFor("classic-facial", ["light-therapy", "reflexology"], "after"), 19000);
check("normalizeAddons dedupes", normalizeAddons(["light-therapy", "light-therapy"]).length, 1);
let threw = false;
try { normalizeAddons(["nope"]); } catch (e) { threw = true; }
check("normalizeAddons rejects unknown id", threw, true);
// Stored 75-min booking (Classic 10:00 + Light) blocks to 12:15.
check("Classic+Light 10:00 booked -> 11:00 Classic blocked", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "11:00 AM", "classic-facial", []), true);
check("Classic+Light 10:00 booked -> 12:00 Classic blocked", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "12:00 PM", "classic-facial", []), true);
check("Classic+Light 10:00 booked -> 12:30 Classic free", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "12:30 PM", "classic-facial", []), false);
check("Classic+Light 10:00 booked -> 1:00 PM Classic free", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "1:00 PM", "classic-facial", []), false);
// A 75-min request ending 25 min before the next booking is blocked;
// the same 55-min request at 11:00 before a 2:00 Classic fits.
check("Classic+Light at 12:00 before a 2:00 Classic is blocked", takenWithAddons([B("2:00 PM", "classic-facial")], "12:00 PM", "classic-facial", ["light-therapy"]), true);
check("Plain Classic at 11:00 before a 2:00 Classic is free", taken([B("2:00 PM", "classic-facial")], "11:00 AM", "classic-facial"), false);
check("freeTimes with add-ons drops 12:00 before a 2:00 Classic", freeTimes("2026-11-20", "regular", "classic-facial", [B("2:00 PM", "classic-facial")], {}, ["light-therapy"]).includes("12:00 PM"), false);
check("freeTimes without add-ons keeps 11:00 before a 2:00 Classic", freeTimes("2026-11-20", "regular", "classic-facial", [B("2:00 PM", "classic-facial")], {}).includes("11:00 AM"), true);

// Prototype slots.test.js cases, mirrored on the server rule:
check("55 min at 10:00 blocks until 11:55; 12:00 is next", takenMins([B("10:00 AM", "classic-facial")], "12:00 PM", 30) === false && takenMins([B("10:00 AM", "classic-facial")], "11:30 AM", 30) === true, true);
check("30 min at 10:00 frees 11:30", takenMins([B("10:00 AM", "reflexology")], "11:30 AM", 30) === false && takenMins([B("10:00 AM", "reflexology")], "11:00 AM", 30) === true, true);
check("1h at 10:00: 10:00..11:30 gone, 12:00 free", takenMins([B("10:00 AM", "classic-facial")], "12:00 PM", 60) === false, true);
check("2h at 1 PM: 1:00..3:30 gone, 4:00 free", takenMins([B("1:00 PM", "anti-aging-facial", "2026-11-20", ["light-therapy", "reflexology"])], "4:00 PM", 120) === false && takenMins([B("1:00 PM", "anti-aging-facial", "2026-11-20", ["light-therapy", "reflexology"])], "3:30 PM", 120) === true, true);
check("1h35 at 11 AM blocked by a 1 PM booking", takenMins([B("1:00 PM", "classic-facial")], "11:00 AM", 95), true);
check("1h35 visit: 10:00 AM ends 12:35 incl. reset, fits before 1 PM", takenMins([B("1:00 PM", "classic-facial")], "10:00 AM", 95), false);
check("55-min visit: 11:00 fits before a 1 PM booking, 11:30 does not", takenMins([B("1:00 PM", "classic-facial")], "11:00 AM", 55) === false && takenMins([B("1:00 PM", "classic-facial")], "11:30 AM", 55) === true, true);

// The block is FIXED under A3: marking a booking done early does not
// move it — a Classic at 10:00 still blocks 11:00/11:30 and frees 12:00.
const done10 = B("10:00 AM", "classic-facial", "2026-11-20", [], { finishedAt: new Date().toISOString(), actualEndMin: 655 });
check("Classic 10:00 done at 10:55 -> 12:00 free (block fixed)", taken([done10], "12:00 PM", "classic-facial"), false);
check("Classic 10:00 done at 10:55 -> 11:00 still blocked", taken([done10], "11:00 AM", "classic-facial"), true);
check("Classic 10:00 done at 10:55 -> 11:30 still blocked", taken([done10], "11:30 AM", "classic-facial"), true);

// 4-a-day cap: cancelled bookings and expired pendings don't count.
// Consultations share the cap with treatments (A4).
const fourPaid = [1, 2, 3, 4].map((n) => B("10:00 AM", "classic-facial", "2026-11-20", [], { id: "bk" + n }));
check("4 paid bookings count as 4", countActiveBookings(fourPaid), 4);
check("4 paid bookings fill the day", dayIsFull(fourPaid), true);
check("3 paid bookings do not fill the day", dayIsFull(fourPaid.slice(0, 3)), false);
check("a cancelled booking does not count", countActiveBookings([...fourPaid.slice(0, 3), B("10:00 AM", "classic-facial", "2026-11-20", [], { status: "cancelled" })]), 3);
const nowMs = Date.now();
const expiredPending = B("10:00 AM", "classic-facial", "2026-11-20", [], { status: "pending", createdAt: new Date(nowMs - 31 * 60 * 1000).toISOString() });
check("an expired pending hold does not count", countActiveBookings([expiredPending], nowMs), 0);
const freshPending = B("10:00 AM", "classic-facial", "2026-11-20", [], { status: "pending", createdAt: new Date(nowMs).toISOString() });
check("a fresh pending hold counts", countActiveBookings([freshPending], nowMs), 1);
check("consultation counts toward the cap", countsTowardCap("consultation"), true);
check("4 consultations fill the day", dayIsFull([1, 2, 3, 4].map((n) => B("10:00 AM", "consultation", "2026-11-20", [], { id: "cx" + n }))), true);
check("3 treatments + 1 consultation fill the day", dayIsFull([...fourPaid.slice(0, 3), B("10:00 AM", "consultation", "2026-11-20", [], { id: "cx1" })]), true);

// Finish check: due an hour into the appointment, not before, not after
// she marks it done, not while snoozed, not on another day.
const fc = B("10:00 AM", "classic-facial");
check("finish check due at 11:00", finishCheckDue(fc, "2026-11-20", 660, nowMs), true);
check("finish check not due at 10:59", finishCheckDue(fc, "2026-11-20", 659, nowMs), false);
check("finish check not due once finished", finishCheckDue(B("10:00 AM", "classic-facial", "2026-11-20", [], { finishedAt: new Date().toISOString() }), "2026-11-20", 660, nowMs), false);
check("finish check not due on another day", finishCheckDue(fc, "2026-11-21", 660, nowMs), false);
check("finish check not due for a cancelled booking", finishCheckDue(B("10:00 AM", "classic-facial", "2026-11-20", [], { status: "cancelled" }), "2026-11-20", 660, nowMs), false);
check("finish check not due for an expired pending", finishCheckDue(expiredPending, "2026-11-20", 660, nowMs), false);
check("finish check not due while snoozed", finishCheckDue(B("10:00 AM", "classic-facial", "2026-11-20", [], { finishSnoozedUntil: new Date(nowMs + 15 * 60 * 1000).toISOString() }), "2026-11-20", 660, nowMs), false);
check("finish check due again after the snooze expires", finishCheckDue(B("10:00 AM", "classic-facial", "2026-11-20", [], { finishSnoozedUntil: new Date(nowMs - 60 * 1000).toISOString() }), "2026-11-20", 660, nowMs), true);

console.log(`schedule tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
