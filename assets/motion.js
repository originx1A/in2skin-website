// In2Skin motion.js — tiny ambient layer. No assets, no network.
// 1) Reveal-on-scroll: adds .in to .reveal elements as they enter view.
// 2) Ambient canvas: slow-drifting soft gold/sage light orbs behind the
//    hero (and any [data-ambient] section). Pauses off-screen and when the
//    tab is hidden. Disabled entirely for prefers-reduced-motion.
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- 1) reveal on scroll ----
  var revealEls = document.querySelectorAll(".reveal");
  if (!reduceMotion && "IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  // ---- 2) ambient light orbs ----
  if (reduceMotion) return;
  var hosts = document.querySelectorAll("[data-ambient]");
  if (!hosts.length || !document.createElement("canvas").getContext) return;

  hosts.forEach(function (host) {
    var canvas = document.createElement("canvas");
    canvas.className = "ambient-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.insertBefore(canvas, host.firstChild);
    var ctx = canvas.getContext("2d");
    var orbs = [];
    var running = false;
    var visible = true;

    function resize() {
      var r = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width));
      canvas.height = Math.max(1, Math.floor(r.height));
    }
    function seed() {
      orbs = [];
      var n = Math.max(4, Math.min(9, Math.floor(canvas.width / 220)));
      for (var i = 0; i < n; i++) {
        orbs.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: 40 + Math.random() * 90,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.08,
          hue: Math.random() < 0.5 ? "176,141,79" : "94,114,99",
          a: 0.05 + Math.random() * 0.07,
        });
      }
    }
    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      orbs.forEach(function (o) {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r) o.x = canvas.width + o.r;
        if (o.x > canvas.width + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = canvas.height + o.r;
        if (o.y > canvas.height + o.r) o.y = -o.r;
        var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, "rgba(" + o.hue + "," + o.a + ")");
        g.addColorStop(1, "rgba(" + o.hue + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      });
      requestAnimationFrame(frame);
    }
    function start() { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(frame); } }
    function stop() { running = false; }

    resize(); seed(); start();
    window.addEventListener("resize", function () { resize(); seed(); });
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        visible ? start() : stop();
      }, { threshold: 0 }).observe(host);
    }
  });
})();
