// In2Skin rebuild (Tony Nov 19, 2026) — static regression checks for
// the spec structure: prices agree across index.html, lib/schedule.js
// and site-data.json; the deposit is $30 everywhere; header/footer
// link sets match on every page; needling is TWO pages
// (/nano-needling/ + /microneedling/, never /needling/); vercel.json
// rewrites /services/ + /book/ to the SPA and redirects /faq/ to
// /questions/; the street address is off every public page; the 10
// new pages exist. Run: node scripts/test-restructure.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let n = 0;
function has(hay, needle, msg) { n++; assert.ok(hay.includes(needle), msg); }
function lacks(hay, needle, msg) { n++; assert.ok(!hay.includes(needle), msg); }
function eq(a, b, msg) { n++; assert.strictEqual(a, b, msg); }
function ok(cond, msg) { n++; assert.ok(cond, msg); }

const index = read("index.html");

function extractArray(src, varName) {
  const re = new RegExp(`var ${varName} = \\[([\\s\\S]*?)\\n    \\];`);
  const m = src.match(re);
  assert.ok(m, `could not find ${varName} in index.html`);
  return new Function(`return ([${m[1]}]);`)();
}
const frontServices = extractArray(index, "SERVICES");
const frontCombos = extractArray(index, "COMBOS");
const sched = require("../lib/schedule.js");
const siteData = JSON.parse(read("site-data.json"));

// (1) Prices agree: index.html SERVICES/COMBOS == lib/schedule.js ==
// site-data.json. Durations agree too.
for (const s of frontServices) {
  const lib = sched.SERVICES.find((x) => x.id === s.id);
  ok(lib, `lib/schedule.js has ${s.id}`);
  eq(lib.priceNum, s.priceNum, `${s.id} priceNum: index.html == lib/schedule.js`);
  eq(lib.mins, s.mins, `${s.id} mins: index.html == lib/schedule.js`);
  const sd = siteData.services.find((x) => x.id === s.id);
  ok(sd, `site-data.json has ${s.id}`);
  eq(sd.priceCents, s.priceNum * 100, `${s.id} priceCents: site-data.json == index.html`);
  eq(sd.minutes, s.mins, `${s.id} minutes: site-data.json == index.html`);
  eq(siteData.prices[s.id], s.price, `${s.id} price label in site-data.json`);
  eq(siteData.durations[s.id], s.mins, `${s.id} duration in site-data.json`);
}
for (const c of frontCombos) {
  const lib = sched.COMBOS.find((x) => x.id === c.id);
  ok(lib, `lib/schedule.js has ${c.id}`);
  eq(lib.priceNum, c.priceNum, `${c.id} priceNum: index.html == lib/schedule.js`);
  eq(lib.mins, c.mins, `${c.id} mins: index.html == lib/schedule.js`);
  const sd = siteData.combos.find((x) => x.id === c.id);
  ok(sd, `site-data.json has ${c.id}`);
  eq(sd.priceCents, c.priceNum * 100, `${c.id} priceCents: site-data.json == index.html`);
}
eq(siteData.services.length, sched.SERVICES.length, "site-data.json covers every lib service (incl. consultation)");
eq(siteData.combos.length, sched.COMBOS.length, "site-data.json covers every lib combo");

// (2) The deposit is $30 everywhere.
eq(sched.DEPOSIT_CENTS, 3000, "lib/schedule.js DEPOSIT_CENTS is 3000");
has(sched.DEPOSIT_SENTENCE, "$30", "lib/schedule.js DEPOSIT_SENTENCE names $30");
has(index, "var DEPOSIT_CENTS = 3000;", "index.html DEPOSIT_CENTS is 3000");
has(index, "Pay a $30 deposit to lock in your time", "index.html deposit sentence names $30");
eq(siteData.deposit.cents, 3000, "site-data.json deposit is 3000 cents");
has(siteData.deposit.sentence, "$30", "site-data.json deposit sentence names $30");
eq(siteData.consult.priceCents, 3000, "site-data.json consultation is $30");
has(read("llms.txt"), "$30 deposit", "llms.txt carries the $30 deposit");

// (3) Footer link sets match across /, /classic-facial/,
// /facials-toronto/ and /questions/ — the footer is copied verbatim
// from index.html into every generated page.
function footerOf(hay) {
  const i = hay.indexOf('<footer class="site"');
  assert.ok(i >= 0, "footer found");
  return hay.slice(i, hay.indexOf("</footer>", i) + "</footer>".length);
}
function headerOf(hay) {
  const i = hay.indexOf('<header class="site"');
  assert.ok(i >= 0, "header found");
  return hay.slice(i, hay.indexOf("</header>", i) + "</header>".length);
}
const fourPages = {
  home: index,
  classic: read("classic-facial/index.html"),
  toronto: read("facials-toronto/index.html"),
  questions: read("questions/index.html"),
};
const footers = Object.entries(fourPages).map(([k, v]) => [k, footerOf(v)]);
const headers = Object.entries(fourPages).map(([k, v]) => [k, headerOf(v)]);
for (let i = 1; i < footers.length; i++) {
  eq(footers[i][1], footers[0][1], `footer on /${footers[i][0]}/ matches the home footer`);
  eq(headers[i][1], headers[0][1], `header on /${headers[i][0]}/ matches the home header`);
}
const foot = footers[0][1];
for (const [href, label] of [
  ["/classic-facial/", "Classic Facial"],
  ["/anti-aging-facial/", "Anti-Aging Facial"],
  ["/the-works/", "The Works"],
  ["/chemical-peels/", "Chemical Peels"],
  ["/microneedling/", "Microneedling"],
  ["/nano-needling/", "NANO Needling"],
  ["/microdermabrasion/", "Microdermabrasion"],
  ["/light-therapy/", "Light Therapy"],
  ["/reflexology/", "Reflexology"],
]) {
  has(foot, `<a href="${href}">${label}</a>`, `footer Treatments lists ${label}`);
}
for (const [href, label] of [
  ["/how-to-choose/", "How to choose"],
  ["/consultation/", "Consultation"],
]) {
  has(foot, `<a href="${href}">${label}</a>`, `footer Help-me-choose lists ${label}`);
}
for (const [slug, town] of [
  ["caledon", "Caledon"], ["kleinburg", "Kleinburg"], ["vaughan", "Vaughan"],
  ["brampton", "Brampton"], ["nobleton", "Nobleton"], ["king-city", "King City"],
  ["orangeville", "Orangeville"], ["georgetown", "Georgetown"],
  ["toronto", "Toronto"], ["mississauga", "Mississauga"],
]) {
  has(foot, `<a href="/facials-${slug}/">${town}</a>`, `footer towns list ${town}`);
}

// (4) Nav on every page: Services / How to choose / Skin concerns
// (7 links) / Occasions (4 links) / Gift / Contact + Book Online +
// Call.
const head = headers[0][1];
has(head, 'href="/services/"', "nav has Services");
has(head, 'href="/services/">Services</a>', "nav Services label");
has(head, 'href="/how-to-choose/"', "nav has How to choose");
has(head, 'href="/gift/"', "nav has Gift");
has(head, 'href="/contact/"', "nav has Contact");
has(head, 'href="/book/"', "nav has Book Online");
has(head, "tel:+12892124124", "nav has Call");
for (const href of ["/dry-skin/", "/acne-prone-skin/", "/teen-acne/", "/rosacea-sensitive-skin/", "/dull-skin/", "/fine-lines/", "/tired-skin/"]) {
  has(head, `href="${href}"`, `nav Skin concerns links ${href}`);
}
for (const href of ["/before-your-wedding/", "/business-workday-prep/", "/before-your-vacation/", "/after-hours-appointments/"]) {
  has(head, `href="${href}"`, `nav Occasions links ${href}`);
}

// (5) Needling is TWO pages; /needling/ is never a URL.
ok(exists("nano-needling/index.html"), "/nano-needling/ exists");
ok(exists("microneedling/index.html"), "/microneedling/ exists");
ok(!exists("needling"), "/needling/ does NOT exist");
const nano = read("nano-needling/index.html");
const micro = read("microneedling/index.html");
has(nano, "NANO Needling", "nano page names NANO Needling");
has(nano, "assets/video-nano-needling.mp4", "nano page uses the nano video");
has(micro, "Microneedling", "micro page names Microneedling");
has(micro, "assets/video-microneedling.mp4", "micro page uses the micro video");
has(nano, 'href="/?pick=needling#services"', "nano page books the merged needling treatment");
has(micro, 'href="/?pick=needling#services"', "micro page books the merged needling treatment");
const sitemap = read("sitemap.xml");
has(sitemap, "https://boltonfacials.com/nano-needling/", "sitemap lists /nano-needling/");
has(sitemap, "https://boltonfacials.com/microneedling/", "sitemap lists /microneedling/");
lacks(sitemap, "/needling/", "sitemap never lists /needling/");

// Service-page price rule: duration only in the panel, gold button
// pre-picks the treatment, no $ in the body outside
// [data-price-teaser] (script tags excluded — JSON-LD keeps the
// Offer price).
function bodyDollarLines(file) {
  const hay = read(file);
  const body = hay.slice(hay.indexOf("<body>"), hay.indexOf("</body>"));
  const noScripts = body.replace(/<script[\s\S]*?<\/script>/g, "");
  return noScripts.split("\n").filter((ln) => /\$\s?\d/.test(ln));
}
for (const [file, pick] of [
  ["classic-facial/index.html", "classic-facial"],
  ["anti-aging-facial/index.html", "anti-aging-facial"],
  ["nano-needling/index.html", "needling"],
  ["microneedling/index.html", "needling"],
  ["microdermabrasion/index.html", "microdermabrasion"],
  ["light-therapy/index.html", "light-therapy"],
  ["reflexology/index.html", "reflexology"],
  ["chemical-peels/index.html", "chemical-peels"],
  ["the-works/index.html", "combo-classic"],
]) {
  const hay = read(file);
  lacks(hay, 'class="pp-price"', `${file}: no price in the panel`);
  has(hay, "See price and book", `${file}: gold button says See price and book`);
  has(hay, `href="/?pick=${pick}#services"`, `${file}: gold button pre-picks ${pick}`);
  has(hay, '<p class="fine" data-price-teaser>Pay a $30 deposit to lock in your time', `${file}: panel carries the deposit sentence as a teaser`);
  for (const ln of bodyDollarLines(file)) {
    ok(ln.includes("data-price-teaser") || ln.includes("data-price-list"), `${file}: $ only inside a price teaser — ${ln.trim().slice(0, 60)}`);
  }
}
// Pairs chips: names + minutes only, no $.
for (const file of ["classic-facial/index.html", "anti-aging-facial/index.html", "the-works/index.html"]) {
  const hay = read(file);
  const start = hay.indexOf('<div class="pair-row">');
  const seg = hay.slice(start, hay.indexOf("</div>", start));
  lacks(seg, "$", `${file}: pairs chips carry no prices`);
}
// "Make it The Works" drops the $160/$195 figures.
for (const file of ["classic-facial/index.html", "anti-aging-facial/index.html"]) {
  const hay = read(file);
  has(hay, "Make it The Works", `${file}: Make it The Works block stays`);
  lacks(hay, "$160", `${file}: no $160 figure`);
  lacks(hay, "$195", `${file}: no $195 figure`);
}

// (6) vercel.json: /services/ + /book/ rewrite to the SPA; /faq/
// redirects to /questions/ (301). Existing entries kept.
const vercel = JSON.parse(read("vercel.json"));
ok(vercel.rewrites.some((r) => r.source === "/services/" && r.destination === "/index.html"), "vercel rewrites /services/ to /index.html");
ok(vercel.rewrites.some((r) => r.source === "/book/" && r.destination === "/index.html"), "vercel rewrites /book/ to /index.html");
ok(vercel.redirects && vercel.redirects.some((r) => r.source === "/faq/" && r.destination === "/questions/" && r.permanent === true), "vercel redirects /faq/ to /questions/ (301)");
ok(vercel.redirects.some((r) => r.source === "/faq" && r.destination === "/questions/"), "vercel redirects /faq to /questions/");
ok(vercel.rewrites.some((r) => r.source === "/pay"), "existing /pay rewrite kept");
ok(vercel.rewrites.some((r) => r.source === "/booked"), "existing /booked rewrite kept");
ok(Array.isArray(vercel.crons) && vercel.crons.length >= 2, "crons kept");
ok(Array.isArray(vercel.headers) && vercel.headers.length >= 1, "headers kept");

// (7) No street address in any generated page, or in the index.html
// body / JSON-LD (confirmation-only uses live in scripts, not here).
const generated = fs.readdirSync(ROOT).filter((d) => {
  const p = path.join(ROOT, d);
  return fs.statSync(p).isDirectory() && exists(path.join(d, "index.html")) && d !== "admin";
});
for (const d of generated) {
  lacks(read(path.join(d, "index.html")), "92 Willow Street", `no street address on /${d}/`);
}
const indexNoJs = index.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, "");
lacks(indexNoJs, "92 Willow Street", "no street address in index.html body/JSON-LD");
const ldBlocks = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
lacks(ldBlocks, "92 Willow Street", "no street address in index.html JSON-LD");

// (8) The 10 new pages exist (and are in the sitemap).
for (const slug of [
  "dry-skin", "teen-acne", "before-your-wedding", "business-workday-prep",
  "before-your-vacation", "after-hours-appointments", "how-to-choose",
  "consultation", "contact", "gift",
]) {
  ok(exists(`${slug}/index.html`), `/${slug}/ exists`);
  has(sitemap, `https://boltonfacials.com/${slug}/`, `sitemap lists /${slug}/`);
}
// New-page panel configs.
has(read("consultation/index.html"), "Consultation — $30, paid up front by card, credited in full toward your first treatment.", "consultation fine line");
has(read("gift/index.html"), "Gift codes never expire.", "gift fine line");
has(read("gift/index.html"), 'href="/#/gift"', "gift button goes to the gift screen");
has(read("how-to-choose/index.html"), 'href="/#services"', "how-to-choose button goes to the price list");
has(read("contact/index.html"), 'href="/book/"', "contact button goes to /book/");
has(read("after-hours-appointments/index.html"), "arranged by contacting Sarah", "after-hours page says visits are arranged by contacting Sarah");
lacks(read("after-hours-appointments/index.html"), "Private Hours", "after-hours page publishes no Private Hours price");

// Town pages: competitor figures gone, text otherwise intact.
for (const file of ["facials-toronto/index.html", "facials-mississauga/index.html"]) {
  const hay = read(file);
  for (const fig of ["$150 to $300", "$190 to $400", "$150 to $400", "$150–$300", "about $130", "$105 to $350", "$160 to $350"]) {
    lacks(hay, fig, `${file}: competitor figure ${fig} removed`);
  }
}
has(read("facials-toronto/index.html"), "The price gap, honestly", "Toronto keeps its price-gap section (figures only removed)");
has(read("facials-toronto/index.html"), "An escape from the city", "Toronto keeps its escape section");
// Competitor-figure repairs (Nov 19): the dangling verbs left by
// figure removal are completed with "more" — in the source data, so
// body and JSON-LD FAQ copies agree.
for (const s of [
  "A quality facial downtown costs more — and that is before the add-ons.",
  "where a custom facial downtown costs more — in a private, one-on-one studio with no waiting room and no rush.",
  "Downtown, a custom facial, a HydraFacial, and peels all cost more.",
]) {
  has(read("facials-toronto/index.html"), s, `Toronto repair present: ${s.slice(0, 50)}…`);
}
for (const s of [
  "most of them charging more for a facial, with medspas costing more.",
  "A facial in Mississauga costs more on average, and a signature facial at a medspa can cost more.",
  "On average, a facial costs more, with medspas costing more.",
]) {
  has(read("facials-mississauga/index.html"), s, `Mississauga repair present: ${s.slice(0, 50)}…`);
}
has(read("facials-mississauga/index.html"), "The price gap, honestly", "Mississauga keeps its price-gap section");
for (const file of ["facials-toronto/index.html", "facials-mississauga/index.html"]) {
  for (const ln of bodyDollarLines(file)) {
    ok(ln.includes("data-price-teaser") || ln.includes("data-price-list"), `${file}: $ only inside a price teaser — ${ln.trim().slice(0, 60)}`);
  }
}
// Questions page: deposit model, no pay-in-full, no competitor comparison.
const q = read("questions/index.html");
has(q, "Pay a $30 deposit to lock in your time", "questions page carries the deposit sentence");
lacks(q, "pay in full", "questions page has no pay-in-full wording");
lacks(q, "For comparison, a medi-spa", "questions page drops the competitor comparison");
has(q, "data-price-list", "questions Prices at a glance is a price list");

// (9) Custom 404 page.
ok(exists("404.html"), "404.html exists");
const nf = read("404.html");
has(nf, 'href="/book/"', "404 has a Book Online button to /book/");
has(nf, "tel:+12892124124", "404 has a Call button");
lacks(nf, "92 Willow Street", "404 has no street address");
lacks(nf, "$", "404 has no prices");
eq(headerOf(nf), headers[0][1], "404 header matches the home header");
eq(footerOf(nf), footers[0][1], "404 footer matches the home footer");

console.log(`test-restructure: all ${n} checks passed`);
