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

console.log(`test-restructure: all ${n} checks passed`);
