/* In2Skin prototype — shared shell: header dropdowns, mobile menu, hero video. Used by every page. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  /* ---------- header: dropdowns + mobile menu ---------- */
  var drops = $$(".drop");
  function closeDrops(except) {
    drops.forEach(function (d) { if (d !== except) { d.classList.remove("open"); $(".navlink", d).setAttribute("aria-expanded", "false"); } });
  }
  drops.forEach(function (d) {
    var b = $(".navlink", d);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !d.classList.contains("open");
      closeDrops(d); d.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open));
    });
  });
  document.addEventListener("click", function () { closeDrops(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeDrops(); setMenu(false); } });
  var burger = $("#burger"), mm = $("#mobileMenu");
  function setMenu(open) { mm.hidden = !open; burger.setAttribute("aria-expanded", String(open)); }
  burger.addEventListener("click", function (e) { e.stopPropagation(); setMenu(mm.hidden); });
  $$("a", mm).forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
  window.addEventListener("resize", function () { if (window.innerWidth >= 1280) setMenu(false); });

  /* ---------- videos: hero autoplays muted + looping (no control); small clips play only while on screen.
     Reduced motion or data-saver: nothing plays, the poster image shows. ---------- */
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator.connection && navigator.connection.saveData);
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  var vio = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting && !still) play(e.target); else e.target.pause(); });
  }, { threshold: 0.2 }) : null;
  window.IN2_WATCH_VIDEOS = function (root) {
    $$("[data-lazy-video]", root || document).forEach(function (v) { if (v._watched) return; v._watched = true; v.muted = true; if (vio) vio.observe(v); else if (!still) play(v); });
  };
  var hv = $("#heroVideo");
  if (hv) { hv.muted = true; if (!still) play(hv); if (vio) vio.observe(hv); }
  /* reduced motion / data-saver: the autoplay attribute must not start anything either; the poster stays */
  if (still) $$("video[autoplay]").forEach(function (v) { v.autoplay = false; v.pause(); });
  window.IN2_WATCH_VIDEOS();

  /* ---------- phone dock: step aside while the footer or the contact list (which show the same phone/booking info) is on screen ---------- */
  var dockHide = $$(".site-foot, .contact-list");
  function dockWatch() {
    if (window.IN2_LOCKED) return; /* chat open: page is frozen, keep floating UI as it was */
    var off = dockHide.some(function (el) { var r = el.getBoundingClientRect(); return r.top < window.innerHeight - 8 && r.bottom > 0; });
    /* at the top of the page the header Book button is right there; the floating pill appears once you scroll */
    if (window.scrollY < window.innerHeight * 0.5 && !document.querySelector(".dock.mode-pick")) off = true;
    document.body.classList.toggle("dock-off", off);
    /* the floating Book button is redundant while a booking flow (picker or video consult) is on screen */
    var on = $$("#services, .cx-step").some(function (el) { var r = el.getBoundingClientRect(); return r.top < window.innerHeight - 8 && r.bottom > 8; });
    document.body.classList.toggle("book-on", on);
  }
  window.addEventListener("scroll", dockWatch, { passive: true });
  window.addEventListener("resize", dockWatch);
  window.addEventListener("load", dockWatch);
  dockWatch();

  /* ---------- back to top: after the first screen; sits above the phone running-total bar ---------- */
  var tt = document.getElementById("toTop");
  if (tt) {
    var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var place = function () {
      if (window.IN2_LOCKED) return;
      tt.hidden = window.scrollY < window.innerHeight;
      var lift = 16, pick = document.getElementById("dockPick");
      if (pick) { var r = pick.getBoundingClientRect(); if (r.height && getComputedStyle(pick).display !== "none" && r.top < window.innerHeight) lift = Math.max(lift, window.innerHeight - r.top + 12); }
      tt.style.bottom = "calc(" + lift + "px + env(safe-area-inset-bottom))";
    };
    tt.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: rm ? "auto" : "smooth" }); tt.blur(); });
    window.addEventListener("scroll", place, { passive: true }); window.addEventListener("resize", place); window.addEventListener("load", place);
    window.IN2_PLACE_TOTOP = place; place();
  }
})();
