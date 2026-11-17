// Schedule tests — slot grid + 30-min cleanup buffer (Tony Nov 17: at least
// 30 min between appointments). Run: node scripts/test-schedule.js
const {
  findService, parseTime, durationFor, slotTaken, freeTimes, BUFFER_MINS,
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
const B = (time, svcId, date) => ({ time, date: date || "2026-11-20", service: svcId, status: "paid" });

check("BUFFER_MINS is 30", BUFFER_MINS, 30);
// Earlier scenarios (still true under 30):
check("empty day has 9 regular slots", freeTimes("2026-11-20", "regular", []).length, 9);
check("Classic 9:00 booked -> 10:00 Classic blocked", taken([B("9:00 AM", "classic-facial")], "10:00 AM", "classic-facial"), true);
check("Classic 9:00 booked -> 11:00 Classic free", taken([B("9:00 AM", "classic-facial")], "11:00 AM", "classic-facial"), false);
check("Anti-Aging 9:00 booked -> 10:00 blocked", taken([B("9:00 AM", "anti-aging-facial")], "10:00 AM", "classic-facial"), true);
check("15-min add-on 9:00 -> 10:00 Classic free", taken([B("9:00 AM", "reflexology")], "10:00 AM", "classic-facial"), false);
check("Classic 11:00 booked -> new 10:00 Classic blocked", taken([B("11:00 AM", "classic-facial")], "10:00 AM", "classic-facial"), true);
check("Chemical peel 9:00 -> 10:00 free", taken([B("9:00 AM", "chemical-peels")], "10:00 AM", "classic-facial"), false);
check("Private Classic 7:00 -> 7:45 blocked", taken([B("7:00 AM", "classic-facial")], "7:45 AM", "classic-facial"), true);
check("Private Classic 7:00 -> 8:30 free", taken([B("7:00 AM", "classic-facial")], "8:30 AM", "classic-facial"), false);
// 30-min discriminator (would PASS under the old 15-min buffer):
// Classic 9:00 ends 9:55; +30 buffer blocks until 10:25, so a 10:15 add-on is blocked.
check("Classic 9:00 -> 10:15 add-on blocked under 30-min buffer", taken([B("9:00 AM", "classic-facial")], "10:15 AM", "reflexology"), true);
// Add-on 9:00 ends 9:15; +30 blocks until 9:45, so a 9:30 add-on is blocked.
check("Add-on 9:00 -> 9:30 add-on blocked under 30-min buffer", taken([B("9:00 AM", "reflexology")], "9:30 AM", "reflexology"), true);
check("Add-on 9:00 -> 10:00 add-on free", taken([B("9:00 AM", "reflexology")], "10:00 AM", "reflexology"), false);

console.log(`schedule tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
