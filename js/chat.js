/* In2Skin assistant: a small chat bubble + panel on every page. Runs entirely in the browser and answers from the
   studio's own prices and wording below (no network calls, nothing stored). Anything it can't answer goes to "Call the studio" / "Book". */
(function () {
  "use strict";
  var TEL = "tel:+12892124124", TELTXT = "(289) 212-4124";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var BOOK = { label: "Book online", href: "/#services" }, CALL = { label: "Call " + TELTXT, href: TEL };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  var PRICES = '<ul class="msg-list"><li><b>Classic Facial</b> $85 · 55 min</li><li><b>Anti-Aging Facial</b> $125 · 80 min</li>' +
    '<li><b>The Works</b> $160 with a Classic (55 min) or $195 with an Anti-Aging (80 min). Red light and reflexology included.</li>' +
    '<li><b>Chemical Peels</b> $125–$475 · 55 min</li><li><b>Add-ons</b> (20 min each): NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35</li></ul>';

  /* [keywords, answer html, action buttons]; first match wins, so specific topics come before general ones */
  var KB = [
    [["private hours", "private", "early", "evening", "after hours", "after work", "before work", "morning"],
      "<b>Private Hours</b> are a premier experience the studio opens just for you, before 9:00 AM or after 4:00 PM, Monday to Saturday. Start the day glowing before a meeting, or unwind in the evening. You request the time and the studio confirms it personally. Private Hours are your regular service price plus $15.",
      [CALL, BOOK]],
    [["gift", "voucher", "certificate", "present"],
      "Gift certificates are for any amount or any treatment (Classic Facial $85, Anti-Aging $125, The Works from $160). A certificate code is emailed to the recipient, ready to redeem when they book.",
      [{ label: "Give a gift", href: "/gift/" }]],
    [["video", "consult", "consultation", "meet"],
      "A 20-minute video consultation on Google Meet is $30, and the full $30 comes off your first treatment. No app needed. One per client.",
      [{ label: "Book a video consult", href: "/consultation/?format=video" }]],
    [["the works", "combo", "works"],
      "<b>The Works</b> is a facial, red light and reflexology in one visit: $160 with a Classic Facial (55 min) or $195 with an Anti-Aging Facial (80 min).",
      [{ label: "About The Works", href: "/the-works/" }, BOOK]],
    [["anti aging", "anti-aging", "antiaging", "wrinkle", "fine line", "aging", "ageing"],
      "The <b>Anti-Aging Facial</b> is $125 for 80 minutes: the Classic, plus a second mask, an arm massage and Circadia serums.",
      [{ label: "Anti-Aging Facial", href: "/anti-aging-facial/" }, BOOK]],
    [["classic"],
      "The <b>Classic Facial</b> is $85 for 55 minutes: cleanse, steam, extractions, a mask and a facial massage, matched to your skin that day.",
      [{ label: "Classic Facial", href: "/classic-facial/" }, BOOK]],
    [["peel"],
      "<b>Chemical Peels</b> are $125–$475 for 55 minutes. A Circadia peel is matched to your skin, and the exact price is confirmed at your consultation.",
      [{ label: "Chemical Peels", href: "/chemical-peels/" }, BOOK]],
    [["microneedl", "nano", "needling", "needle", "collagen"],
      "<b>NANO Needling</b> is $65 for 20 minutes, as an add-on to a facial or on its own. Ultra-fine nano tips help serums absorb more deeply, for plumper, smoother, more radiant skin.",
      [{ label: "NANO Needling", href: "/nano-needling/" }, BOOK]],
    [["microderm", "polish"],
      "<b>Microdermabrasion</b> is $55 for 20 minutes: a gentle polish for smoother, brighter skin, with no downtime.",
      [{ label: "Microdermabrasion", href: "/microdermabrasion/" }, BOOK]],
    [["light therapy", "red light", "led"],
      "<b>Light Therapy</b> is $55 for 20 minutes: you rest under warm red light that supports collagen and evens tone. It is non-invasive and painless, with no recovery time.",
      [{ label: "Light Therapy", href: "/light-therapy/" }, BOOK]],
    [["reflex", "foot", "feet"],
      "<b>Reflexology</b> is $35 for 20 minutes: gentle, rhythmic pressure on your feet for whole-body calm.",
      [{ label: "Reflexology", href: "/reflexology/" }, BOOK]],
    [["add on", "add-on", "addon", "extras"],
      "Add-ons are 20 minutes each: NANO Needling $65, Microdermabrasion $55, Light Therapy $55 and Reflexology $35. Tap the ones you want while booking — the ones that go with your facial light up gold.",
      [BOOK]],
    [["acne", "breakout", "pimple", "oily"], "For breakouts, many guests start with a Classic Facial. Your esthetician tailors it to your skin that day.", [{ label: "Acne-prone skin", href: "/acne-prone-skin/" }, BOOK]],
    [["rosacea", "sensitive", "redness", "irritat"], "Sensitive skin is welcome. Your visit starts with a consultation, and every step is adjusted to your skin.", [{ label: "Sensitive skin", href: "/rosacea-sensitive-skin/" }, BOOK]],
    [["lines", "wrinkle", "aging", "ageing"], "For fine lines, the <b>Anti-Aging Facial</b> ($125, 80 min) adds a second mask and Circadia serums. NANO Needling can go further.", [{ label: "Fine lines", href: "/fine-lines/" }, BOOK]],
    [["dull", "tired", "glow", "bright"], "For dull or tired skin, the Classic Facial is a lovely place to begin, and Microdermabrasion or Light Therapy can be added.", [{ label: "Dull skin", href: "/dull-skin/" }, { label: "Tired skin", href: "/tired-skin/" }]],
    [["suit", "which", "recommend", "best", "first", "new", "choose", "not sure"],
      "New here? The <b>Classic Facial</b> ($85, 55 min) is the best first visit. Every visit starts with a consultation and is tailored to your skin that day. Prefer to talk it through? A 20-minute video consultation is $30 and comes off your first treatment.",
      [{ label: "Help me choose", ask: "acne breakouts" , askList: true }, BOOK]],
    [["price", "cost", "how much", "pricing", "rate", "$", "cheap", "afford"], "Here are the current prices:" + PRICES + "Private Hours (early or late) are the regular price plus $15.", [BOOK]],
    [["how long", "minutes", "duration", "time does"], "The Classic Facial is 55 minutes and the Anti-Aging Facial is 80 minutes. Add-ons are 20 minutes each, and The Works is 55–80 minutes.", [BOOK]],
    [["pay", "deposit", "card", "cash", "interac", "e-transfer"],
      "When you book online you hold your time with a $30 deposit, or book a $30 video consultation (credited to your treatment). The balance is paid at your visit. Card online, or cash or Interac e-transfer at the studio.",
      [BOOK]],
    [["cancel", "reschedule", "change", "move", "late"], "To change or move a booking, call the studio and we will move it for you.", [CALL]],
    [["friend"], "You can book a visit for a friend: on the booking form choose “A friend”, add their name and email, then pick their treatment and time. It’s paid by you, and the confirmation goes straight to them. Or give a gift certificate with a code they can use whenever they like.", [BOOK]],
    [["where", "location", "address", "direction", "parking", "bolton", "find you"], "In2Skin is a private, one-on-one aesthetics studio in Bolton, Ontario. Directions are shared when you book.", [BOOK, CALL]],
    [["hour", "open", "closed", "sunday", "saturday", "weekend", "monday", "days", "what time", "when", "available", "appointment", "slot"], "We're open <b>Monday to Saturday</b> and closed Sundays. Regular hours are <b>9:00 AM to 4:00 PM</b> (online booking start times). Before 9 or after 4, <b>Private Hours</b> are requested by you and confirmed personally by the studio: your regular service price plus $15.", [BOOK, CALL]],
    [["book", "reserve", "schedule"], "Booking takes a minute: choose a treatment, tap the add-ons you want, add your details, then pick a day and time. Or call the studio.", [BOOK, CALL]],
    [["phone", "call", "number", "contact", "talk", "speak", "email"], "The studio is happy to talk: " + TELTXT + ".", [CALL]],
    [["hi", "hello", "hey", "thanks", "thank"], "Hello! Ask me about treatments, prices, gifts or booking.", []]
  ];
  var CHIPS = ["See prices", "Which facial suits my skin?", "Private Hours", "Gift certificates", "How do I book?", "Where are you?"];

  function answer(q) {
    var t = " " + q.toLowerCase().replace(/[^a-z0-9$ \-]/g, " ").replace(/\s+/g, " ") + " ";
    for (var i = 0; i < KB.length; i++) for (var k = 0; k < KB[i][0].length; k++) {
      var w = KB[i][0][k]; if (w.length <= 3 ? t.indexOf(" " + w + " ") > -1 : t.indexOf(w) > -1) return { html: KB[i][1], acts: KB[i][2] };
    }
    return { html: "I'm not sure about that one, and I'd rather not guess. The studio can answer it properly.", acts: [CALL, BOOK] };
  }

  /* ---------- build ---------- */
  var fab = document.createElement("button"); fab.type = "button"; fab.className = "chat-fab"; fab.id = "chatFab";
  fab.setAttribute("aria-label", "Chat with the In2Skin assistant"); fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.8c0 2.8 1.5 5.3 3.9 6.9L5 22l4.1-2.2c.9.2 1.9.4 2.9.4 5.5 0 10-3.9 10-8.4S17.5 3 12 3Z" fill="currentColor"/><circle cx="8.2" cy="11.8" r="1.2" fill="#F6E7C4"/><circle cx="12" cy="11.8" r="1.2" fill="#F6E7C4"/><circle cx="15.8" cy="11.8" r="1.2" fill="#F6E7C4"/></svg><span class="chat-fab-txt">Ask In2Skin</span>';
  var panel = document.createElement("div"); panel.className = "chat-panel"; panel.id = "chatPanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "In2Skin assistant chat"); panel.hidden = true;
  panel.innerHTML = '<div class="chat-head"><div><strong>In2Skin Assistant</strong><span>Treatments, prices &amp; booking</span></div><button type="button" class="chat-close" id="chatClose" aria-label="Close chat">×</button></div>' +
    '<div class="chat-msgs" id="chatMsgs" aria-live="polite"></div><div class="chat-chips" id="chatChips"></div>' +
    '<form class="chat-form" id="chatForm"><input id="chatInput" type="text" placeholder="Ask about treatments, prices, gifts…" autocomplete="off" aria-label="Type your question" maxlength="200"><button class="btn btn-gold" type="submit">Send</button></form>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  var msgs = $("#chatMsgs"), chips = $("#chatChips"), input = $("#chatInput"), greeted = false;

  function add(who, html, acts) {
    var d = document.createElement("div"); d.className = "msg " + who; d.innerHTML = html;
    if (acts && acts.length) { var row = document.createElement("div"); row.className = "msg-actions"; acts.forEach(function (a) { var l; if (a.askList) { l = document.createElement("button"); l.type = "button"; l.className = "msg-act"; l.textContent = a.label; l.addEventListener("click", function () { add("user", esc(a.label)); setTimeout(function () { add("bot", "Tell me your main skin goal and I'll point the way:", []); setChips(["Breakouts", "Sensitive or red skin", "Dull or tired skin", "Fine lines", "See prices"]); }, 320); }); } else { l = document.createElement("a"); l.className = "msg-act"; l.href = a.href; l.textContent = a.label; l.addEventListener("click", function () { close(); }); } row.appendChild(l); }); d.appendChild(row); }
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; setTimeout(function () { msgs.scrollTop = msgs.scrollHeight; }, 80);
  }
  function setChips(list) { chips.innerHTML = ""; list.forEach(function (c) { var b = document.createElement("button"); b.type = "button"; b.className = "chat-chip"; b.textContent = c; b.addEventListener("click", function () { send(c); }); chips.appendChild(b); }); }
  function send(q) {
    q = String(q || "").trim(); if (!q) return;
    add("user", esc(q)); input.value = "";
    var a = answer(q); setTimeout(function () { add("bot", a.html, a.acts); }, 320);
  }
  function open() {
    panel.hidden = false; fab.setAttribute("aria-expanded", "true"); document.body.classList.add("chat-open"); lock();
    var hc = $(".help-card .help-x"); if (hc) hc.click();
    if (!greeted) { greeted = true; add("bot", "Hi, I'm the In2Skin assistant. Ask me about treatments, prices, gifts or booking.", []); setChips(CHIPS); }
    if (!(window.matchMedia && window.matchMedia("(pointer:coarse)").matches)) input.focus();
  }
  var lockY = 0, locked = false;
  function lock() { if (locked) return; locked = true; window.IN2_LOCKED = true; lockY = window.scrollY || 0; var b = document.body.style; b.position = "fixed"; b.top = -lockY + "px"; b.left = "0"; b.right = "0"; b.width = "100%"; document.documentElement.classList.add("chat-lock"); }
  function unlock() {
    if (!locked) return; locked = false;
    var de = document.documentElement, b = document.body.style;
    de.style.scrollBehavior = "auto"; /* restore instantly, not with the page's smooth scrolling */
    b.position = b.top = b.left = b.right = b.width = ""; de.classList.remove("chat-lock");
    window.scrollTo(0, lockY);
    window.IN2_LOCKED = false;
    window.dispatchEvent(new Event("scroll")); /* let dock / back-to-top re-read the real position once */
    requestAnimationFrame(function () { if (Math.abs(window.scrollY - lockY) > 1) window.scrollTo(0, lockY); de.style.scrollBehavior = ""; });
  }
  /* iOS: stop touch-scrolls from chaining to the page behind (outside the message list / chip row, or past the list's top or bottom) */
  var tY = 0;
  document.addEventListener("touchstart", function (e) { if (locked && e.touches[0]) tY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!locked) return;
    var t = e.target, list = t.closest ? t.closest(".chat-msgs") : null;
    if (t.closest && t.closest(".chat-chips")) return;
    if (!list) { e.preventDefault(); return; }
    var dy = e.touches[0].clientY - tY, atTop = list.scrollTop <= 0, atBot = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    if (list.scrollHeight <= list.clientHeight || (dy > 0 && atTop) || (dy < 0 && atBot)) e.preventDefault();
  }, { passive: false });
  function close() { panel.hidden = true; fab.setAttribute("aria-expanded", "false"); document.body.classList.remove("chat-open"); unlock(); }
  fab.addEventListener("click", function () { panel.hidden ? open() : close(); });
  $("#chatClose").addEventListener("click", function () { close(); fab.focus(); });
  $("#chatForm").addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(); });
  window.IN2_CHAT = { open: open, close: close };
})();
