/* In2Skin booking picker: guided in-place add-ons -> visit summary -> calendar
   -> your details -> payment -> Stripe Checkout.
   Reads js/data.js (services, prices), js/compat.js (add-on order, inclusions,
   compatibility) and js/slots.js (start-time rules). Times come from the real
   server — GET /api/availability — so the calendar shows the studio's actual
   bookings, the 60-minute reset and the 4-a-day cap. js/slots.js stays as the
   fallback when the API cannot be reached; the server re-checks every slot at
   booking time either way.
   Reserving posts to POST /api/book (name, email, phone required) and the
   server answers with a Stripe Checkout link — paying completes the booking.
   A booking is either recorded server-side with a reference or it did not
   happen: nothing here holds a slot locally.
   Deposit (Tony Nov 20, 2026): a booking for yourself pays a $30 deposit by
   card at booking, the balance at the visit. A booking for a friend is paid
   in full. "Book now, pay at the studio" is NOT an online choice. */
(function () {
  "use strict";
  var D = window.IN2, C = window.IN2_COMPAT, SL = window.IN2_SLOTS;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function money(n) { return "$" + n; }
  function hm(m) { var h = Math.floor(m / 60), r = m % 60; return h ? h + " h" + (r ? " " + r + " min" : "") : r + " min"; }
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var LOADED_AT = Date.now();

  /* ---------- state ---------- */
  /* one click submits (Nov 20, 2026): while a payment request is in
     flight the Reserve button stays dead until the answer comes back —
     and render() never resets its label mid-flight, or the button looks
     idle while swallowing clicks. */
  var submitting = false;
  var S = { main: null, variant: null, ans: {}, addonsDone: false, confirmed: false, date: null, time: null, option: null, who: "me", F: { name: "", email: "", phone: "", msg: "", yname: "", yemail: "", yphone: "" }, D: { name: "", email: "", phone: "" }, code: null, referredBy: null, booked: false };
  var I = {}; D.groups.forEach(function (g) { g.items.forEach(function (i) { I[i.id] = i; i.group = g.id; }); });
  var works = I["the-works"];
  /* ?ref=CODE — a referral code from a share link; validated server-side. */
  var refParam = (new URLSearchParams(location.search).get("ref") || "").trim();
  if (refParam) S.referredBy = refParam;

  /* ---------- price list: main treatments only (add-ons are offered in step 2) ---------- */
  function priceLabel(i) { return i.priceMax ? money(i.price) + "–" + money(i.priceMax) : money(i.price); }
  /* small round media: a short muted looping clip where In2Skin footage exists (poster = fallback), else the photo */
  function thumb(i, cls, size) {
    if (i.clip) return '<video class="' + cls + '" data-lazy-video src="' + i.clip + '" poster="' + i.poster + '" muted loop playsinline preload="none" width="' + size + '" height="' + size + '" aria-hidden="true"></video>';
    return '<img class="' + cls + '" src="' + i.img + '" alt="" width="' + size + '" height="' + size + '" loading="lazy">';
  }
  function rowHTML(i) {
    return '<button type="button" class="row" data-id="' + i.id + '" aria-pressed="false">' +
      thumb(i, "row-thumb", 60) +
      '<span class="row-main"><span class="row-name">' + esc(i.name) + '</span>' +
      '<span class="row-mins">' + i.mins + ' minutes</span><span class="row-desc">' + esc(i.desc) + '</span></span>' +
      '<span class="row-price"><span class="price">' + priceLabel(i) + '</span><span class="tick" aria-hidden="true">✓</span></span></button>';
  }
  $("#groupsMain").innerHTML = D.groups.filter(function (g) { return g.exclusive; }).map(function (g) {
    return '<h4 class="group-title">' + g.title + '</h4><div class="rows">' + g.items.map(rowHTML).join("") + "</div>";
  }).join("");
  if (window.IN2_WATCH_VIDEOS) window.IN2_WATCH_VIDEOS($("#groupsMain"));
  $("#variantChips").innerHTML = works.variants.map(function (v) {
    return '<button type="button" class="chip" role="radio" aria-checked="false" data-variant="' + v.id + '"><span>' + esc(v.label) + " · " + v.mins + ' min</span><b>' + money(v.price) + "</b></button>";
  }).join("");

  /* ---------- compatibility (from compat.js) ---------- */
  function rule(a, b) {
    for (var k = 0; k < C.rules.length; k++) { var r = C.rules[k]; if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return r; }
    return null;
  }
  function yesIds() { return Object.keys(S.ans).filter(function (k) { return S.ans[k] === true; }); }
  /* status of an add-on given the main + the other add-ons already said yes to */
  function statusOf(id) {
    var worst = { s: "ok" }, others = [S.main].concat(yesIds().filter(function (k) { return k !== id; }));
    others.forEach(function (o) { var r = rule(id, o); if (r && (r.s === "no" || (r.s === "check" && worst.s === "ok"))) worst = r; });
    return worst;
  }
  function included() { return (C.included[S.main] || { items: [] }).items; }
  function offered() { return S.main ? (C.offer[S.main] || []).filter(function (id) { return included().indexOf(id) < 0; }) : []; }
  function queue() { return offered().filter(function (id) { return S.ans[id] === true || statusOf(id).s !== "no"; }); }
  function blocked() { return offered().filter(function (id) { return S.ans[id] !== true && statusOf(id).s === "no"; }); }
  function variantObj() { return S.variant ? works.variants.filter(function (v) { return v.id === S.variant; })[0] : null; }
  function mainReady() { return !!S.main && !(S.main === "the-works" && !S.variant); }
  /* guided in-place picking (Tony Nov 20): every offered add-on shows at
     once — the client taps the gold ones to add them. The step is done when
     they tap Continue, not when every add-on has been answered. */
  function allAnswered() { return mainReady() && S.addonsDone; }
  /* most popular add-on for the chosen treatment = the first one in its suggested pairing order (compat.js "offer"), skipping any that cannot go with it */
  function popularId() {
    var o = offered().filter(function (id) { var r = rule(id, S.main); return !(r && r.s === "no"); });
    return o.length ? o[0] : null;
  }
  function whyFor(id) { var w = C.why[id] || {}; return w[S.main] || w["*"] || ""; }

  /* ---------- totals ---------- */
  function totals() {
    var items = [], mins = 0, total = 0, from = false;
    if (S.main) {
      var m = I[S.main], v = variantObj();
      if (m.needsVariant) {
        if (v) { items.push({ key: "main", name: "The Works (" + (v.id === "combo-classic" ? "Classic" : "Anti-Aging") + ")", mins: v.mins, price: v.price }); mins += v.mins; total += v.price; }
        else { items.push({ key: "main", name: "The Works", mins: null, price: m.price, from: true }); total += m.price; from = true; }
      } else { items.push({ key: "main", name: m.name, mins: m.mins, price: m.price, from: !!m.priceMax }); mins += m.mins; total += m.price; if (m.priceMax) from = true; }
      queue().forEach(function (id) { if (S.ans[id] === true) { var a = I[id]; items.push({ key: id, name: a.name, mins: a.mins, price: a.price }); mins += a.mins; total += a.price; } });
    }
    return { items: items, mins: mins, total: total, from: from };
  }
  function pr(T, n) { return (T.from ? "from " : "") + money(n); }
  function creditAmt(T) { return S.code ? Math.min(S.code.balance, T.total) : 0; }
  /* what the client actually pays after a gift code (Nov 20, 2026): the
     bars show the NET total, never the gross. */
  function netTotal(T) { return Math.max(0, T.total - creditAmt(T)); }
  function payLines(T) {
    var credit = D.consultDollars, dep = D.depositDollars, cr = creditAmt(T), rem = Math.max(0, T.total - cr), L = [];
    if (cr) L.push(["Gift code " + S.code.code, "−" + money(cr)]);
    if (S.option === "G") { L.push(["Paid today", pr(T, rem)]); L.push(["At the visit", money(0)]); }
    else if (S.option === "A") { var d = Math.min(dep, rem); L.push(["Due today: deposit", money(d)], ["At your visit", pr(T, Math.max(0, rem - d))]); }
    return L;
  }
  function itemsHTML(T, cls) {
    return T.items.map(function (it) {
      return '<div class="' + cls + '-item"><span class="ti-name">' + esc(it.name) + (it.mins ? '<small>' + it.mins + ' min</small>' : "") + '</span>' +
        '<b>' + (it.from ? "from " : "") + money(it.price) + '</b><button type="button" class="x" data-remove="' + it.key + '" aria-label="Remove ' + esc(it.name) + '">×</button></div>';
    }).join("");
  }
  function totalsHTML(T, withPay) {
    var h = '<div class="tt-row"><span>Total time</span><b>' + (T.mins ? hm(T.mins) : "–") + '</b></div><div class="tt-row tt-big"><span>Total</span><b>' + pr(T, T.total) + '</b></div>';
    if (withPay) payLines(T).forEach(function (l) { h += '<div class="tt-row tt-pay"><span>' + l[0] + '</span><b>' + l[1] + '</b></div>'; });
    return h;
  }

  /* ---------- calendar + times: real date (Toronto), real availability ---------- */
  var KEY = "in2-bookings-v1", TZ = "America/Toronto";
  /* Real availability (GET /api/availability). The server is the source of
     truth — it knows every booking, the hidden 60-minute reset and the
     4-a-day cap. Prototype ids map to backend ids: The Works books as its
     variant (combo-classic / combo-anti, 55 / 80 min); the "needling"
     add-on is the backend's nano-needling. Falls back to the on-device
     slots.js computation when the API cannot be reached; the server
     re-checks the slot at booking time. */
  var AVAIL = { selKey: null, dates: {}, fetchedMonths: {}, dayTimes: null, dayKey: "", failed: false };
  function apiService() {
    if (!mainReady()) return null;
    if (S.main === "the-works") return S.variant;
    return S.main;
  }
  function apiAddons() {
    return queue().filter(function (id) { return S.ans[id] === true; })
      .map(function (id) { return id === "needling" ? "nano-needling" : id; });
  }
  function availSelKey() { var s = apiService(); return s ? s + "|" + apiAddons().join(",") : ""; }
  function fetchJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function refreshMonth() {
    if (!S.confirmed || !mainReady()) return;
    var key = availSelKey(), svc = apiService(), mk = VIEW.y + "-" + VIEW.m;
    if (AVAIL.selKey !== key) { AVAIL = { selKey: key, dates: {}, fetchedMonths: {}, dayTimes: null, dayKey: "", failed: false }; }
    if (AVAIL.fetchedMonths[mk]) return;
    AVAIL.fetchedMonths[mk] = "pending";
    var from = iso(VIEW.y, VIEW.m, 1), dim = new Date(Date.UTC(VIEW.y, VIEW.m + 1, 0)).getUTCDate(), to = iso(VIEW.y, VIEW.m, dim);
    var ad = apiAddons().join(",");
    var url = "/api/availability?from=" + from + "&to=" + to + "&service=" + encodeURIComponent(svc) + (ad ? "&addons=" + encodeURIComponent(ad) : "");
    fetchJSON(url).then(function (j) {
      if (AVAIL.selKey !== key) return;
      Object.keys(j.dates || {}).forEach(function (k) { AVAIL.dates[k] = j.dates[k]; });
      AVAIL.fetchedMonths[mk] = "done"; AVAIL.failed = false;
      renderCal(); renderSlots();
    }).catch(function (err) {
      console.warn("[in2skin] availability unavailable, using on-device times:", err);
      delete AVAIL.fetchedMonths[mk]; AVAIL.failed = true;
      renderCal(); renderSlots();
    });
  }
  function loadDayTimes(dateStr) {
    var svc = apiService(); if (!svc) return;
    var ad = apiAddons().join(",");
    var url = "/api/availability?date=" + dateStr + "&service=" + encodeURIComponent(svc) + "&type=regular" + (ad ? "&addons=" + encodeURIComponent(ad) : "");
    AVAIL.dayKey = dateStr; AVAIL.dayTimes = null;
    renderSlotsLoading();
    fetchJSON(url).then(function (j) {
      if (AVAIL.dayKey !== dateStr) return;
      var labels = (j.times || []).map(function (l) { return { label: l, min: SL.toMin(l) }; });
      var q = parseISO(dateStr);
      if (q.y === NOW.y && q.m === NOW.m && q.d === NOW.d) labels = labels.filter(function (x) { return x.min > NOW.min; });
      AVAIL.dayTimes = labels;
      if (S.time && !labels.some(function (x) { return x.label === S.time; })) S.time = null;
      renderSlots();
    }).catch(function (err) {
      console.warn("[in2skin] day times unavailable, using on-device times:", err);
      AVAIL.dayKey = ""; AVAIL.dayTimes = null;
      renderSlots();
    });
  }
  function renderSlotsLoading() {
    var box = $("#slots");
    if (box) box.innerHTML = '<p class="flow-wait">Checking times…</p>';
  }
  function nowParts() { /* studio clock, not the visitor's */
    try {
      var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { y: +p.year, m: +p.month - 1, d: +p.day, min: (+p.hour) * 60 + (+p.minute) };
    } catch (e) { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), min: n.getHours() * 60 + n.getMinutes() }; }
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); }
  function loadB() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYNAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON3 = MONTHS.map(function (m) { return m.slice(0, 3); });
  var NOW = nowParts(), VIEW = { y: NOW.y, m: NOW.m }, MAXAHEAD = 11;
  function monthIdx(v) { return v.y * 12 + v.m; }
  function visitMins() { return totals().mins || 60; }
  function dayInfo(y, m, d, mins) {
    var dt = new Date(Date.UTC(y, m, d)), dw = dt.getUTCDay(), cur = (y === NOW.y && m === NOW.m);
    if (monthIdx({ y: y, m: m }) < monthIdx(NOW) || (cur && d < NOW.d) || dw === 0) return { off: true, starts: [] };
    var k = iso(y, m, d);
    /* Real availability when the month is loaded for this selection:
       the range call gives the free count per day (the exact starts
       load when the day is picked). */
    if (AVAIL.selKey === availSelKey() && AVAIL.dates[k]) {
      var free = AVAIL.dates[k].regular.free;
      /* The range count is for the whole day — it still counts starts that
         have already passed. Today is off once the last start is gone. */
      var todayDone = cur && d === NOW.d && NOW.min >= SL.RULES.lastStart;
      return { off: !free || todayDone, starts: [], few: free > 0 && free <= 2, api: true };
    }
    var r = SL.slotsForDay(loadB()[k] || [], mins), starts = r.starts;
    if (cur && d === NOW.d) starts = starts.filter(function (x) { return x.min > NOW.min; });
    return { off: !starts.length, starts: starts, few: starts.length > 0 && starts.length <= 2 };
  }
  function renderCal() {
    var mins = visitMins(), y = VIEW.y, m = VIEW.m, first = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var atMin = monthIdx(VIEW) <= monthIdx(NOW), atMax = monthIdx(VIEW) >= monthIdx(NOW) + MAXAHEAD;
    var h = '<div class="cal-head"><button class="cal-nav" type="button" data-nav="-1"' + (atMin ? " disabled" : "") + ' aria-label="Previous month">‹</button><span class="cal-title" aria-live="polite">' + MONTHS[m] + " " + y + '</span><button class="cal-nav" type="button" data-nav="1"' + (atMax ? " disabled" : "") + ' aria-label="Next month">›</button></div>' +
      '<div class="cal-week">' + ["S", "M", "T", "W", "T", "F", "S"].map(function (w) { return "<span>" + w + "</span>"; }).join("") + '</div><div class="cal-days">';
    for (var i = 0; i < first; i++) h += '<span class="day pad" aria-hidden="true"></span>';
    var anyFew = false;
    for (var d = 1; d <= dim; d++) {
      var inf = dayInfo(y, m, d, mins), few = !inf.off && (typeof inf.few === "boolean" ? inf.few : inf.starts.length <= 2); if (few) anyFew = true;
      h += '<button type="button" class="day' + (inf.off ? " off" : "") + (few ? " few" : "") + (S.date === iso(y, m, d) ? " sel" : "") + '" data-day="' + iso(y, m, d) + '"' + (inf.off ? " disabled" : "") + ' aria-label="' + MONTHS[m] + " " + d + (inf.off ? ", unavailable" : "") + '">' + d + "</button>";
    }
    $("#cal").innerHTML = h + "</div>" + (anyFew ? '<p class="cal-key"><i aria-hidden="true"></i>Few times left</p>' : "");
    $("#cal").setAttribute("aria-label", "Calendar, " + MONTHS[m] + " " + y);
  }
  function parseISO(k) { var p = k.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function renderSlots() {
    var box = $("#slots");
    if (S.date) { var q = parseISO(S.date); var inf = dayInfo(q.y, q.m, q.d, visitMins()); if (inf.off) { S.date = null; S.time = null; } }
    if (!S.date) { box.innerHTML = ""; return; }
    /* Real times for the picked day when the range data covers it;
       otherwise the on-device computation. */
    var q2 = parseISO(S.date), inf2 = dayInfo(q2.y, q2.m, q2.d, visitMins());
    if (inf2.api) {
      if (AVAIL.dayKey === S.date && AVAIL.dayTimes) {
        if (S.time && !AVAIL.dayTimes.some(function (x) { return x.label === S.time; })) S.time = null;
        box.innerHTML = AVAIL.dayTimes.map(function (x) {
          return '<button type="button" class="slot' + (S.time === x.label ? " sel" : "") + '" role="radio" aria-checked="' + (S.time === x.label) + '" data-time="' + x.label + '">' + x.label + "</button>";
        }).join("");
        return;
      }
      if (AVAIL.dayKey !== S.date) { loadDayTimes(S.date); return; }
      return; /* already loading — renderSlotsLoading showed the wait state */
    }
    if (S.time && !inf2.starts.some(function (x) { return x.label === S.time; })) S.time = null;
    box.innerHTML = inf2.starts.map(function (x) {
      return '<button type="button" class="slot' + (S.time === x.label ? " sel" : "") + '" role="radio" aria-checked="' + (S.time === x.label) + '" data-time="' + x.label + '">' + x.label + "</button>";
    }).join("");
  }
  function dateLabel() { if (!S.date) return ""; var q = parseISO(S.date); return DAYNAME[new Date(Date.UTC(q.y, q.m, q.d)).getUTCDay()] + " " + MON3[q.m] + " " + q.d; }

  /* ---------- the next required step ---------- */
  var EMAILRE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function PHONERE(v) { return String(v || "").replace(/\D/g, "").length >= 10; }
  function friendNext() { /* the next friend-mode field still needed (phone and message are optional) */
    if (S.who !== "friend") return null; var F = S.F;
    if (!F.name) return "fName"; if (!PHONERE(F.phone)) return "fPhone"; if (F.email && !EMAILRE.test(F.email)) return "fEmail";
    if (!F.yname) return "yName"; if (!EMAILRE.test(F.yemail)) return "yEmail"; if (!PHONERE(F.yphone)) return "yPhone"; return null;
  }
  /* your details (booking for yourself): name + email + phone, all required */
  function detailsNext() {
    if (S.who !== "me") return null;
    if (!S.D.name) return "mName"; if (!EMAILRE.test(S.D.email)) return "mEmail"; if (!PHONERE(S.D.phone)) return "mPhone"; return null;
  }
  function detailsValid() { return !detailsNext(); }
  function nextStep() {
    if (friendNext()) return "friend";
    if (!S.main) return "treatment";
    if (S.main === "the-works" && !S.variant) return "variant";
    if (!S.addonsDone) return "addon";
    if (!S.confirmed) return "summary";
    if (!S.date) return "date";
    if (!S.time) return "time";
    if (detailsNext()) return "details";
    if (!S.option && S.who !== "friend") return "option";
    return "reserve";
  }
  /* one short explainer per step (Tony: not wordy) — shown on the step that
     is glowing right now, and only there. */
  var HINTS = {
    who: "Booking for yourself, or for a friend?",
    treatment: "Tap a treatment — the price and time show right away.",
    variant: "Classic or Anti-Aging — tap one.",
    addon: "Tap the gold ones to add them — they pair with your treatment.",
    summary: "Check your visit, then pick a day.",
    date: "Pick a day — gold days have times; grey days are full or closed (Sundays).",
    time: "Pick a start time — the studio holds it while you pay.",
    details: "Your name, email and phone — your confirmation goes to your email.",
    option: "A $30 deposit holds your time — the balance is due at your visit.",
    reserve: "Tap Reserve — you pay securely by card, then you are booked in.",
    friend: "Add your friend, then your own details for the receipt."
  };
  function stepEl(k) {
    return { friend: friendNext() ? $("#" + friendNext()) : $("#step-who"), treatment: $("#step-treatment"), variant: $("#step-variant"), addon: $("#step-addons"), summary: $("#step-summary"),
      date: $("#step-date"), time: $("#step-time"), details: $("#step-details"), option: $("#step-option"), reserve: $(".reserve") }[k];
  }

  /* ---------- render ---------- */
  function render() {
    var T = totals(), next = nextStep();
    // who is it for
    var fr = S.who === "friend"; if (fr) S.option = "G"; else if (S.option === "G") S.option = null;
    $$(".who-card").forEach(function (c) { c.setAttribute("aria-checked", String(c.getAttribute("data-who") === S.who)); });
    $("#friendForm").hidden = !fr; $("#step-option").hidden = !fr ? false : true;
    $("#step-who").classList.toggle("done", fr ? !friendNext() : false);
    // main rows + variant
    $$(".row").forEach(function (r) { var on = S.main === r.getAttribute("data-id"); r.classList.toggle("sel", on); r.setAttribute("aria-pressed", String(on)); });
    $("#step-variant").hidden = S.main !== "the-works";
    $$(".chip").forEach(function (c) { var on = c.getAttribute("data-variant") === S.variant; c.classList.toggle("sel", on); c.setAttribute("aria-checked", String(on)); });
    // step 2: guided in-place add-ons — every offered add-on shows at once.
    // Compatible ones light gold with the reason they pair; incompatible
    // ones stay unlit with the reason; tap a lit one to add it, tap again
    // to remove it; tap a name for details in place.
    var f = $("#addonFlow");
    if (!S.main) f.innerHTML = '<p class="flow-wait">Start with a treatment above.</p>';
    else if (!mainReady()) f.innerHTML = '<p class="flow-wait">Choose Classic or Anti-Aging for The Works first.</p>';
    else {
      var q = queue(), h = "";
      var inc = included(); if (inc.length) h += '<p class="ao-included">✓ ' + esc(C.included[S.main].note) + '</p>';
      h += '<p class="ao-count">' + q.length + (q.length === 1 ? " add-on pairs" : " add-ons pair") + ' with this treatment — tap to add, tap again to remove.</p><div class="ao-grid">';
      q.forEach(function (id) {
        var a = I[id], st = statusOf(id), on = S.ans[id] === true, pop = id === popularId();
        h += '<div class="ao-pick-wrap"><button type="button" class="ao-pick' + (on ? " added" : "") + (pop ? " popular" : "") + '" data-toggle="' + id + '" aria-pressed="' + String(on) + '">' +
          thumb(a, "ao-thumb", 64) +
          '<span class="ao-main"><span class="ao-name">' + esc(a.name) + (pop ? ' <span class="ao-pop">Popular</span>' : "") + '</span>' +
          '<span class="ao-meta">+' + a.mins + ' min · +' + money(a.price) + '</span>' +
          '<span class="ao-why">' + esc(whyFor(id)) + '</span>' +
          (st.s === "check" ? '<span class="ao-check">⚑ ' + esc(st.why) + '.</span>' : "") +
          '<span class="ao-state">' + (on ? "Added ✓ — tap to remove" : "Tap to add") + '</span></span></button>' +
          '<details class="ao-more"><summary>Learn more</summary><p>' + esc(C.learn[id] || a.desc) + ' <a href="' + C.learnLinks[id] + '">Full details</a></p></details></div>';
      });
      h += '</div>';
      var bl = blocked(); if (bl.length) h += '<div class="ao-blocked">' + bl.map(function (id) { return '<div class="ao-off" aria-disabled="true"><span class="ao-dname">' + esc(I[id].name) + '</span><span class="ao-reason">' + esc(statusOf(id).why) + '</span></div>'; }).join("") + "</div>";
      h += '<button type="button" class="btn btn-gold" id="addonsDone">Continue — pick a day ↓' + (T.items.length ? ' · ' + T.items.map(function (i) { return i.name; }).join(" + ") + ' · ' + hm(T.mins) + ' · ' + pr(T, netTotal(T)) : '') + '</button>';
      f.innerHTML = h;
      if (window.IN2_WATCH_VIDEOS) window.IN2_WATCH_VIDEOS(f);
    }
    $("#step-treatment").classList.toggle("done", mainReady());
    $("#step-variant").classList.toggle("done", !!S.variant);
    $("#step-addons").classList.toggle("done", allAnswered());
    // step 3: summary
    var showSum = allAnswered();
    $("#step-summary").hidden = !showSum;
    $("#step-summary").classList.toggle("done", S.confirmed);
    if (showSum) $("#visitSummary").innerHTML = '<div class="sum-items">' + itemsHTML(T, "sum") + '</div><div class="sum-totals">' + totalsHTML(T, false) + "</div>";
    // booking
    $("#book").hidden = !S.confirmed;
    if (S.confirmed) {
      refreshMonth();
      renderCal(); renderSlots();
      $("#bookSel").innerHTML = '<p class="bs-over">Your selection</p><div class="bs-items">' + itemsHTML(T, "bs") + '</div>' + totalsHTML(T, true) +
        (S.date ? '<p class="bs-when">' + dateLabel() + (S.time ? " · " + S.time : "") + "</p>" : "") + '<button type="button" class="bs-edit" id="bsEdit">Change treatments</button>';
      $("#step-date").classList.toggle("done", !!S.date); $("#step-time").classList.toggle("done", !!S.time); $("#step-details").classList.toggle("done", detailsValid()); $("#step-option").classList.toggle("done", !!S.option);
      $("#step-details").hidden = fr;
      var gm = $("#gcodeMsg"); if (S.code) { var cr = creditAmt(T), left = Math.max(0, S.code.balance - cr); gm.hidden = false; gm.className = "gcode-msg ok"; gm.textContent = "Code " + S.code.code + " applied, −" + money(cr) + (left > 0 ? " · " + money(left) + " left on the code." : " · Code fully used."); } else if (!gm.classList.contains("bad")) gm.hidden = true;
      $$(".opt-card").forEach(function (c) { c.setAttribute("aria-checked", String(c.getAttribute("data-option") === S.option)); });
      var parts = [(S.who === "friend" && S.F.name ? "For " + S.F.name + ": " : "") + T.items.map(function (i) { return i.name; }).join(" + ")]; parts.push(hm(T.mins) + " · " + pr(T, netTotal(T))); if (S.date) parts.push(dateLabel()); if (S.time) parts.push(S.time);
      $("#reserveSum").textContent = parts.join(" · ");
      if (!submitting) $("#reserveBtn").textContent = S.option === "G" ? "Pay " + pr(T, Math.max(0, T.total - creditAmt(T))) + " and book it for " + (S.F.name || "my friend") : S.option === "A" ? "Pay $" + D.depositDollars + " deposit to hold this time" : "Reserve my time";
    }
    // running total: side panel (desktop, picker steps) + dock (phone)
    var tp = $("#totalPanel");
    tp.hidden = !S.main || S.confirmed;
    tp.classList.toggle("compact", showSum);
    $("#tpItems").innerHTML = showSum ? "" : itemsHTML(T, "tp");
    $("#tpTotals").innerHTML = totalsHTML(T, false);
    $("#tpGo").textContent = next === "summary" ? "Pick a day ↓" : "Next step ↓";
    $("#tpGo").hidden = next === "treatment";
    $("#dockSum").innerHTML = T.items.length ? '<b>' + pr(T, netTotal(T)) + '</b> · ' + (T.mins ? hm(T.mins) : "") + ' · ' + T.items.length + (T.items.length > 1 ? " items" : " item") : "Pick a treatment";
    $("#dockGo").textContent = next === "reserve" ? "Reserve →" : "Next ↓";
    // gold guide: the current step glows, and its one-line explainer shows
    $$(".glow-pick").forEach(function (e) { e.classList.remove("glow-pick"); });
    $$(".step-hint").forEach(function (e) { e.textContent = ""; });
    var el = stepEl(next); if (el) el.classList.add("glow-pick");
    var hintEl = $("#hint-" + (next === "addon" ? "addons" : next === "friend" ? "who" : next));
    if (hintEl && HINTS[next]) hintEl.textContent = HINTS[next];
    $("#dockGo").classList.toggle("pulse-btn", next === "reserve"); /* finish line: only Reserve glows */
    updateDock();
    totalFeedback(T);
  }

  /* ---------- total feedback: gold flash + ~400 ms count to the new total (no motion if reduced) ---------- */
  var prevTotal = null, countRaf = 0;
  function totalFeedback(T) {
    var cur = T.total, from = prevTotal; prevTotal = cur;
    var els = $$("#tpTotals .tt-big b, #dockSum b, #bookSel .tt-big b, #visitSummary .tt-big b");
    if (from === null || from === cur || RM.matches || !els.length) return;
    $$("#dockPick, #totalPanel, #bookSel, #step-summary").forEach(function (b) { b.classList.remove("tot-flash"); void b.offsetWidth; b.classList.add("tot-flash"); });
    cancelAnimationFrame(countRaf);
    var t0 = null, pre = T.from ? "from " : "";
    function tick(ts) {
      if (t0 === null) t0 = ts; var p = Math.min(1, (ts - t0) / 400), v = Math.round(from + (cur - from) * (1 - Math.pow(1 - p, 3)));
      els.forEach(function (e) { e.textContent = pre + money(v); });
      if (p < 1) countRaf = requestAnimationFrame(tick);
    }
    countRaf = requestAnimationFrame(tick);
  }

  /* ---------- guided scrolling ---------- */
  function hdr() { var h = $("header.site"); return h ? h.getBoundingClientRect().height : 72; }
  function goTo(el, force) {
    if (!el) return;
    var r = el.getBoundingClientRect(), top = hdr() + 12, dock = window.innerWidth < 1024 ? 96 : 16;
    var fits = r.top >= top && r.top < window.innerHeight * 0.45 && r.bottom <= window.innerHeight - dock;
    if (!fits || force) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top), behavior: RM.matches ? "auto" : "smooth" });
    /* restart the gold glow-pulse on the target so it's clear why the screen moved; it keeps pulsing until they choose */
    el.classList.remove("glow-pick"); void el.offsetWidth; el.classList.add("glow-pick");
  }
  function advanceForce() { render(); var k = nextStep(); setTimeout(function () { goTo(stepEl(k), true); }, RM.matches ? 0 : 140); }
  function advance() { render(); var k = nextStep(); setTimeout(function () { goTo(stepEl(k)); }, RM.matches ? 0 : 140); }

  var toastT;
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 3800); }
  function flash(el) { if (!el) return; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }

  /* ---------- interactions (one delegated handler) ---------- */
  function resetFrom(main) { S.ans = {}; S.addonsDone = false; S.confirmed = false; S.time = null; if (main !== "the-works") S.variant = null; }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button,summary"); if (!t) return;
    if (t.classList.contains("row") && t.hasAttribute("data-id")) {
      var id = t.getAttribute("data-id");
      if (S.main === id) { S.main = null; S.variant = null; resetFrom(null); render(); return; }
      S.main = id; resetFrom(id); flash(t); advance(); return;
    }
    if (t.hasAttribute("data-variant")) { S.variant = t.getAttribute("data-variant"); S.ans = {}; S.addonsDone = false; S.confirmed = false; advance(); return; }
    if (t.hasAttribute("data-toggle")) { var tg = t.getAttribute("data-toggle"); S.ans[tg] = S.ans[tg] !== true; render(); return; }
    if (t.id === "addonsDone") { S.addonsDone = true; advanceForce(); return; }
    if (t.hasAttribute("data-remove")) {
      var k = t.getAttribute("data-remove");
      if (k === "main") { S.main = null; S.variant = null; resetFrom(null); render(); goTo($("#step-treatment"), true); return; }
      S.ans[k] = false; render(); return;
    }
    if (t.hasAttribute("data-who")) { S.who = t.getAttribute("data-who"); render(); if (S.who === "friend") { var fe = friendNext() && $("#" + friendNext()); setTimeout(function () { goTo(fe || $("#step-who"), true); if (fe) fe.focus({ preventScroll: true }); }, 140); } else advance(); return; }
    if (t.id === "gcodeApply") { applyCode(); return; }
    if (t.id === "gcodeRemove") { S.code = null; $("#gcodeIn").value = ""; render(); return; }
    if ((t.id === "toBook" || t.hasAttribute("data-day") || t.hasAttribute("data-time") || t.hasAttribute("data-option")) && guardFriend()) return;
    if (t.id === "toBook") { S.confirmed = true; advanceForce(); return; }
    if (t.id === "bsEdit") { S.confirmed = false; S.addonsDone = false; render(); goTo($("#step-addons"), true); return; }
    if (t.hasAttribute("data-nav")) { var nv = new Date(Date.UTC(VIEW.y, VIEW.m + (+t.getAttribute("data-nav")), 1)); var cand = { y: nv.getUTCFullYear(), m: nv.getUTCMonth() };
      if (monthIdx(cand) >= monthIdx(NOW) && monthIdx(cand) <= monthIdx(NOW) + MAXAHEAD) { VIEW = cand; renderCal(); refreshMonth(); } return; }
    if (t.hasAttribute("data-day")) { $("#bookDone").hidden = true; S.booked = false; S.date = t.getAttribute("data-day"); S.time = null; advanceForce(); return; }
    if (t.hasAttribute("data-time")) { $("#bookDone").hidden = true; S.time = t.getAttribute("data-time"); advanceForce(); return; }
    if (t.hasAttribute("data-option")) {
      var opt = t.getAttribute("data-option");
      if (opt === "B") { location.href = "/consultation/"; return; } /* video consultation first: its own flow, its own calendar */
      if (!S.date || !S.time) { render(); goTo(stepEl(!S.date ? "date" : "time"), true); return; }
      S.option = opt; advance(); return;
    }
    if (t.id === "tpGo" || t.id === "dockGo") { var nx = nextStep(); if (nx === "reserve") return reserve(); if (nx === "summary") { S.confirmed = true; advanceForce(); return; } if (nx === "addon") { S.addonsDone = true; advanceForce(); return; } render(); goTo(stepEl(nx), true); return; }
    if (t.id === "reserveBtn") return reserve();
  });
  /* friend details missing: back to the first missing field, gold glow, cursor in it. No toast. */
  function guardFriend() { var k = friendNext(); if (!k) return false; render(); var el = $("#" + k); goTo(el, true); setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) {} }, RM.matches ? 0 : 350); return true; }
  /* your details missing: same treatment as friend details. */
  function guardDetails() { var k = detailsNext(); if (!k) return false; render(); var el = $("#" + k); goTo(el, true); setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) {} }, RM.matches ? 0 : 350); return true; }
  /* gift codes: checked against the real server (GET /api/gift?code=) — the
     balance is validated and deducted server-side, on payment. */
  function applyCode() {
    var v = $("#gcodeIn").value.trim().toUpperCase(), gm = $("#gcodeMsg");
    if (!v) { S.code = null; gm.hidden = false; gm.className = "gcode-msg bad"; gm.textContent = "Type your code first."; $("#gcodeIn").classList.add("bad"); render(); $("#gcodeIn").focus({ preventScroll: true }); return; }
    gm.hidden = false; gm.className = "gcode-msg"; gm.textContent = "Checking your code…";
    fetch("/api/gift?code=" + encodeURIComponent(v), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !(res.j.balanceCents > 0)) { S.code = null; gm.hidden = false; gm.className = "gcode-msg bad"; gm.textContent = "We can't find that code."; $("#gcodeIn").classList.add("bad"); render(); $("#gcodeIn").focus({ preventScroll: true }); return; }
        S.code = { code: res.j.code, balance: res.j.balanceCents / 100 }; gm.classList.remove("bad"); $("#gcodeIn").classList.remove("bad"); render();
      })
      .catch(function () { S.code = null; gm.hidden = false; gm.className = "gcode-msg bad"; gm.textContent = "We couldn't check that code — try again."; render(); });
  }
  function reserve() {
    if (guardFriend()) return;
    if (guardDetails()) return;
    var nx = nextStep(); if (nx !== "reserve") { render(); goTo(stepEl(nx), true); return; }
    /* POST /api/book — the server validates the slot + price, records the
       booking and answers with a Stripe Checkout link. Deposit ($30) for a
       booking for yourself; a booking for a friend is paid in full.
       The confirmation email + studio notification fire on payment. */
    var T = totals(), friend = S.who === "friend", F = S.F, when = dateLabel() + " · " + S.time;
    if (submitting) return; /* one click submits — later clicks while the
      request is in flight are ignored, not queued as second bookings */
    submitting = true;
    var btn = $("#reserveBtn"); btn.disabled = true; btn.textContent = "Taking you to secure payment…";
    var payload = {
      service: apiService(), addons: apiAddons(), date: S.date, time: S.time, type: "regular",
      name: friend ? F.yname : S.D.name, email: friend ? F.yemail : S.D.email, phone: friend ? F.yphone : S.D.phone,
      payMode: friend ? "full" : "deposit", who: friend ? "friend" : "me", forWhom: friend ? "friend" : "me",
      giftCode: S.code ? S.code.code : "",
      website: "", formLoadedAt: String(LOADED_AT),
    };
    if (friend) {
      payload.friend = { name: F.name, phone: F.phone, email: F.email || "", msg: F.msg || "" };
      payload.booker = { name: F.yname, email: F.yemail, phone: F.yphone };
      payload.guestName = F.name; payload.guestPhone = F.phone; payload.guestEmail = F.email || "";
      payload.friendMessage = F.msg || ""; /* the payer's short note — quoted in the friend-booked email + receipt */
    }
    if (S.referredBy) payload.referredBy = S.referredBy;
    fetch("/api/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      if (!res.ok || (!res.j.url && !res.j.paid)) { throw new Error((res.j && res.j.error) || "Booking did not go through."); }
      if (res.j.url) { location.href = res.j.url; return; } /* Stripe Checkout — paying completes the booking */
      /* Paid in full by a gift code — no checkout needed. The booking is
         recorded server-side; the confirmation email is on its way. */
      submitting = false; btn.disabled = false;
      S.booked = true; render();
      var done = $("#bookDone"); done.hidden = false;
      done.textContent = "You're booked in for " + when + " — your confirmation email is on its way.";
      setTimeout(function () { goTo(done, true); }, RM.matches ? 0 : 140);
    }).catch(function (err) {
      submitting = false; btn.disabled = false; render();
      toast(err.message || "Something went wrong — please try again.");
    });
  }
  /* skipping past the day / time step (scrolling down beyond it) brings them back to it, gold cards pulsing */
  var skipT, lastY = window.scrollY;
  window.addEventListener("scroll", function () {
    var down = window.scrollY > lastY; lastY = window.scrollY; clearTimeout(skipT);
    if (!down || $("#book").hidden || !S.confirmed || S.booked) return; /* after a booking, the confirmation stays where it is */
    skipT = setTimeout(function () {
      var nx = nextStep(); if (nx !== "date" && nx !== "time") return;
      var el = stepEl(nx), r = el.getBoundingClientRect(), bk = $("#book").getBoundingClientRect();
      if (r.bottom < hdr() + 8 && bk.bottom > window.innerHeight * 0.3) { render(); goTo(el, true); }
    }, 220);
  }, { passive: true });

  /* ---------- friend fields ---------- */
  [["#fName", "name"], ["#fPhone", "phone"], ["#fEmail", "email"], ["#fMsg", "msg"], ["#yName", "yname"], ["#yEmail", "yemail"], ["#yPhone", "yphone"]].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener("input", function () { S.F[p[1]] = el.value.trim(); render(); });
    el.addEventListener("change", function () { S.F[p[1]] = el.value.trim(); if (p[1] === "msg") { render(); return; } advance(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" && el.tagName !== "TEXTAREA") { e.preventDefault(); S.F[p[1]] = el.value.trim(); el.blur(); advance(); var n = friendNext(); if (n) setTimeout(function () { $("#" + n).focus({ preventScroll: true }); }, 200); } });
  });
  /* ---------- your details (booking for yourself) ---------- */
  [["#mName", "name"], ["#mEmail", "email"], ["#mPhone", "phone"]].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener("input", function () { S.D[p[1]] = el.value.trim(); render(); });
    el.addEventListener("change", function () { S.D[p[1]] = el.value.trim(); advance(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); S.D[p[1]] = el.value.trim(); el.blur(); advance(); var n = detailsNext(); if (n) setTimeout(function () { $("#" + n).focus({ preventScroll: true }); }, 200); } });
  });
  $("#gcodeIn").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyCode(); } });
  $("#gcodeIn").addEventListener("input", function () { this.classList.remove("bad"); var gm = $("#gcodeMsg"); if (gm.classList.contains("bad")) { gm.classList.remove("bad"); gm.hidden = !S.code; } });
  /* arriving from /gift/ "Book a time for them": /?for=friend#services preselects A friend */
  if (/[?&]for=friend\b/.test(location.search)) { S.who = "friend"; render(); setTimeout(function () { var el = $("#" + friendNext()); if (el) { goTo(el, true); el.focus({ preventScroll: true }); } }, 500); }

  /* ---------- ?service=<id> deep link: a service or town page Book button
     lands on the picker with that service already chosen. Add-on ids
     (nano-needling) preselect a Classic Facial with that add-on on, since
     add-ons are picked after a treatment; the client can change the facial. */
  var SVC_ALIAS = { "nano-needling": "needling", "microneedling": "needling" };
  function preselectService(raw) {
    var id = SVC_ALIAS[raw] || raw;
    if (id === "combo-classic" || id === "combo-anti") { S.main = "the-works"; S.variant = id; return true; }
    if (!I[id]) return false;
    if (I[id].group === "addons") { S.main = "classic-facial"; S.ans[id] = true; }
    else S.main = id;
    S.addonsDone = false; S.confirmed = false;
    return true;
  }
  var svcParam = (new URLSearchParams(location.search).get("service") || "").toLowerCase().trim();
  if (svcParam && preselectService(svcParam)) {
    render();
    setTimeout(function () { goTo(stepEl(nextStep()), true); }, 500);
  }

  /* ---------- dock (phone) ---------- */
  function inZone() { var s = $("#services").getBoundingClientRect(), b = $("#book"), bb = b.hidden ? s : b.getBoundingClientRect(); return s.top < window.innerHeight * 0.6 && bb.bottom > window.innerHeight * 0.3; }
  function updateDock() {
    if (window.IN2_LOCKED) return;
    var dock = $("#dock"), z = inZone() && !!S.main;
    dock.classList.toggle("mode-pick", z); dock.classList.toggle("show", z);
    var rv = $(".reserve").getBoundingClientRect();
    dock.classList.toggle("hide", (!$("#book").hidden && rv.top < window.innerHeight - 8 && rv.bottom > 0) || document.body.classList.contains("dock-off"));
    var tp = $("#totalPanel"); if (tp) tp.classList.toggle("away", !inZone());
    if (window.IN2_PLACE_TOTOP) window.IN2_PLACE_TOTOP();
  }
  window.addEventListener("scroll", updateDock, { passive: true });
  window.addEventListener("resize", updateDock);
  render();
  window.IN2_STATE = S; window.IN2_RENDER = render; /* for the layout tests / demos */
})();
