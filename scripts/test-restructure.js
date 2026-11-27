// Homepage restructure (Tony Nov 19, 2026) — static regression checks,
// ported Nov 20, 2026 to Grok Bot's prototype: the prototype is a
// MULTI-PAGE site (one HTML page per treatment), not the old single-page
// app, so the old SPA checks (bookHTML(), giftHTML(), pkgContinue,
// tx-check, data-book=) are retired — the invariants behind them live on
// below. KNOWN DIFFERENCES from the old site's rulings, for Tony / Grok
// Bot's second check — NOT asserted here, do not "fix" silently:
//   - the header carries a Book Online button (old rule: prices first);
//   - condition pages link back to /#services instead of opening the
//     picker with a facial pre-picked;
//   - the Works page has no video hero and no "Book The Works" button
//     (it books through the generic Book Online flow).
// Run: node scripts/test-restructure.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let n = 0;
function has(hay, needle, msg) { n++; assert.ok(hay.includes(needle), msg); }
function lacks(hay, needle, msg) { n++; assert.ok(!hay.includes(needle), msg); }

const index = read("index.html");
const mainJs = read("js/main.js");
const consultJs = read("js/consult.js");

// (1) No scroll-jumping navigation system: no data-scroll targets, no
// scroll: chat actions, no data-chat-scroll handlers anywhere.
for (const f of ["index.html", "js/main.js", "js/chat.js", "js/consult.js", "js/gift.js", "js/shell.js"]) {
  const src = read(f);
  lacks(src, "data-scroll", `no data-scroll attributes left (${f})`);
  lacks(src, 'scroll:"', `chat actions use view: not scroll: (${f})`);
  lacks(src, "data-chat-scroll", `no data-chat-scroll handlers left (${f})`);
}

// (2) One place to book: the book section lives on the home page and the
// picker calls the real availability API (never local sample bookings).
has(index, 'id="book"', "book section exists on home");
has(mainJs, "/api/availability", "picker calls the real availability API");
has(mainJs, "slots.js", "picker keeps the on-device computation only as a fallback");
lacks(mainJs, "No network calls", "picker no longer claims to be offline-only");

// (3) Condition pages exist and send the client back to the price list.
for (const c of ["acne-prone-skin", "rosacea-sensitive-skin", "dull-skin", "fine-lines", "tired-skin"]) {
  const page = read(`${c}/index.html`);
  has(page, 'href="/#services"', `${c} links back to the price list`);
}

// (4) The Works lives on its own page, linked from the app; no Works
// feature block on the homepage.
lacks(index, 'id="works"', "no Works feature block on the home page");
lacks(index, "Book The Works", "no Works Book button on the home page");
has(index, 'href="/the-works/"', "Works page is linked from the home page");
const works = read("the-works/index.html");
has(works, "https://www.boltonfacials.com/the-works/", "Works page canonical");
const sitemap = read("sitemap.xml");
has(sitemap, "https://www.boltonfacials.com/the-works/", "Works page is in the sitemap");

// (5) Toronto escape section off the homepage, on the Toronto page.
lacks(index, "drive-panel", "no Toronto drive-panel on the home page");
lacks(index, "Book Your Escape", "no Book Your Escape button");
const toronto = read("facials-toronto/index.html");
has(toronto, "An escape from the city", "Toronto page carries the escape section");
has(toronto, "Mississauga", "Toronto page names the GTA towns");

// (6) Pay-link creation off the public site; the explainer stays.
lacks(index, "payShell", "no pay creation shell on the public site");
lacks(index, "renderPay", "no pay creation renderer on the public site");
lacks(index, "PAY ON THE SPOT", "no pay creation code on the public site");
const payJs = read("api/pay.js");
has(payJs, "requireAdmin(req, res)", "POST /api/pay requires the admin session");
// The gate sits in the POST branch, after the GET redemption handling.
assert.ok(
  payJs.indexOf('req.method !== "POST"') < payJs.indexOf("requireAdmin(req, res)"),
  "admin gate is on the POST path, GET redemption stays public"
);
n++;
const payHtml = read("pay.html");
has(payHtml, "/api/pay-link?id=", "client pay page still redeems its link");

// (7) Big imagery stays video: the home hero is video.
has(index, "hero-stones.mp4", "hero is video");
has(index, "red-light-steam-v2-9x16.mp4", "welcome carries video");

// (8) Prices are the way in: the nav offers Services, the price list
// heads "Services & Prices", and the skip link goes to prices.
has(index, 'href="/#services">Services</a>', "header nav offers Services");
has(index, "Services &amp; Prices", "price list heads Services & Prices");
has(index, 'Skip to prices', "skip link goes to prices");

// (9) No $10 first-visit offer anywhere (dropped Nov 19, 2026).
lacks(index, "First visit? $10 toward any service", "no $10 first-visit offer in copy");
lacks(index, "$10 first-visit offer applied", "no $10 offer in checkout text");
lacks(mainJs, "$10", "no $10 offer in the picker");
for (const f of fs.readdirSync(path.join(ROOT, "emails"))) {
  lacks(read(`emails/${f}`), "$10 first-visit", `no $10 offer in email ${f}`);
}

// (10) Consultation booking has ONE page: /consultation/ (video or in
// person, guided, pay to finish). Every consultation link on the site
// points to it; the picker and the pay step call the real API.
const consult = read("consultation/index.html");
has(consult, 'id="cx0"', "consultation page has the format step");
has(consult, "cx-fmt", "consultation page has the format picker");
has(consult, 'id="cxPay"', "consultation page has the pay step");
has(consultJs, '"/api/book"', "consultation pay posts to the real booking API");
has(consultJs, "/api/availability", "consultation times come from the real availability API");
lacks(consultJs, "abc-sample-xyz", "no sample Meet link left in the consult flow");
lacks(index, 'href="/video-consult/"', "home no longer links the old video-only page");
has(index, 'href="/consultation/"', "home links the consultation page");
has(read("js/chat.js"), 'href: "/consultation/?format=video"', "chat links the consultation page");
has(read("questions/index.html"), 'href="/consultation/"', "questions page links the consultation page");

// (11) Main picker rebuild (Tony Nov 20, 2026): real booking wire, details
// step, deposit rule, guided in-place add-ons, ?service= preselection.
has(index, 'id="step-details"', "picker has a details step");
has(index, 'id="mName"', "details step has a name field");
has(index, 'id="mEmail"', "details step has an email field");
has(index, 'id="mPhone"', "details step has a phone field");
has(index, 'id="hint-details"', "details step has an explainer line");
has(index, 'id="hint-reserve"', "reserve step has an explainer line");
lacks(index, 'data-option="C"', "no pay-at-the-studio option card in the picker");
lacks(index, "Book now, pay at the studio", "no pay-at-the-studio wording in the picker");
lacks(index, 'id="friendDone"', "no fake local friend-done panel");
has(mainJs, "detailsNext", "picker guards the details step");
has(mainJs, "guardDetails", "reserve is guarded by the details check");
has(mainJs, '"/api/book"', "reserve posts to the real booking API");
has(mainJs, '"/api/gift?code="', "gift codes are checked server-side");
lacks(mainJs, "holdSlot(", "no local demo hold left in the picker");
lacks(mainJs, "useCode(", "no local demo gift-code use left in the picker");
lacks(mainJs, "giftsLoad(", "no local demo gift loading left in the picker");
has(mainJs, "ao-pick", "guided in-place add-on picking");
has(mainJs, "ao-off", "incompatible add-ons render unlit with a reason");
has(mainJs, "addonsDone", "add-on step completes in place");
has(mainJs, 'get("service")', "picker reads ?service= preselection");
for (const [dir, sid] of [["classic-facial", "classic-facial"], ["anti-aging-facial", "anti-aging-facial"], ["the-works", "the-works"], ["chemical-peels", "chemical-peels"], ["nano-needling", "nano-needling"], ["microdermabrasion", "microdermabrasion"], ["light-therapy", "light-therapy"], ["reflexology", "reflexology"]]) {
  has(read(`${dir}/index.html`), `/?service=${sid}#services`, `${dir} Book buttons preselect ${sid}`);
}
lacks(index, 'href="/microneedling/"', "home no longer links the microneedling page");
lacks(index, "Pay in full securely by card when you book", "home no longer promises pay-in-full");

console.log(`test-restructure: all ${n} checks passed`);
