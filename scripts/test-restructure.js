// Homepage restructure (Tony Nov 19, 2026) — static regression checks.
// The site is app-like screens, not one long scrolling page: no anchor
// scroll targets, one place to book, condition cards open the picker,
// The Works lives on its own page, the Toronto escape section lives on
// the Toronto page, and the pay-link creation form is off the public
// site. Run: node scripts/test-restructure.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let n = 0;
function has(hay, needle, msg) { n++; assert.ok(hay.includes(needle), msg); }
function lacks(hay, needle, msg) { n++; assert.ok(!hay.includes(needle), msg); }

const index = read("index.html");

// (1) App-like, no scroll-jumping: no anchor-scroll targets anywhere.
lacks(index, "data-scroll", "no data-scroll attributes left");
lacks(index, 'scroll:"', "chat actions use view: not scroll:");
lacks(index, "data-chat-scroll", "no data-chat-scroll handlers left");
has(index, 'view:"book"', "chat can open the book screen");
has(index, 'view:"gift"', "chat can open the gift screen");
has(index, 'href="#/book"', "nav links go to the book screen");
has(index, 'href="#/visit"', "nav links go to the visit screen");

// (2) One place to book: the picker + wizard live on the book screen.
has(index, "function bookHTML(){", "book screen exists");
has(index, "function giftHTML(){", "gift screen exists");
has(index, "function visitHTML(){", "visit screen exists");
has(index, "function worksHTML(){", "works screen exists");
has(index, "function homeHTML(){", "home screen exists");
has(index, 'id="view-book"', "book view renders");
lacks(index, 'showView("home", "book")', "no more scroll-into-book");
has(index, 'showView("book")', "booking opens the book screen");

// (3) Condition cards open the picker with the facial pre-picked.
const conds = index.match(/data-cond-service="/g) || [];
assert.strictEqual(conds.length, 9, `9 condition cards open the picker, got ${conds.length}`);
n++;
has(index, 'data-cond-service="classic-facial"', "dry skin opens Classic");
has(index, 'data-cond-service="combo-classic"', "tired skin opens The Works");
has(index, 'data-cond-addons="microdermabrasion"', "wedding card carries its add-on");
lacks(index, "Book — $85</button></div></article>", "condition cards have no Book buttons");

// (4) The Works: no standalone feature block on the homepage.
lacks(index, 'id="works"', "no Works feature block on the home screen");
lacks(index, "Book The Works</button>", "no Works feature Book button on the home screen");
has(index, 'href="#/the-works"', "Works page is linked from the app");
has(index, "video-red-light.mp4", "Works screen carries the video hero");

// (5) Toronto escape section off the homepage, on the Toronto page.
lacks(index, "drive-panel", "no Toronto drive-panel on the home screen");
lacks(index, "Book Your Escape", "no Book Your Escape button");
const toronto = read("facials-toronto/index.html");
has(toronto, "An escape from the city", "Toronto page carries the escape section");
has(toronto, "Mississauga", "Toronto page names the GTA towns");

// (6) Pay-link creation off the public site; the explainer stays.
lacks(index, "payShell", "no pay creation shell on the public site");
lacks(index, "renderPay", "no pay creation renderer on the public site");
lacks(index, "PAY ON THE SPOT", "no pay creation code on the public site");
has(index, 'id="pay"', "pay-at-your-visit explainer stays for clients");
has(index, "Pay at your visit", "explainer copy stays");
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

// (7) Big imagery stays video; small pictures stay still.
has(index, "video-hero-stones.mp4", "hero is video");
has(index, "video-red-light.mp4", "welcome + Works carry video");
const works = read("the-works/index.html");
has(works, "<video", "Works page hero is video");
has(works, "https://boltonfacials.com/the-works/", "Works page canonical");
has(works, "Book The Works — $160", "Works page books the Classic option");
const sitemap = read("sitemap.xml");
has(sitemap, "https://boltonfacials.com/the-works/", "Works page is in the sitemap");

// (8) Prices first, never a pay button first (Tony Nov 19, 2026): the
// home screen's first view offers "See prices" — no Book Online in
// the header, the hero, or the pinned bar on home. The price list
// books through ONE Book button (the package bar, Nov 19) — no
// per-row Book buttons — and booking from it still works.
lacks(index, "header-book", "no gold Book Online button in the header");
has(index, '>Prices</a>', "header nav offers Prices, not Book Online");
has(index, 'class="btn btn-hero" href="#/book" data-nav="book">See prices</a>', "hero offers See prices into the price list");
has(index, 'id="mobileBarCta"', "pinned bar CTA is view-aware");
has(index, 'barCta.textContent = current === "home" ? "See prices" : "Book Online"', "bar says See prices on home, Book Online elsewhere");
const css = read("assets/site.css");
has(css, ".btn-hero", "hero prices button has its own style");
lacks(css, ".header-book", "dead header-book CSS is gone");
has(index, 'data-book="classic-facial"', "first-visit CTA still books Classic");
has(index, 'data-book="combo-classic"', "Works screen still books The Works");

// (9) Picker redesign + defects + $10 drop (Tony Nov 19, 2026).
// One Book button for the whole price list (the package bar); rows
// select with a compact checkmark and never open a big panel on tap;
// a single Works row carries the facial choice inside it; the quick
// visits are "Add to your facial", never "Add-ons"; needling sits
// together; peels + NANO is blocked with a plain note; the wizard's
// step 1 is a prompt back to the list, not a second pick-list; and
// the booking summary shows on every step. No $10 first-visit offer.
has(index, 'id="pkgContinue">Book →</button>', "single Book button is the package bar");
has(index, 'return !!(v && v.classList.contains("active"));', "Book button stays up whenever the book screen is — never vanishes mid-pick");
const bookFn = index.slice(index.indexOf("function bookHTML(){"), index.indexOf("function giftHTML(){"));
lacks(bookFn, "data-book=", "no per-row Book buttons inside the price-list picker");
has(index, 'data-tx-id="the-works"', "one Works row");
has(index, 'data-tx-works="combo-classic"', "Works row offers the Classic option inside it");
has(index, 'data-tx-works="combo-anti"', "Works row offers the Anti-Aging option inside it");
lacks(index, "function txCombo(", "no two-row Works picker any more");
has(index, '"Add to your facial"', "quick visits are framed as Add to your facial");
lacks(index, '"Quick visits"', "no Quick visits label left");
lacks(index, '"Add-ons"', "never labelled Add-ons");
has(index, '[svcById("nano-needling"), svcById("microneedling")]', "NANO and Microneedling sit next to each other");
has(index, 's.cat.indexOf("Advanced")===0 && s.id !== "microneedling"', "Microneedling lives with NANO, not in Advanced");
has(index, 'id="txPeelNote"', "peels + NANO note exists");
has(index, 'id="txNeedleNote"', "needling one-choice note exists");
has(index, 'id="toServices"', "wizard step 1 points back to the price list");
lacks(index, "data-pick-service", "wizard has no duplicate pick-list");
lacks(index, "data-pick-addon", "wizard has no duplicate add-on list");
has(index, 'id="bookTreatSummary"', "step 3 Treatment line has an id for in-place updates");
has(index, "<strong>Your visit — </strong>", "step 2 summary leads with Your visit");
has(css, ".tx-check", "checkmark circle styled");
has(css, ".tx-variant", "Works variant pills styled");
has(css, ".tx-included", "already-included note styled");
has(css, ".hero-in{ min-height:0; padding:22px 0 28px; }", "mobile hero is compact so See prices is in the first view");
lacks(index, "First visit? $10 toward any service", "no $10 first-visit offer in copy");
lacks(index, "$10 first-visit offer applied", "no $10 offer in checkout text");
lacks(index, "includes the $10 first-visit offer", "no $10 offer in emails");
lacks(index, "First visit: $10 toward any service", "no $10 offer in the noscript");
assert.ok(index.indexOf('id="reviews"') > index.indexOf("function visitHTML") && index.indexOf('id="reviews"') < index.indexOf("function homeHTML"), "testimonials live on the Visit screen, off the home flow");
n++;
assert.ok(index.indexOf('id="pay"') > index.indexOf("Book your first visit"), "payment explainer comes after the first-visit CTA");
n++;

console.log(`test-restructure: all ${n} checks passed`);
