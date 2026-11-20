// In2Skin rebuild (Tony Nov 19, 2026, GB brief + Tony's rulings) —
// static regression checks. Real URLs, not #/ routes; one ordered
// page map (NAV) generates the nav; the home page is one scrolling
// page (hero → first visit → price list → booking calendar → the
// rest); the picker is a calculator with no hard blocks (review
// flags instead); the deposit model replaces full payment up front;
// Microneedling + NANO Needling are one treatment; the street address
// is off the public site. Run: node scripts/test-restructure.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let n = 0;
function has(hay, needle, msg) { n++; assert.ok(hay.includes(needle), msg); }
function lacks(hay, needle, msg) { n++; assert.ok(!hay.includes(needle), msg); }

const index = read("index.html");

// (1) ONE ordered data structure (NAV) holds the page map, nav and
// homepage order — generated, never hand-ordered elsewhere.
has(index, "var NAV = [", "NAV data structure exists");
has(index, '{ id:"home",        label:"Home"', "NAV lists Home first");
has(index, '{ id:"services",    label:"Services"', "NAV lists Services");
has(index, '{ id:"occasions",   label:"What are you getting ready for?"', "NAV lists the occasions item");
has(index, '{ id:"how",         label:"How to choose"', "NAV lists How to choose");
has(index, '{ id:"consult",     label:"Consultation"', "NAV lists Consultation");
has(index, '{ id:"gift",        label:"Gift Certificates"', "NAV lists Gift Certificates");
has(index, '{ id:"faq",         label:"FAQ"', "NAV lists FAQ");
has(index, '{ id:"contact",     label:"Contact & Hours"', "NAV lists Contact & Hours");
lacks(index, 'href="#/visit"', "no Visit Us nav item left");
lacks(index, '"Visit Us"', "no Visit Us label left");
has(index, "VIEW_URL", "view-to-URL map exists");
has(index, "URL_VIEW", "URL-to-view map exists");
has(index, 'URL_VIEW["/book/"] = "book"', "book is a real URL");
has(index, 'VIEW_URL[n.id] = n.url', "NAV generates the view-to-URL map");

// (2) Real URLs, not #/ routes. The router pushes real URLs; old #/
// links redirect once on load; unknown paths render a 404 view.
lacks(index, 'history.replaceState(null, "", "#/" + current)', "no hash routing left");
has(index, "history.pushState", "router pushes real URLs");
has(index, "function routeFromPath(){", "routing reads the pathname");
has(index, "function redirectOldHash(){", "old #/ links redirect to real URLs");
has(index, "function notFoundHTML(){", "custom 404 view exists");
has(index, 'href="/book/"', "Book links use real URLs");
has(index, 'href="/contact/"', "Contact links use real URLs");
has(index, 'href="/faq/"', "FAQ links use real URLs");
has(index, 'href="/how-to-choose/"', "How-to-choose links use real URLs");
has(index, 'href="/consultation/"', "Consultation links use real URLs");
has(index, 'href="/the-works/"', "Works links use the real static URL");
lacks(index, 'href="#/book"', "no #/book links left");
lacks(index, 'href="#/the-works"', "no #/the-works links left");
// The header nav is generated at runtime from NAV; the generated
// static pages carry the same nav baked in — check it there.
const needling = read("needling/index.html");
for (const u of ["/services/", "/book/", "/occasions/", "/how-to-choose/", "/consultation/", "/gift/", "/faq/", "/contact/"]) {
  has(needling, 'href="' + u + '"', "generated page nav links " + u);
  n++;
}
lacks(needling, 'href="#/', "no hash links on generated pages");

// (3) Header: Book Online + Call stay at the top (Tony Nov 19, 2026 —
// 7e386ce wrongly removed the header Book button). The hero has ONE
// big Book Online + ONE big Call, and "See prices" scrolls to the
// price list. The header never overlaps: eight nav items + logo +
// two buttons do not fit below ~1400px, so the burger takes over
// there; the brand and buttons never shrink under each other.
has(index, 'class="btn btn-book btn-book-sm header-book" href="/book/"', "header Book Online button is back");
has(index, 'class="btn btn-ghost header-call"', "header Call button stays");
has(index, 'class="btn btn-hero" href="/book/" data-nav="book">Book Online</a>', "hero has one big Book Online");
has(index, 'class="btn btn-hero btn-ghost" href="tel:+12892124124">Call (289) 212-4124</a>', "hero has one big Call");
has(index, 'data-scroll-to="services">See prices', "hero See prices scrolls to the price list");
has(index, 'preload="none"', "hero video preloads none");
const css = read("assets/site.css");
has(css, ".header-book", "header-book CSS exists");
has(css, ".hero-prices", "hero See prices link styled");
has(css, "@media (max-width:1400px){", "burger takes over below 1400px so the header never crowds");
has(css, ".brand{ display:flex; align-items:center; gap:12px; text-decoration:none; color:var(--ink); margin-right:auto; min-height:48px; flex:0 0 auto; }", "brand never shrinks under the buttons");
has(css, ".brand .tagline{ display:none; }", "phone header drops the wide tagline so the wordmark fits");

// (4) Home page order (Tony Nov 19, 2026): hero → welcome → first
// visit → price list → booking calendar → the rest → payment as a
// LATE explanation section.
const homeFn = index.slice(index.indexOf("function homeHTML(){"), index.indexOf("/* ---------------- SERVICE PAGE ---------------- */"));
for (const [a, b, msg] of [
  ['id="welcome"', 'id="services"', "welcome comes before the price list"],
  ['id="services"', 'id="book"', "price list comes before the booking calendar"],
  ['id="book"', 'id="how-teaser"', "booking calendar comes before the how-to-pick teaser"],
  ['id="how-teaser"', 'id="deposit"', "how-to-pick comes before the payment section"],
  ['id="deposit"', 'id="faq-teaser"', "payment section comes before the FAQ teaser"],
  ['id="faq-teaser"', 'id="contact-teaser"', "FAQ teaser comes before the contact teaser"],
]) {
  assert.ok(homeFn.indexOf(a) < homeFn.indexOf(b) && homeFn.indexOf(a) >= 0 && homeFn.indexOf(b) >= 0, msg);
  n++;
}
has(homeFn, 'id="bookShell"', "home carries the booking calendar inline");
has(homeFn, "pickerHTML()", "home carries the price-list picker");
lacks(homeFn, "Honest prices, up front", "empty Honest prices line is gone");
lacks(homeFn, "Acne care elsewhere can cost hundreds", "unsourced competitor line is gone");
lacks(homeFn, 'id="pay"', "no Pay-on-the-spot block left on home");
has(homeFn, 'id="deposit"', "payment is the late deposit explanation section");
has(homeFn, "DEPOSIT_SENTENCE", "deposit sentence on home");
has(index, 'id="services"', "services screen exists");
has(index, "function servicesHTML(){", "services view exists");
has(index, "function howHTML(){", "how-to-pick view exists");
has(index, "function consultHTML(){", "consultation view exists");
has(index, "function occasionsHTML(){", "occasions view exists");
has(index, "function faqHTML(){", "FAQ view exists");

// (5) One place to book: the picker + wizard live on the book screen
// and on home (inline); the Services page has the picker, and its
// Book button takes the visitor to /book/.
has(index, "function bookHTML(){", "book screen exists");
has(index, "function giftHTML(){", "gift screen exists");
has(index, "function visitHTML(){", "contact screen exists");
has(index, "function homeHTML(){", "home screen exists");
has(index, 'id="view-book"', "book view renders");
has(index, 'id="view-services"', "services view renders");
has(index, 'id="view-contact"', "contact view renders");
has(index, 'showView("book")', "booking opens the book screen");

// (6) Condition cards open the picker with the facial pre-picked —
// 9 skin-condition cards on home + 3 occasion cards.
const conds = index.match(/data-cond-service="/g) || [];
assert.strictEqual(conds.length, 12, `12 condition cards open the picker, got ${conds.length}`);
n++;
has(index, 'data-cond-service="classic-facial"', "dry skin opens Classic");
has(index, 'data-cond-service="combo-classic"', "tired skin opens The Works");
has(index, 'data-cond-addons="microdermabrasion"', "wedding card carries its add-on");
has(index, "Getting married?", "occasions page has the wedding card");
has(index, "Going on vacation?", "occasions page has the vacation card");
has(index, "Business &amp; always on?", "occasions page has the work card");
lacks(index, "Book — $85</button></div></article>", "condition cards have no Book buttons");

// (7) The Works: no standalone feature block on the homepage.
lacks(index, 'id="works"', "no Works feature block on the home screen");
lacks(index, "Book The Works</button>", "no Works feature Book button on the home screen");
has(index, 'href="/the-works/"', "Works page is linked from the app");
has(index, "video-red-light.mp4", "Works screen carries the video hero");

// (8) Toronto escape section off the homepage, on the Toronto page.
lacks(index, "drive-panel", "no Toronto drive-panel on the home screen");
lacks(index, "Book Your Escape", "no Book Your Escape button");
const toronto = read("facials-toronto/index.html");
has(toronto, "An escape from the city", "Toronto page carries the escape section");
has(toronto, "Mississauga", "Toronto page names the GTA towns");
lacks(toronto, "$150 to $300", "no downtown competitor prices on the Toronto page");
lacks(toronto, "$150–$300", "no downtown price range on the Toronto page");
lacks(toronto, "The price gap, honestly", "no price-gap section on the Toronto page");
const mississauga = read("facials-mississauga/index.html");
lacks(mississauga, "about $130", "no Mississauga competitor average left");
lacks(mississauga, "$105 to $350", "no Mississauga medspa range left");
lacks(mississauga, "The price gap, honestly", "no price-gap section on the Mississauga page");

// (9) Pay-link creation off the public site; the explainer stays.
lacks(index, "payShell", "no pay creation shell on the public site");
lacks(index, "renderPay", "no pay creation renderer on the public site");
lacks(index, "PAY ON THE SPOT", "no pay creation code on the public site");
const payJs = read("api/pay.js");
has(payJs, "requireAdmin(req, res)", "POST /api/pay requires the admin session");
assert.ok(
  payJs.indexOf('req.method !== "POST"') < payJs.indexOf("requireAdmin(req, res)"),
  "admin gate is on the POST path, GET redemption stays public"
);
n++;
const payHtml = read("pay.html");
has(payHtml, "/api/pay-link?id=", "client pay page still redeems its link");

// (10) Big imagery stays video; small pictures stay still.
has(index, "video-hero-stones.mp4", "hero is video");
has(index, "video-red-light.mp4", "welcome + Works carry video");
const works = read("the-works/index.html");
has(works, "<video", "Works page hero is video");
has(works, "https://boltonfacials.com/the-works/", "Works page canonical");
has(works, "Book The Works — $160", "Works page books the Classic option");
const sitemap = read("sitemap.xml");
has(sitemap, "https://boltonfacials.com/the-works/", "Works page is in the sitemap");
has(sitemap, "https://boltonfacials.com/services/", "Services page is in the sitemap");
has(sitemap, "https://boltonfacials.com/book/", "Book page is in the sitemap");
has(sitemap, "https://boltonfacials.com/needling/", "Needling page is in the sitemap");
lacks(sitemap, "nano-needling", "no nano-needling URL in the sitemap");
lacks(sitemap, "microneedling", "no microneedling URL in the sitemap");

// (11) Picker = calculator (Tony Nov 19, 2026): one Book button for
// the whole price list (the package bar); rows select with a compact
// checkmark; a single Works row carries the facial choice inside it;
// the quick visits are "Add to your facial", never "Add-ons";
// needling is ONE entry; NO hard compatibility blocks — combinations
// are flagged for Sarah's review instead; the wizard's step 1 is a
// prompt back to the list, not a second pick-list; the booking
// summary shows on every step. No $10 first-visit offer.
has(index, 'id="pkgContinue">Book →</button>', "single Book button is the package bar");
has(index, 'currentView === "home" || currentView === "services" || currentView === "book"', "Book button stays up on every screen with the picker");
const pickerFn = index.slice(index.indexOf("function pickerHTML(){"), index.indexOf("function bookHTML(){"));
lacks(pickerFn, "data-book=", "no per-row Book buttons inside the price-list picker");
has(index, 'data-tx-id="the-works"', "one Works row");
has(index, 'data-tx-works="combo-classic"', "Works row offers the Classic option inside it");
has(index, 'data-tx-works="combo-anti"', "Works row offers the Anti-Aging option inside it");
lacks(index, "function txCombo(", "no two-row Works picker any more");
has(index, '"Add to your facial"', "quick visits are framed as Add to your facial");
lacks(index, '"Quick visits"', "no Quick visits label left");
lacks(index, '"Add-ons"', "never labelled Add-ons");
has(index, 'id: "needling",', "needling is one merged entry");
has(index, 'name: "Microneedling / NANO Needling"', "merged entry states both names");
lacks(index, 'id: "nano-needling"', "no separate NANO row left");
lacks(index, 'id: "microneedling"', "no separate Microneedling row left");
has(index, 'id="txReviewNote"', "review-flag note exists");
lacks(index, 'id="txPeelNote"', "no peels-block note left");
lacks(index, 'id="txNeedleNote"', "no needling-block note left");
lacks(index, "txNeedleBlocked", "no needling block left");
lacks(index, "txPeelBlocked", "no peels block left");
has(index, "function txReviewNote(){", "review-flag logic exists in the picker");
has(index, 'id="toServices"', "wizard step 1 points back to the price list");
lacks(index, "data-pick-service", "wizard has no duplicate pick-list");
lacks(index, "data-pick-addon", "wizard has no duplicate add-on list");
has(index, 'id="bookTreatSummary"', "step 3 Treatment line has an id for in-place updates");
has(index, "<strong>Your visit — </strong>", "step 2 summary leads with Your visit");
has(css, ".tx-check", "checkmark circle styled");
has(css, ".tx-variant", "Works variant pills styled");
has(css, ".tx-included", "already-included note styled");
has(css, ".ask-first", "ask-first panel styled");
lacks(index, "First visit? $10 toward any service", "no $10 first-visit offer in copy");
lacks(index, "$10 first-visit offer applied", "no $10 offer in checkout text");
lacks(index, "includes the $10 first-visit offer", "no $10 offer in emails");
lacks(index, "First visit: $10 toward any service", "no $10 offer in the noscript");
assert.ok(index.indexOf('id="reviews"') > index.indexOf("function visitHTML") && index.indexOf('id="reviews"') < index.indexOf("function homeHTML"), "testimonials live on the Visit screen, off the home flow");
n++;

// (12) Deposit model (Tony Nov 19, 2026): $30 deposit, credited
// toward the treatment, balance at the visit; no full payment up
// front; one consistent sentence site-wide.
has(index, "DEPOSIT_SENTENCE", "deposit sentence constant exists");
has(index, "A $30 deposit holds your spot when you book online", "deposit sentence in copy");
lacks(index, "Pay in full securely by card when you book", "no pay-in-full wording left on the public site");
lacks(index, "You pay in full securely by card when you book online", "no pay-in-full FAQ wording left");
has(index, "var deposit = Math.min(3000, cents);", "deposit math exists in the picker totals");
has(index, "Deposit paid: $", "step 4 shows the deposit + balance due");
has(index, "balance due at your visit", "step 4 names the balance due");
const bk = read("lib/bookings.js");
has(bk, '"deposit-paid"', "deposit-paid status exists");
has(bk, "bankDepositCredit", "deposit credit banking exists");
has(bk, "depositWaived", "deposit waiver exists in the booking record");
const dash = read("admin/dashboard.html");
has(dash, "wkWaive", "walk-in form has the deposit-waiver checkbox");
const sched = read("lib/schedule.js");
has(sched, "DEPOSIT_CENTS = 3000", "deposit is $30 in the source of truth");
has(sched, "DEPOSIT_SENTENCE", "deposit sentence lives in the source of truth");
has(sched, "function depositCentsFor", "deposit math exists in the source of truth");
has(sched, "function needsReview", "review-flag logic exists in the source of truth");

// (13) Street address off the public site — only in the booking
// confirmation (step 4 + confirmation email + booked.html).
lacks(index, '"streetAddress": "92 Willow Street"', "no street address in the homepage JSON-LD");
const needlingPage = read("needling/index.html");
lacks(needlingPage, "92 Willow Street", "no street address on the needling page");
lacks(toronto, "92 Willow Street", "no street address on the Toronto page");
has(index, 'var STUDIO_ADDRESS = "92 Willow Street', "address constant exists for the confirmation only");
has(index, "Get directions", "confirmation page offers a Maps link");
const booked = read("booked.html");
has(booked, "92 Willow Street", "confirmation page gives the address");
has(booked, "Get directions", "confirmation page gives a Maps link");
has(booked, "balance due at your visit", "confirmation page shows the balance");

// (14) Ask-first: three quick questions above the price list.
has(index, "function askFirstHTML(){", "ask-first panel exists");
has(index, "First, three quick questions", "ask-first heading");
has(index, "data-ask-concern", "skin-concern question exists");
has(index, "data-ask-first", "first-visit question exists");
has(index, "data-ask-far", "far-away question exists");
has(index, "ASK_CONCERN_MAP", "concern-to-treatment map exists");

console.log(`test-restructure: all ${n} checks passed`);
