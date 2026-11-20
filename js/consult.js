/* Consultation booking — one page, one job: pick a consultation, pay $30, done.
   Two formats, one service (Tony Nov 19, 2026): a 20-minute video call on Google
   Meet, or a 20-minute face consultation at the studio. $30 flat, paid up front
   by card, credited in full toward any treatment once the consultation is done.
   First-time clients only, one per client ever. Times come from the real server
   (GET /api/availability, service=consultation); js/slots.js is only the
   fallback when the API cannot be reached. Paying posts to POST /api/book,
   which returns a Stripe Checkout link — paying completes the booking, and a
   paid video consultation mints its own fresh Meet link at payment (the link
   lands in the confirmation email, the reminder and the confirmation page).
   The /consultation/ page lets the client pick the format first; the
   /video-consult/ page is the same flow with video preselected. */
(function () {
  var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var SL = window.IN2_SLOTS, KEY = "in2-bookings-v1", TZ = "America/Toronto", MINS = 20;
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], MON3 = MONTHS.map(function (m) { return m.slice(0, 3); }), DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var LOADED_AT = Date.now();
  /* Format: the page picks it (body data-consult-format="video" on the
     video page), ?format=video|in-person overrides it, otherwise the
     client picks on the page (the /consultation/ format step). */
  var FORMAT_PARAM = (new URLSearchParams(location.search).get("format") || "").toLowerCase();
  var S = { day: null, time: null, format: FORMAT_PARAM === "in-person" || FORMAT_PARAM === "video" ? FORMAT_PARAM : (document.body.getAttribute("data-consult-format") || null) };
  var HAS_PICKER = !!$("#cx0");
  function nowParts() {
    try { var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month - 1, d: +p.day, min: (+p.hour) * 60 + (+p.minute) }; } catch (e) { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), min: n.getHours() * 60 + n.getMinutes() }; }
  }
  var NOW = nowParts(), VIEW = { y: NOW.y, m: NOW.m }, MAXAHEAD = 11;
  var pad2 = function (n) { return (n < 10 ? "0" : "") + n; }, iso = function (y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); };
  var mi = function (v) { return v.y * 12 + v.m; };
  function loadB() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function parseISO(k) { var p = k.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }

  /* ---------- real availability: GET /api/availability (service=consultation) ---------- */
  var AVAIL = { dates: {}, fetchedMonths: {}, dayTimes: null, dayKey: "", failed: false };
  function fetchJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function refreshMonth() {
    var mk = VIEW.y + "-" + VIEW.m;
    if (AVAIL.fetchedMonths[mk]) return;
    AVAIL.fetchedMonths[mk] = "pending";
    var from = iso(VIEW.y, VIEW.m, 1), dim = new Date(Date.UTC(VIEW.y, VIEW.m + 1, 0)).getUTCDate(), to = iso(VIEW.y, VIEW.m, dim);
    fetchJSON("/api/availability?from=" + from + "&to=" + to + "&service=consultation").then(function (j) {
      Object.keys(j.dates || {}).forEach(function (k) { AVAIL.dates[k] = j.dates[k]; });
      AVAIL.fetchedMonths[mk] = "done"; AVAIL.failed = false;
      renderCal(); renderTimes();
    }).catch(function (err) {
      console.warn("[in2skin] consultation availability unavailable, using on-device times:", err);
      delete AVAIL.fetchedMonths[mk]; AVAIL.failed = true;
      renderCal(); renderTimes();
    });
  }
  function loadDayTimes(dateStr) {
    AVAIL.dayKey = dateStr; AVAIL.dayTimes = null;
    var box = $("#cxTimes"); if (box) box.innerHTML = '<p class="cx-hint">Checking times…</p>';
    fetchJSON("/api/availability?date=" + dateStr + "&service=consultation&type=regular").then(function (j) {
      if (AVAIL.dayKey !== dateStr) return;
      var labels = (j.times || []).map(function (l) { return { label: l, min: SL.toMin(l) }; });
      var q = parseISO(dateStr);
      if (q.y === NOW.y && q.m === NOW.m && q.d === NOW.d) labels = labels.filter(function (x) { return x.min > NOW.min; });
      AVAIL.dayTimes = labels;
      if (S.time && !labels.some(function (x) { return x.label === S.time; })) S.time = null;
      renderTimes();
    }).catch(function (err) {
      console.warn("[in2skin] consultation day times unavailable, using on-device times:", err);
      AVAIL.dayKey = ""; AVAIL.dayTimes = null;
      renderTimes();
    });
  }

  function dayInfo(y, m, d) {
    var dw = new Date(Date.UTC(y, m, d)).getUTCDay(), cur = y === NOW.y && m === NOW.m;
    if (mi({ y: y, m: m }) < mi(NOW) || (cur && d < NOW.d) || dw === 0) return { off: true, starts: [] };
    var k = iso(y, m, d);
    if (AVAIL.dates[k]) {
      var free = AVAIL.dates[k].regular.free;
      /* The range count is for the whole day — it still counts starts that
         have already passed. Today is off once the last start is gone. */
      var todayDone = cur && d === NOW.d && NOW.min >= SL.RULES.lastStart;
      return { off: !free || todayDone, starts: [], api: true };
    }
    var starts = SL.slotsForDay(loadB()[k] || [], MINS).starts;
    if (cur && d === NOW.d) starts = starts.filter(function (x) { return x.min > NOW.min; });
    return { off: !starts.length, starts: starts };
  }
  function dayLabel() { if (!S.day) return ""; var q = parseISO(S.day); return DN[new Date(Date.UTC(q.y, q.m, q.d)).getUTCDay()] + " " + MON3[q.m] + " " + q.d; }
  function formatName() { return S.format === "in-person" ? "In-person consultation" : "Video consultation"; }

  var tt = document.createElement("div"); tt.className = "cx-toast"; document.body.appendChild(tt); var tm;
  function toast(m) { tt.textContent = m; tt.classList.add("on"); clearTimeout(tm); tm = setTimeout(function () { tt.classList.remove("on"); }, 3200); }
  function hdr() { var h = document.querySelector("header.site"); return h ? h.getBoundingClientRect().height : 72; }
  function go(el) { if (!el) return; var r = el.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, window.scrollY + r.top - hdr() - 14), behavior: RM.matches ? "auto" : "smooth" }); }

  function renderCal() {
    var y = VIEW.y, m = VIEW.m, first = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var atMin = mi(VIEW) <= mi(NOW), atMax = mi(VIEW) >= mi(NOW) + MAXAHEAD;
    var h = '<div class="cal-head"><button class="cal-nav" type="button" data-nav="-1"' + (atMin ? " disabled" : "") + ' aria-label="Previous month">‹</button><span class="cal-title" aria-live="polite">' + MONTHS[m] + " " + y + '</span><button class="cal-nav" type="button" data-nav="1"' + (atMax ? " disabled" : "") + ' aria-label="Next month">›</button></div>' +
      '<div class="cal-week">' + ["S", "M", "T", "W", "T", "F", "S"].map(function (w) { return "<span>" + w + "</span>"; }).join("") + '</div><div class="cal-days">';
    for (var i = 0; i < first; i++) h += '<span class="day pad" aria-hidden="true"></span>';
    for (var d = 1; d <= dim; d++) { var inf = dayInfo(y, m, d);
      h += '<button type="button" class="day' + (inf.off ? " off" : "") + (S.day === iso(y, m, d) ? " sel" : "") + '" data-day="' + iso(y, m, d) + '"' + (inf.off ? " disabled" : "") + ' aria-label="' + MONTHS[m] + " " + d + (inf.off ? ", unavailable" : "") + '">' + d + "</button>"; }
    $("#cxCal").innerHTML = h + "</div>"; $("#cxCal").setAttribute("aria-label", "Calendar, " + MONTHS[m] + " " + y);
  }
  function renderTimes() {
    if (S.day) { var q = parseISO(S.day), inf = dayInfo(q.y, q.m, q.d); if (inf.off) { S.day = null; S.time = null; } }
    var box = $("#cxTimes"); if (!S.day) { box.innerHTML = ""; return; }
    var q2 = parseISO(S.day), inf2 = dayInfo(q2.y, q2.m, q2.d);
    if (inf2.api) {
      if (AVAIL.dayKey === S.day && AVAIL.dayTimes) {
        if (S.time && !AVAIL.dayTimes.some(function (x) { return x.label === S.time; })) S.time = null;
        box.innerHTML = AVAIL.dayTimes.map(function (x) { return '<button type="button" class="cx-time" role="radio" data-time="' + x.label + '" aria-checked="' + (S.time === x.label) + '">' + x.label + "</button>"; }).join("");
        return;
      }
      if (AVAIL.dayKey !== S.day) { loadDayTimes(S.day); return; }
      return; /* already loading */
    }
    var st = inf2.starts;
    if (S.time && !st.some(function (x) { return x.label === S.time; })) S.time = null;
    box.innerHTML = st.map(function (x) { return '<button type="button" class="cx-time" role="radio" data-time="' + x.label + '" aria-checked="' + (S.time === x.label) + '">' + x.label + "</button>"; }).join("");
  }
  function paintFormat() {
    if (!HAS_PICKER) return;
    $$(".cx-fmt").forEach(function (c) {
      var on = c.getAttribute("data-format") === S.format;
      c.classList.toggle("sel", on); c.setAttribute("aria-checked", String(on));
    });
    var emailLabel = $("#cxEmailLabel");
    if (emailLabel) emailLabel.childNodes[0].textContent = S.format === "in-person" ? "Email (your confirmation goes here)" : "Email (your Meet link goes here)";
    var when = $("#cxWhen");
    if (when && S.day && S.time) when.textContent = formatName() + " · " + dayLabel() + " · " + S.time;
    var after = $("#cxAfterNote");
    if (after) after.textContent = S.format === "in-person"
      ? "After you pay you land on your confirmation page. The studio address is in your confirmation email — it is only shared with booked clients."
      : "After you pay you land on your confirmation page with your own fresh Meet link. The link is also in your confirmation email and your reminders.";
  }
  function step(n, scroll) { for (var i = 1; i <= 3; i++) { var el = $("#cx" + i); el.classList.toggle("on", i === n); el.classList.toggle("done", i < n); } if (HAS_PICKER) { var f = $("#cx0"); f.classList.toggle("on", n === 1 && !S.format); f.classList.toggle("done", !!S.format); } if (n > 1 && scroll !== false) go($("#cx" + n)); guide(false); }
  function nextPiece() { if (HAS_PICKER && !S.format) return "format"; if (!S.day) return "day"; if (!S.time) return "time"; if (!$("#cxName").value.trim()) return "name"; if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($("#cxEmail").value.trim())) return "email"; if (!$("#cxPhone").value.replace(/\D/g, "").length || $("#cxPhone").value.replace(/\D/g, "").length < 10) return "phone"; if (!$("#cx3").classList.contains("on")) return "pay"; return "join"; }
  var TARGET = { format: "#cx0", day: "#cx1", time: "#cxTimes", name: "#cxName", email: "#cxEmail", phone: "#cxPhone", pay: "#cxPay", join: "#cx3" };
  function guide(scroll) {
    var n = nextPiece(); document.body.setAttribute("data-cx-next", n);
    if (scroll) { var t = $(TARGET[n]); if (n === "time") t = $("#cxTimes").children.length ? $("#cxTimes") : $("#cx1"); setTimeout(function () { go(t); }, RM.matches ? 0 : 140); }
  }
  function paint() { renderCal(); renderTimes(); paintFormat(); $("#cx1").classList.toggle("done", !!S.time && $("#cx1").classList.contains("done")); guide(false); }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-nav")) { var nv = new Date(Date.UTC(VIEW.y, VIEW.m + (+b.getAttribute("data-nav")), 1)), c = { y: nv.getUTCFullYear(), m: nv.getUTCMonth() };
      if (mi(c) >= mi(NOW) && mi(c) <= mi(NOW) + MAXAHEAD) { VIEW = c; renderCal(); refreshMonth(); } return; }
    if (b.classList.contains("cx-fmt")) {
      S.format = b.getAttribute("data-format"); S.day = null; S.time = null;
      paintFormat(); renderCal(); renderTimes(); step(1); guide(true); return;
    }
    if (b.hasAttribute("data-day") && $("#cxCal").contains(b)) { S.day = b.getAttribute("data-day"); S.time = null; renderCal(); renderTimes(); guide(true); return; }
    if (b.classList.contains("cx-time")) { S.time = b.getAttribute("data-time"); renderTimes();
      $("#cxWhen").textContent = formatName() + " · " + dayLabel() + " · " + S.time; $("#cxConfWhen").textContent = dayLabel() + " · " + S.time; step(2); return; }
  });
  $("#cxPay").addEventListener("click", function () {
    if (!S.day || !S.time) { step(1, false); guide(true); return; }
    var name = $("#cxName").value.trim(), email = $("#cxEmail").value.trim(), phone = $("#cxPhone").value.trim();
    var miss = [];
    if (!name) miss.push(["#cxName", "Add your name so we know who is coming."]);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) miss.push(["#cxEmail", "Add an email — your confirmation goes there."]);
    if (phone.replace(/\D/g, "").length < 10) miss.push(["#cxPhone", "Add a mobile number so we can reach you about your appointment."]);
    if (miss.length) { toast(miss[0][1]); guide(true); setTimeout(function () { $(miss[0][0]).focus({ preventScroll: true }); }, 350); return; }
    var btn = $("#cxPay"); btn.disabled = true; btn.textContent = "Taking you to secure payment…";
    fetch("/api/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "consultation", format: S.format || "video", date: S.day, time: S.time, type: "regular",
        name: name, email: email, phone: phone, first: "yes", website: "", formLoadedAt: String(LOADED_AT),
      }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      if (!res.ok || !res.j.url) { throw new Error((res.j && res.j.error) || "Booking did not go through."); }
      location.href = res.j.url; /* Stripe Checkout — paying completes the booking */
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = "Pay $30 · card, Apple Pay or Google Pay";
      toast(err.message || "Something went wrong — please try again.");
    });
  });
  ["#cxName", "#cxEmail", "#cxPhone"].forEach(function (s) { var f = $(s); if (!f) return; f.addEventListener("input", function () { guide(false); }); f.addEventListener("change", function () { guide(true); }); f.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); f.blur(); guide(true); } }); });
  /* skipping past the day / time step (scrolling down beyond it) brings them back to it */
  var skipT, lastY = window.scrollY;
  window.addEventListener("scroll", function () {
    var down = window.scrollY > lastY; lastY = window.scrollY; clearTimeout(skipT); if (!down) return;
    skipT = setTimeout(function () { var n = nextPiece(); if (n !== "day" && n !== "time") return;
      var c = $("#cx1").getBoundingClientRect(), t = $("#cx2").getBoundingClientRect(); if (c.bottom < hdr() + 8 && t.top < window.innerHeight * 0.9) { guide(true); } }, 220);
  }, { passive: true });
  paintFormat();
  renderCal(); renderTimes(); refreshMonth(); guide(false);
})();
