// Schedule tests — slot grid + 60-min gap + 25-min overrun + 4-a-day cap
// + finish check (Tony Nov 19, 2026: Monday–Saturday, starts 10 AM–4 PM,
// Sundays closed, at most 4 bookings a day, 1-hour gap from when the
// appointment actually finishes). Run: node scripts/test-schedule.js
const {
  findService, parseTime, durationFor, durationForBooking, baseCentsFor,
  normalizeAddons, slotTaken, freeTimes, BUFFER_MINS, MIN_GAP_MINS,
  OVERRUN_MINS, MAX_BOOKINGS_PER_DAY, countActiveBookings, dayIsFull,
  finishCheckDue, timesFor,
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
function takenWithAddons(bookings, time, svcId, addonIds) {
  return slotTaken(bookings, parseTime(time), durationForBooking(svcId, addonIds));
}
const B = (time, svcId, date, addons, extra) => Object.assign(
  { time, date: date || "2026-11-20", service: svcId, status: "paid", addons: addons || [] },
  extra || {},
);

check("BUFFER_MINS is 60", BUFFER_MINS, 60);
check("MIN_GAP_MINS is 60", MIN_GAP_MINS, 60);
check("OVERRUN_MINS is 25", OVERRUN_MINS, 25);
check("MAX_BOOKINGS_PER_DAY is 4", MAX_BOOKINGS_PER_DAY, 4);
// 2026-11-20 is a Friday; 2026-11-22 is a Sunday.
check("empty Friday has 7 regular slots", freeTimes("2026-11-20", "regular", []).length, 7);
check("Sunday has no regular times", timesFor("2026-11-22", "regular").length, 0);
check("Sunday has no after-hours times either", timesFor("2026-11-22", "after").length, 0);
check("Sunday has no free times", freeTimes("2026-11-22", "regular", []).length, 0);
// A Classic at 10:00 runs 55 min + 25 overrun (done 11:20) + 60-min gap,
// so 11:00 and 12:00 are blocked and 1:00 PM is the next free start.
check("Classic 10:00 booked -> 11:00 Classic blocked", taken([B("10:00 AM", "classic-facial")], "11:00 AM", "classic-facial"), true);
check("Classic 10:00 booked -> 12:00 Classic blocked", taken([B("10:00 AM", "classic-facial")], "12:00 PM", "classic-facial"), true);
check("Classic 10:00 booked -> 1:00 PM Classic free", taken([B("10:00 AM", "classic-facial")], "1:00 PM", "classic-facial"), false);
check("Anti-Aging 10:00 booked -> 12:00 blocked", taken([B("10:00 AM", "anti-aging-facial")], "12:00 PM", "classic-facial"), true);
check("Anti-Aging 10:00 booked -> 1:00 PM free", taken([B("10:00 AM", "anti-aging-facial")], "1:00 PM", "classic-facial"), false);
check("20-min add-on 10:00 -> 11:00 Classic blocked", taken([B("10:00 AM", "reflexology")], "11:00 AM", "classic-facial"), true);
check("20-min add-on 10:00 -> 12:00 Classic free", taken([B("10:00 AM", "reflexology")], "12:00 PM", "classic-facial"), false);
check("Classic 12:00 booked -> new 11:00 Classic blocked", taken([B("12:00 PM", "classic-facial")], "11:00 AM", "classic-facial"), true);
check("Chemical peel 10:00 -> 12:00 blocked", taken([B("10:00 AM", "chemical-peels")], "12:00 PM", "classic-facial"), true);
check("Chemical peel 10:00 -> 1:00 PM free", taken([B("10:00 AM", "chemical-peels")], "1:00 PM", "classic-facial"), false);
check("Chemical peel alone is 55 min", durationForBooking("chemical-peels", []), 55);
check("Private Classic 7:00 -> 7:45 blocked", taken([B("7:00 AM", "classic-facial")], "7:45 AM", "classic-facial"), true);
check("Private Classic 7:00 -> 8:30 blocked", taken([B("7:00 AM", "classic-facial")], "8:30 AM", "classic-facial"), true);
check("Private Classic 7:00 -> 10:00 free", taken([B("7:00 AM", "classic-facial")], "10:00 AM", "classic-facial"), false);
// 60-min-gap discriminator: Classic 10:00 is blocked until 12:20,
// so a 12:00 add-on is blocked and a 1:00 PM add-on is free.
check("Classic 10:00 -> 12:00 add-on blocked under 60-min gap", taken([B("10:00 AM", "classic-facial")], "12:00 PM", "reflexology"), true);
check("Classic 10:00 -> 1:00 PM add-on free", taken([B("10:00 AM", "classic-facial")], "1:00 PM", "reflexology"), false);
// Add-on 10:00 ends 10:20 + 25 overrun + 60 gap blocks until 11:45.
check("Add-on 10:00 -> 11:00 add-on blocked under 60-min gap", taken([B("10:00 AM", "reflexology")], "11:00 AM", "reflexology"), true);
check("Add-on 10:00 -> 12:00 add-on free", taken([B("10:00 AM", "reflexology")], "12:00 PM", "reflexology"), false);

// Booking add-ons (Tony Nov 17, 2026; lengths per Sarah Nov 19, 2026):
// treatment + each add-on's own length, buffer wraps the whole
// appointment, premium once per visit.
check("Classic + Light is 75 min", durationForBooking("classic-facial", ["light-therapy"]), 75);
check("Classic + 2 add-ons is 95 min", durationForBooking("classic-facial", ["light-therapy", "reflexology"]), 95);
check("Microneedling / NANO Needling + Light is 40 min (20 + 20)", durationForBooking("needling", ["light-therapy"]), 40);
check("Classic + Microdermabrasion is 75 min (55 + 20)", durationForBooking("classic-facial", ["microdermabrasion"]), 75);
check("Classic + Micro + Light is 95 min (55 + 20 + 20)", durationForBooking("classic-facial", ["microdermabrasion", "light-therapy"]), 95);
check("Classic + Light regular is $140", baseCentsFor("classic-facial", ["light-therapy"], "regular"), 14000);
check("Classic + Light Private Hours is $155 (premium once)", baseCentsFor("classic-facial", ["light-therapy"], "after"), 15500);
check("Classic + 2 add-ons Private Hours is $190", baseCentsFor("classic-facial", ["light-therapy", "reflexology"], "after"), 19000);
check("normalizeAddons dedupes", normalizeAddons(["light-therapy", "light-therapy"]).length, 1);
let threw = false;
try { normalizeAddons(["nope"]); } catch (e) { threw = true; }
check("normalizeAddons rejects unknown id", threw, true);
// Stored 75-min booking (Classic 10:00 + Light) blocks 11:00 and 12:00,
// frees 1:00 PM.
check("Classic+Light 10:00 booked -> 11:00 Classic blocked", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "11:00 AM", "classic-facial", []), true);
check("Classic+Light 10:00 booked -> 12:00 Classic blocked", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "12:00 PM", "classic-facial", []), true);
check("Classic+Light 10:00 booked -> 1:00 PM Classic free", takenWithAddons([B("10:00 AM", "classic-facial", "2026-11-20", ["light-therapy"])], "1:00 PM", "classic-facial", []), false);
// A 75-min request ending 25 min before the next booking is blocked;
// the same 55-min request at 11:00 before a 2:00 Classic fits.
check("Classic+Light at 12:00 before a 2:00 Classic is blocked", takenWithAddons([B("2:00 PM", "classic-facial")], "12:00 PM", "classic-facial", ["light-therapy"]), true);
check("Plain Classic at 11:00 before a 2:00 Classic is free", taken([B("2:00 PM", "classic-facial")], "11:00 AM", "classic-facial"), false);
check("freeTimes with add-ons drops 12:00 before a 2:00 Classic", freeTimes("2026-11-20", "regular", "classic-facial", [B("2:00 PM", "classic-facial")], {}, ["light-therapy"]).includes("12:00 PM"), false);
check("freeTimes without add-ons keeps 11:00 before a 2:00 Classic", freeTimes("2026-11-20", "regular", "classic-facial", [B("2:00 PM", "classic-facial")], {}).includes("11:00 AM"), true);

// Done tap: a Classic at 10:00 marked done at 10:55 frees the room from
// the real finish, so 12:00 opens up (11:00 is still inside the gap).
const done10 = B("10:00 AM", "classic-facial", "2026-11-20", [], { finishedAt: new Date().toISOString(), actualEndMin: 655 });
check("Classic 10:00 done at 10:55 -> 12:00 free", taken([done10], "12:00 PM", "classic-facial"), false);
check("Classic 10:00 done at 10:55 -> 11:00 blocked", taken([done10], "11:00 AM", "classic-facial"), true);

// 4-a-day cap: cancelled bookings and expired pendings don't count.
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
