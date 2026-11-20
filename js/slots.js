/* In2Skin slot rules (Tony, Nov 20 2026). Pure functions: used by the picker and by tests/slots.test.js.
   - Online start times every 30 minutes, 9:00 AM through 4:00 PM (a 4:00 start may run past closing).
   - Every booking blocks its full treatment time PLUS a 1-hour reset after it.
   - A start is offered only if the visitor's whole visit + its reset hour fits without
     touching another booking or that booking's reset hour.                               */
(function (root) {
  var RULES = { firstStart: 9 * 60, lastStart: 16 * 60, stepMins: 30, resetMins: 60, maxPerDay: 99 };

  function toMin(t) { // "12:00" / "2:30 PM" / 840
    if (typeof t === "number") return t;
    var m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i); if (!m) return null;
    var h = +m[1], mi = +m[2], ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h !== 12) h += 12; if (ap === "AM" && h === 12) h = 0;
    return h * 60 + mi;
  }
  function label(min) { var h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return h12 + ":" + (m < 10 ? "0" : "") + m + " " + ap; }

  /* existing: [{ start: "12:00", mins: 60 }]  ·  returns { full, starts:[{min,label}], count } */
  function slotsForDay(existing, visitMins, rules) {
    var R = rules || RULES, list = existing || [];
    if (list.length >= R.maxPerDay) return { full: true, starts: [], count: list.length };
    var busy = list.map(function (b) { var s = toMin(b.start); return [s, s + b.mins + R.resetMins]; });
    var starts = [];
    for (var s = R.firstStart; s <= R.lastStart; s += R.stepMins) {
      var e = s + visitMins + R.resetMins;
      var clash = busy.some(function (b) { return s < b[1] && b[0] < e; });
      if (!clash) starts.push({ min: s, label: label(s) });
    }
    return { full: false, starts: starts, count: list.length };
  }

  var API = { RULES: RULES, slotsForDay: slotsForDay, toMin: toMin, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.IN2_SLOTS = API;
})(this);
