/* In2Skin: "Rather talk?" help card (booking, gift and video consult) .
   No network calls. Sample only: nothing is bought or charged. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var pa = $(".f-line a[href^='tel:']") || $("a[href^='tel:']");
  var PHONE = pa ? pa.getAttribute("href") : "tel:+12892124124", PHONE_TXT = pa && /\d/.test(pa.textContent) && pa.className.indexOf("header-call") < 0 ? pa.textContent : "(289) 212-4124";
  var KEY = "in2-call-card-shown";
  var seen = false; try { seen = !!sessionStorage.getItem(KEY); } catch (e) {}

  function hdr() { var h = $("header.site"); return h ? h.getBoundingClientRect().height : 72; }
  /* bring a piece into view, below the header and clear of the dock */
  function bring(el) {
    if (!el) return;
    var r = el.getBoundingClientRect(), top = hdr() + 14, bottomGap = window.innerWidth < 1024 ? 96 : 24;
    if (r.top >= top && r.bottom <= window.innerHeight - bottomGap) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top), behavior: RM.matches ? "auto" : "smooth" });
  }
  window.IN2_BRING = bring;

  /* gift flow lives in js/gift.js */
  var gf = $("#giftFlow");

  /* ---------- hesitation help card ---------- */
  var region = $("#services") || gf || $("#cx1") && $("#content");
  if (!region) return;
  var card = null, timer = null, inView = false, shown = false;
  function build() {
    card = document.createElement("aside"); card.className = "help-card"; card.setAttribute("aria-label", "Call the studio");
    card.innerHTML = '<span class="help-q">Rather talk?</span><a class="help-call" href="' + PHONE + '">Call the studio</a><button type="button" class="help-x" aria-label="Close">×</button>';
    document.body.appendChild(card);
    card.querySelector(".help-x").addEventListener("click", function () { hide(); });
  }
  function place() {
    if (!card) return;
    var low = window.innerHeight, wide = window.innerWidth >= 861;
    if (!wide) {
      [$("#dockPick"), $(".dock-book"), $("#toTop")].forEach(function (el) {
        if (!el) return; var cs = getComputedStyle(el); if (cs.display === "none" || el.hidden) return;
        var r = el.getBoundingClientRect(); if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) low = Math.min(low, r.top);
      });
    }
    card.style.left = wide ? "24px" : "78px"; card.style.right = wide ? "auto" : "12px"; card.style.bottom = (window.innerHeight - low + (wide ? 90 : 12)) + "px";
  }
  function show() {
    if (shown || seen) return; shown = true; seen = true; try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    build(); place(); requestAnimationFrame(function () { card.classList.add("on"); });
    window.addEventListener("scroll", function () { if (!window.IN2_LOCKED) place(); }, { passive: true }); window.addEventListener("resize", place);
  }
  function hide() {
    if (!card) return; card.classList.remove("on");
    window.removeEventListener("scroll", place); window.removeEventListener("resize", place);
    var c = card; card = null; setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 400);
  }
  function arm() { clearTimeout(timer); if (!seen && !shown && inView) timer = setTimeout(show, 20000); }
  window.IN2_HELP_ARM = arm;
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { inView = es[0].isIntersecting; arm(); }, { threshold: 0.15 }).observe(region);
  else { inView = true; arm(); }
  ["pointerdown", "keydown", "input", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (card && !card.contains(e.target) && ev !== "keydown") hide();
      arm();
    }, { passive: true, capture: true });
  });
})();
