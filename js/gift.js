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
  /* one click submits (Nov 20, 2026): while the payment request is in
     flight, paint() never resets the Pay button's label and later clicks
     are ignored — the button must not look idle while swallowing clicks. */
  var submitting = false;
  /* Where the gift is redeemed (Nov 20, 2026): the live site reads as
     boltonfacials.com; a preview shows its own host. */
  function siteLabel() {
    var h = location.host;
    return (h === "www.boltonfacials.com" || h === "boltonfacials.com") ? "boltonfacials.com" : h;
  }
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
      $("#gpTotal").textContent = money(G.amt); if (!submitting) $("#giftPay").textContent = "Pay " + money(G.amt);
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
     Real payment: POST /api/gift-buy with the order below, then Stripe
     Checkout. After payment Stripe returns to /gift/?paid=<session> and
     the confirmation card renders from GET /api/gift?session_id= — the
     code is made server-side, never in this browser. No code is stored
     in this browser at all: the booking page checks codes against the
     server (GET /api/gift?code=).
     `order` = { amount, treatment|null, toName, toPhone, message, delivery: "email"|"print", toEmail, sendOn: "now"|"YYYY-MM-DD", buyerName, buyerEmail, buyerPhone } (toEmail only when delivery is "email").
     Server side: a treatment NAME maps to a voucher (service id +
     add-ons, priced by the server); an amount maps to a certificate.
     Print delivery needs no recipient email — the certificate goes to
     the buyer to print. A future sendOn holds the certificate email
     until that date; the buyer receipt still goes out at payment. */
  function buildOrder() {
    return { amount: G.amt, treatment: G.tre, toName: G.name, toPhone: G.rphone, message: G.msg, delivery: G.del, toEmail: G.del === "email" ? G.remail : "",
      sendOn: G.del === "email" ? (G.when === "date" ? G.date : "now") : "", buyerName: G.buyer, buyerEmail: G.bemail, buyerPhone: G.bphone };
  }
  function showDoneCard(o, code, statusText) {
    $("#gcAmt").textContent = o.treatment ? o.treatment : money(o.amount);
    $("#gcVal").textContent = o.treatment ? "Value " + money(o.amount) : "To spend on any treatment";
    $("#gcTo").textContent = o.toName; $("#gcFrom").textContent = o.buyerName;
    $("#gcMsg").textContent = o.message ? "“" + o.message + "”" : ""; $("#gcMsg").hidden = !o.message;
    $("#gcCode").textContent = code;
    $("#gdStatus").textContent = statusText;
    var send = $("#gdSend");
    if (o.delivery === "email" && o.toEmail) {
      send.hidden = false;
      var body = "Hi " + o.toName + ",\n\n" + o.buyerName + " has given you a gift certificate for In2Skin in Bolton: " + (o.treatment ? o.treatment + " (value " + money(o.amount) + ")" : money(o.amount)) + ".\n" +
        (o.message ? "\n\"" + o.message + "\"\n" : "") + "\nYour code: " + code + "\nRedeem it when you book at " + siteLabel() + " or call (289) 212-4124.\n";
      send.setAttribute("href", "mailto:" + encodeURIComponent(o.toEmail).replace("%40", "@") + "?subject=" + encodeURIComponent("A gift for you from " + o.buyerName) + "&body=" + encodeURIComponent(body));
    } else { send.hidden = true; }
    ["gf1", "gf2", "gf3", "gf4"].forEach(function (id) { var el = document.getElementById(id); if (el) el.hidden = true; });
    G.paying = true; G.done = true; paint();
    setTimeout(function () { go($("#gfDone")); }, RM.matches ? 0 : 140);
  }
  $("#giftPay").addEventListener("click", function () {
    if (next() !== "pay") { toMissing(next()); return; }
    if (submitting) return;
    submitting = true;
    var order = buildOrder();
    var btn = $("#giftPay"); btn.disabled = true; btn.textContent = "Taking you to secure payment…";
    var err = $("#giftPayErr"); if (err) { err.hidden = true; err.textContent = ""; }
    fetch("/api/gift-buy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.url) throw new Error((res.j && res.j.error) || "The gift could not be started — please try again.");
        location.href = res.j.url; /* Stripe Checkout — paying completes the gift */
      })
      .catch(function (e) {
        submitting = false;
        btn.disabled = false; btn.textContent = "Pay " + money(order.amount);
        if (err) { err.hidden = false; err.textContent = e.message || "Something went wrong — please try again."; }
      });
  });
  $("#gdPrint").addEventListener("click", function () { window.print(); });

  /* ---- Returning from Stripe: /gift/?paid=<session> ----
     The confirmation card renders from the stored gift — the code on it
     is the server-made one. */
  var paidSid = null;
  try { paidSid = new URLSearchParams(location.search).get("paid"); } catch (e) { paidSid = null; }
  if (paidSid) {
    fetch("/api/gift?session_id=" + encodeURIComponent(paidSid), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.paid) {
          $("#gdStatus").textContent = "Your payment has not come through yet. If you just paid, give it a moment — the certificate code will be emailed when it clears.";
          ["gf1", "gf2", "gf3", "gf4"].forEach(function (id) { var el = document.getElementById(id); if (el) el.hidden = true; });
          G.paying = true; G.done = true; paint();
          return;
        }
        var g = res.j;
        var o = { amount: g.amountCents / 100, treatment: g.kind === "voucher" ? (g.voucherLabel || "") : null, toName: g.recipientName, buyerName: g.buyerName, message: "", delivery: g.delivery || "email", toEmail: g.recipientEmail || "" };
        var status = g.delivery === "print"
          ? "It's on its way to " + (g.buyerEmail || "") + ", ready to print."
          : g.sendOn
            ? "We'll email it to " + (g.recipientEmail || "") + " on " + dateWords(g.sendOn) + ". A receipt is on its way to " + (g.buyerEmail || "") + "."
            : "We'll email it to " + (g.recipientEmail || "") + " right away. A receipt is on its way to " + (g.buyerEmail || "") + ".";
        showDoneCard(o, g.code, status);
      })
      .catch(function () {
        $("#gdStatus").textContent = "We could not reach the gift service. If you just paid, the certificate code will be emailed when the payment clears.";
        ["gf1", "gf2", "gf3", "gf4"].forEach(function (id) { var el = document.getElementById(id); if (el) el.hidden = true; });
        G.paying = true; G.done = true; paint();
      });
  }

  /* Redeem line (Nov 20, 2026): the static page says boltonfacials.com;
     on a preview it reads the preview's own host. */
  var gcHow = document.getElementById("gcHow");
  if (gcHow) gcHow.textContent = "Redeem when you book at " + siteLabel() + " or call (289) 212-4124.";

  paint();
})();
