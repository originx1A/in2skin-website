/* In2Skin gift certificate flow (preview): amount or treatment -> recipient + optional message -> how to send ->
   buyer details -> Continue -> "Pay $X" -> confirmation card (Print / Send).
   Gold glow = the next missing piece (body[data-gift-next], styled in css/style.css). Skipping ahead scrolls back to it. No toasts. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  if (!$("#giftFlow")) return;
  var RM = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var G = { amt: null, tre: null, other: false, name: "", rphone: "", msg: "", del: null, remail: "", when: "now", date: "", buyer: "", bemail: "", bphone: "", paying: false, done: false };
  function PHONE(v) { return String(v || "").replace(/\D/g, "").length >= 10; }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function hdr() { var h = $("header.site"); return h ? h.getBoundingClientRect().height : 72; }
  function go(el) { /* always bring the target to the top, below the header */
    if (!el) return; var r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - hdr() - 14), behavior: RM.matches ? "auto" : "smooth" });
  }
  function todayISO() {
    try { var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + "-" + p.month + "-" + p.day; }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function dateWords(iso) { var p = iso.split("-"); return MON[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function money(n) { return "$" + n; }

  /* the next thing still needed, in order; each maps to the element to scroll to */
  function next() {
    if (!G.amt) return "amount";
    if (!G.name) return "name";
    if (!PHONE(G.rphone)) return "rphone";
    if (!G.del) return "delivery";
    if (G.del === "email") { if (!EMAIL.test(G.remail)) return "remail"; if (G.when === "date" && !(G.date && G.date >= todayISO())) return "rdate"; }
    if (!G.buyer) return "buyer";
    if (!EMAIL.test(G.bemail)) return "bemail";
    if (!PHONE(G.bphone)) return "bphone";
    if (!G.paying) return "buy";
    if (!G.done) return "pay";
    return "done";
  }
  var TARGET = { amount: "#gf1", name: "#gf2", rphone: "#gf2", delivery: "#gf3", remail: "#giftEmailBox", rdate: "#giftDateWrap", buyer: "#gf4", bemail: "#gf4", bphone: "#gf4", buy: "#giftBuy", pay: "#gfPay", done: "#gfDone" };
  var FOCUS = { name: "#giftName", rphone: "#giftRphone", bphone: "#giftBphone", remail: "#giftRemail", rdate: "#giftDate", buyer: "#giftBuyer", bemail: "#giftBemail" };

  function paint() {
    var n = next(); document.body.setAttribute("data-gift-next", n);
    $$(".gift-amt").forEach(function (b) { b.setAttribute("aria-checked", String(!G.tre && !G.other && G.amt === +b.getAttribute("data-amt"))); });
    $$(".gift-tre").forEach(function (b) {
      var on = b.hasAttribute("data-other") ? G.other : (G.tre === b.getAttribute("data-tre")); b.setAttribute("aria-checked", String(on));
      if (b.hasAttribute("data-other")) $("b", b).textContent = G.other && G.amt ? money(G.amt) : "$";
    });
    $("#giftOtherWrap").hidden = !G.other;
    $$(".gift-dcard").forEach(function (b) { b.setAttribute("aria-checked", String(G.del === b.getAttribute("data-del"))); });
    $("#giftEmailBox").hidden = G.del !== "email";
    $$(".gift-chip").forEach(function (b) { b.setAttribute("aria-checked", String(G.when === b.getAttribute("data-when"))); });
    $("#giftDateWrap").hidden = G.when !== "date";
    ["gf1", "gf2", "gf3", "gf4"].forEach(function (id, i) {
      var d = [!!G.amt, !!G.name && PHONE(G.rphone), !!G.del && (G.del !== "email" || (EMAIL.test(G.remail) && (G.when !== "date" || !!G.date))), !!G.buyer && EMAIL.test(G.bemail) && PHONE(G.bphone)][i];
      $("#" + id).classList.toggle("done", d);
    });
    $("#giftSum").textContent = G.amt ? (G.tre ? G.tre + " voucher, " : "") + money(G.amt) + (G.name ? " for " + G.name : "") : "";
    $("#giftBuy").textContent = G.paying ? "Back to my gift" : "Continue";
    $("#giftBuy").hidden = G.paying;
    $("#gfPay").hidden = !G.paying || G.done; $("#gfDone").hidden = !G.done;
    if (G.paying && !G.done) {
      $("#gpLines").innerHTML = '<div><span>' + (G.tre ? esc(G.tre) + " voucher" : "Gift certificate") + '</span><b>' + money(G.amt) + '</b></div>' +
        '<div><span>For</span><b>' + esc(G.name) + '</b></div>' +
        '<div><span>' + (G.del === "email" ? "Emailed to them " + (G.when === "date" ? "on " + dateWords(G.date) : "right away") : "Sent to you to print") + '</span><b></b></div>';
      $("#gpTotal").textContent = money(G.amt); $("#giftPay").textContent = "Pay " + money(G.amt);
    }
  }
  function advance() { paint(); var n = next(); setTimeout(function () { go($(TARGET[n])); }, RM.matches ? 0 : 140); }

  /* ---- amount / treatment ---- */
  $("#giftAmts").addEventListener("click", function (e) { var b = e.target.closest(".gift-amt"); if (!b) return; G.amt = +b.getAttribute("data-amt"); G.tre = null; G.other = false; advance(); });
  $("#giftTres").addEventListener("click", function (e) {
    var b = e.target.closest(".gift-tre"); if (!b) return;
    if (b.hasAttribute("data-other")) { G.other = true; G.tre = null; var v = +$("#giftOther").value; G.amt = v >= 10 && v <= 500 ? Math.round(v) : null; paint(); setTimeout(function () { $("#giftOther").focus({ preventScroll: true }); go($("#giftOtherWrap")); }, 120); return; }
    G.amt = +b.getAttribute("data-amt"); G.tre = b.getAttribute("data-tre"); G.other = false; advance();
  });
  function otherSet() { var v = +$("#giftOther").value; G.amt = v >= 10 && v <= 500 ? Math.round(v) : null; paint(); }
  $("#giftOther").addEventListener("input", otherSet);
  $("#giftOther").addEventListener("change", function () { otherSet(); if (G.amt) advance(); });
  $("#giftOther").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });

  /* ---- text fields: update live, move on when the field is finished (Enter / leaving it) ---- */
  function bindText(sel, key, validOK) {
    var el = $(sel);
    el.addEventListener("input", function () { G[key] = el.value.trim(); paint(); });
    var fin = function () { G[key] = el.value.trim(); if (validOK(G[key])) advance(); else paint(); };
    el.addEventListener("change", fin);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); el.blur(); fin(); } });
  }
  var nonEmpty = function (v) { return !!v; }, isEmail = function (v) { return EMAIL.test(v); };
  bindText("#giftName", "name", nonEmpty); bindText("#giftRphone", "rphone", PHONE); bindText("#giftBphone", "bphone", PHONE); bindText("#giftRemail", "remail", isEmail); bindText("#giftBuyer", "buyer", nonEmpty); bindText("#giftBemail", "bemail", isEmail);
  $("#giftMsg").addEventListener("input", function () { G.msg = this.value.trim(); });
  $("#giftDate").setAttribute("min", todayISO());
  $("#giftDate").addEventListener("change", function () { G.date = this.value; if (G.date && G.date >= todayISO()) advance(); else paint(); });

  /* ---- how to send ---- */
  $("#giftDel").addEventListener("click", function (e) { var b = e.target.closest(".gift-dcard"); if (!b) return; G.del = b.getAttribute("data-del"); advance(); });
  $("#giftWhen").addEventListener("click", function (e) {
    var b = e.target.closest(".gift-chip"); if (!b) return; G.when = b.getAttribute("data-when"); paint();
    if (G.when === "date") setTimeout(function () { $("#giftDate").focus({ preventScroll: true }); go($("#giftDateWrap")); }, 120); else advance();
  });

  /* ---- Continue: back to whatever is missing, else on to Pay ---- */
  function toMissing(n) {
    paint(); var f = FOCUS[n], t = $(TARGET[n]); go(t);
    if (f && n !== "rdate") setTimeout(function () { try { $(f).focus({ preventScroll: true }); } catch (e) {} }, RM.matches ? 0 : 350);
  }
  $("#giftBuy").addEventListener("click", function () {
    var n = next(); if (n !== "buy") { toMissing(n); return; }
    G.paying = true; paint(); setTimeout(function () { go($("#gfPay")); }, RM.matches ? 0 : 140);
  });

  /* ---- Pay ----
     COOPER: the real payment plugs in here. Replace createPreviewOrder() with
       fetch("/api/gift-buy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) })
         .then(r => r.json()).then(({ url }) => { location.href = url; })     // Stripe Checkout session URL
     `order` (built below) = { amount, treatment|null, toName, toPhone, message, delivery: "email"|"print", toEmail, sendOn: "now"|"YYYY-MM-DD", buyerName, buyerEmail, buyerPhone } (toEmail only when delivery is "email").
     Server side: create the Stripe Checkout session (CAD), and on checkout.session.completed generate the IN2-XXXX code, store it,
     email the certificate with emails/gift-code.html (to toEmail on sendOn, or to buyerEmail to print) and the buyer a receipt (emails/payer-receipt.html), then redirect back to /gift/?paid=<session>
     and render the confirmation card from the stored gift. Until then this preview invents the code in the browser and charges nothing. */
  function buildOrder() {
    return { amount: G.amt, treatment: G.tre, toName: G.name, toPhone: G.rphone, message: G.msg, delivery: G.del, toEmail: G.del === "email" ? G.remail : "",
      sendOn: G.del === "email" ? (G.when === "date" ? G.date : "now") : "", buyerName: G.buyer, buyerEmail: G.bemail, buyerPhone: G.bphone };
  }
  function createPreviewOrder(order) {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", c = "IN2-"; for (var i = 0; i < 4; i++) c += A.charAt(Math.floor(Math.random() * A.length));
    return { code: c, order: order };
  }
  var LAST = null;
  $("#giftPay").addEventListener("click", function () {
    if (next() !== "pay") { toMissing(next()); return; }
    LAST = createPreviewOrder(buildOrder()); var o = LAST.order;
    $("#gcAmt").textContent = o.treatment ? o.treatment : money(o.amount);
    $("#gcVal").textContent = o.treatment ? "Value " + money(o.amount) : "To spend on any treatment";
    $("#gcTo").textContent = o.toName; $("#gcFrom").textContent = o.buyerName;
    $("#gcMsg").textContent = o.message ? "“" + o.message + "”" : ""; $("#gcMsg").hidden = !o.message;
    $("#gcCode").textContent = LAST.code;
    $("#gdStatus").textContent = o.delivery === "email"
      ? "We'll email it to " + o.toEmail + (o.sendOn === "now" ? " right away." : " on " + dateWords(o.sendOn) + ".") + " A receipt is on its way to " + o.buyerEmail + "."
      : "It's on its way to " + o.buyerEmail + ", ready to print.";
    var body = "Hi " + o.toName + ",\n\n" + o.buyerName + " has given you a gift certificate for In2Skin in Bolton: " + (o.treatment ? o.treatment + " (value " + money(o.amount) + ")" : money(o.amount)) + ".\n" +
      (o.message ? "\n\"" + o.message + "\"\n" : "") + "\nYour code: " + LAST.code + "\nRedeem it when you book at boltonfacials.com or call (289) 212-4124.\n";
    $("#gdSend").setAttribute("href", "mailto:" + encodeURIComponent(o.toEmail || "").replace("%40", "@") + "?subject=" + encodeURIComponent("A gift for you from " + o.buyerName) + "&body=" + encodeURIComponent(body));
    /* preview only: remember the code in this browser so the booking pay step can apply it (COOPER: replaced by the real code store + POST /api/gift-redeem) */
    try { var gl = JSON.parse(localStorage.getItem("in2-gifts-v1")) || {}; gl[LAST.code] = { amount: o.amount, balance: o.amount, to: o.toName, toPhone: o.toPhone, toEmail: o.toEmail, from: o.buyerName, fromEmail: o.buyerEmail, fromPhone: o.buyerPhone }; localStorage.setItem("in2-gifts-v1", JSON.stringify(gl)); } catch (e) {}
    G.done = true; paint(); setTimeout(function () { go($("#gfDone")); }, RM.matches ? 0 : 140);
  });
  $("#gdPrint").addEventListener("click", function () { window.print(); });

  paint();
})();
