// GET /api/availability?date=YYYY-MM-DD&service=<id>&type=regular|after
// Returns the open slots for that day. If storage is not configured yet it
// falls back to the full schedule (booking will report the real error).
// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&service=<id>&addons=a,b
// Range mode (Tony Nov 17, 2026): per-date free/total slot counts for BOTH
// modes, so the booking wizard's date grid can show open / few left /
// fully booked. Counts only — never client names or booking details.
// At most 31 days per call.
const { kvGet, configured } = require("../lib/kv");
const { findService, parseDateLocal, dateKey, freeTimes, timesFor, dayIsFull, countActiveBookings } = require("../lib/schedule");
const { studioForDate } = require("../lib/studio");

module.exports = async (req, res) => {
  try {
    const { date, service, type, addons, from, to } = req.query || {};
    const svc = findService(service);
    if (!svc) return res.status(400).json({ error: "Unknown treatment." });
    const addonIds = addons ? String(addons).split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (from || to) {
      const fromD = parseDateLocal(from);
      const toD = parseDateLocal(to);
      if (!fromD || !toD) return res.status(400).json({ error: "Choose a valid date range." });
      if (fromD.getTime() > toD.getTime()) return res.status(400).json({ error: "The range starts after it ends." });
      const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
      if (days > 31) return res.status(400).json({ error: "That range is too long — at most 31 days." });
      const { listBookingsForDate } = require("../lib/bookings");
      const dates = {};
      const cur = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate());
      for (let i = 0; i < days; i++) {
        const key = dateKey(cur);
        const allRegular = timesFor(key, "regular");
        const allAfter = timesFor(key, "after");
        if (!configured()) {
          dates[key] = { regular: { free: allRegular.length, total: allRegular.length }, after: { free: allAfter.length, total: allAfter.length } };
        } else {
          const bookings = await listBookingsForDate(key);
          const { bufferMins, blocks } = await studioForDate(key);
          const opts = { bufferMins, blocks };
          // Four appointments a day, whatever they are (Tony Nov 19) —
          // a full day shows no free slots. After-hours is never
          // bookable online, so its free count is always zero.
          const full = dayIsFull(bookings);
          dates[key] = {
            regular: { free: full ? 0 : freeTimes(key, "regular", service, bookings, opts, addonIds).length, total: allRegular.length },
            after: { free: 0, total: allAfter.length },
          };
        }
        cur.setDate(cur.getDate() + 1);
      }
      return res.status(200).json({ from: dateKey(fromD), to: dateKey(toD), dates, storageConfigured: configured() });
    }
    if (!parseDateLocal(date)) return res.status(400).json({ error: "Choose a valid date." });
    // After-hours is by request through Sarah — never offered online
    // (Tony Nov 19, 2026).
    if (type === "after") return res.status(200).json({ date, times: [], dayFull: false, bookedCount: 0, storageConfigured: configured() });
    const all = timesFor(date, "regular");
    if (!configured()) return res.status(200).json({ date, times: all, storageConfigured: false });
    const { listBookingsForDate } = require("../lib/bookings");
    const bookings = await listBookingsForDate(date);
    const { bufferMins, blocks } = await studioForDate(date);
    const bookedCount = countActiveBookings(bookings);
    const dayFull = dayIsFull(bookings);
    return res.status(200).json({ date, times: dayFull ? [] : freeTimes(date, "regular", service, bookings, { bufferMins, blocks }, addonIds), dayFull, bookedCount, storageConfigured: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
