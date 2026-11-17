// GET /api/availability?date=YYYY-MM-DD&service=<id>&type=regular|after
// Returns the open slots for that day. If storage is not configured yet it
// falls back to the full schedule (booking will report the real error).
const { kvGet, configured } = require("../lib/kv");
const { findService, parseDateLocal, freeTimes, timesFor } = require("../lib/schedule");
const { studioForDate } = require("../lib/studio");

module.exports = async (req, res) => {
  try {
    const { date, service, type } = req.query || {};
    const svc = findService(service);
    if (!svc) return res.status(400).json({ error: "Unknown treatment." });
    if (!parseDateLocal(date)) return res.status(400).json({ error: "Choose a valid date." });
    const all = timesFor(date, type === "after" ? "after" : "regular");
    if (!configured()) return res.status(200).json({ date, times: all, storageConfigured: false });
    const { listBookingsForDate } = require("../lib/bookings");
    const bookings = await listBookingsForDate(date);
    const { bufferMins, blocks } = await studioForDate(date);
    return res.status(200).json({ date, times: freeTimes(date, type, service, bookings, { bufferMins, blocks }), storageConfigured: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
