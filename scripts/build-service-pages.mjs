// Build the static service pages + sitemap.xml from the homepage's own
// data (SERVICES, SERVICE_VIDEOS, SEO_TITLES, SEO_DESCS, COMBOS and
// DEPOSIT_SENTENCE in index.html), so the pages can never drift from the
// approved copy/prices. Run: npm run build:pages
// (or: node scripts/build-service-pages.mjs)
// Re-run after any change to index.html services data.
//
// Pages: one per service (9 in total) — the six single services, TWO
// needling pages split from the one merged "needling" entry
// (/nano-needling/ and /microneedling/; /needling/ is never a URL),
// plus /the-works/ from COMBOS. Header/footer are copied verbatim
// from the rebuilt index.html (C4/C5) at build time, and a small
// inline script wires the dropdown toggles + burger (the SPA script
// is NOT on static pages).
//
// Price rule: NO $ figure in the page body except inside a
// [data-price-teaser] element (the deposit sentence) — the price
// panel shows the duration only, and the gold button sends the
// visitor to the picker with the treatment pre-picked. The street
// address never appears in a generated page (body or JSON-LD).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf-8");

function extract(varName) {
  const re = new RegExp(`var ${varName} = (\\{[\\s\\S]*?\\n    \\});`);
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${varName} in index.html`);
  return new Function(`return (${m[1]});`)();
}
function extractArray(varName) {
  const re = new RegExp(`var ${varName} = \\[([\\s\\S]*?)\\n    \\];`);
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${varName} in index.html`);
  return new Function(`return ([${m[1]}]);`)();
}
function extractString(varName) {
  const re = new RegExp(`var ${varName} = "((?:[^"\\\\]|\\\\.)*)";`);
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${varName} in index.html`);
  return JSON.parse(`"${m[1]}"`);
}
// Header/footer: copied EXACT from the rebuilt index.html (C4/C5) —
// the comment markers delimit them, so a rebuild always tracks the
// live header/footer.
function extractBlock(startMarker, endTag) {
  const i = html.indexOf(startMarker);
  if (i < 0) throw new Error(`could not find ${startMarker} in index.html`);
  const j = html.indexOf(endTag, i);
  if (j < 0) throw new Error(`could not find ${endTag} after ${startMarker} in index.html`);
  return html.slice(i, j + endTag.length);
}
const HEADER_HTML = extractBlock("<!-- ================= HEADER ================= -->", "</header>");
const FOOTER_HTML = extractBlock("<!-- ================= FOOTER ================= -->", "</footer>");

const SERVICES = extractArray("SERVICES");
const SERVICE_VIDEOS = extract("SERVICE_VIDEOS");
const SEO_TITLES = extract("SEO_TITLES");
const SEO_DESCS = extract("SEO_DESCS");
const COMBOS = extractArray("COMBOS");
const DEPOSIT_SENTENCE = extractString("DEPOSIT_SENTENCE");

const SITE = "https://boltonfacials.com";
const PHONE_DISPLAY = "(289) 212-4124";
const PHONE_TEL = "tel:+12892124124";
// Static SEO pages built by scripts/build-seo-pages.mjs — kept in the
// sitemap so a rebuild never drops them.
const EXTRA_PAGES = [
  "/facials-caledon/",
  "/facials-kleinburg/",
  "/facials-vaughan/",
  "/facials-brampton/",
  "/facials-nobleton/",
  "/facials-king-city/",
  "/facials-orangeville/",
  "/facials-georgetown/",
  "/facials-toronto/",
  "/facials-mississauga/",
  "/the-works/",
  "/acne-prone-skin/",
  "/rosacea-sensitive-skin/",
  "/dull-skin/",
  "/fine-lines/",
  "/tired-skin/",
  "/questions/",
  "/dry-skin/",
  "/teen-acne/",
  "/before-your-wedding/",
  "/business-workday-prep/",
  "/after-hours-appointments/",
  "/before-your-vacation/",
  "/how-to-choose/",
  "/consultation/",
  "/contact/",
  "/gift/",
  "/services/",
  "/book/",
  "/privacy.html",
];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const svcById = (id) => SERVICES.find((s) => s.id === id);
// Where a "Pairs well with" chip points: service pages by id, plus the
// two needling split pages (the merged "needling" id is never a URL).
const PAGE_BY_ID = {};
for (const s of SERVICES) {
  if (s.id !== "needling") PAGE_BY_ID[s.id] = { slug: s.id, name: s.name, mins: s.mins };
}
PAGE_BY_ID["nano-needling"] = { slug: "nano-needling", name: "NANO Needling", mins: 20 };
PAGE_BY_ID["microneedling"] = { slug: "microneedling", name: "Microneedling", mins: 20 };

// Small inline script for static pages only: dropdown toggles +
// burger (same behaviour as the SPA's initNav) + back-to-top. The
// SPA script is NOT loaded on static pages.
const NAV_SCRIPT = `<script>
(function(){
  var burger=document.getElementById("burger"), nav=document.getElementById("mainNav");
  function wireDrop(toggleId, menuId){
    var toggle=document.getElementById(toggleId), menu=document.getElementById(menuId);
    if(!toggle||!menu) return;
    toggle.addEventListener("click", function(ev){
      ev.stopPropagation();
      var otherId = toggleId==="concernToggle" ? "occMenu" : "concernMenu";
      var otherToggleId = toggleId==="concernToggle" ? "occToggle" : "concernToggle";
      var other=document.getElementById(otherId), otherToggle=document.getElementById(otherToggleId);
      if(other) other.classList.remove("open");
      if(otherToggle) otherToggle.setAttribute("aria-expanded","false");
      var open=menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open?"true":"false");
    });
  }
  wireDrop("concernToggle","concernMenu");
  wireDrop("occToggle","occMenu");
  document.addEventListener("click", function(ev){
    if(!ev.target.closest(".nav-drop")){
      var cm=document.getElementById("concernMenu"); if(cm) cm.classList.remove("open");
      var om=document.getElementById("occMenu"); if(om) om.classList.remove("open");
      var ct=document.getElementById("concernToggle"); if(ct) ct.setAttribute("aria-expanded","false");
      var ot=document.getElementById("occToggle"); if(ot) ot.setAttribute("aria-expanded","false");
    }
    if(!ev.target.closest("header.site")){
      if(nav) nav.classList.remove("open");
      document.body.classList.remove("nav-open");
      if(burger) burger.setAttribute("aria-expanded","false");
    }
  });
  if(burger&&nav) burger.addEventListener("click", function(){
    var open=nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", open?"true":"false");
    document.body.classList.toggle("nav-open", open);
  });
  if(nav) nav.addEventListener("click", function(ev){
    if(ev.target.closest("a")){
      var cm=document.getElementById("concernMenu"); if(cm) cm.classList.remove("open");
      var om=document.getElementById("occMenu"); if(om) om.classList.remove("open");
      var ct=document.getElementById("concernToggle"); if(ct) ct.setAttribute("aria-expanded","false");
      var ot=document.getElementById("occToggle"); if(ot) ot.setAttribute("aria-expanded","false");
      nav.classList.remove("open");
      document.body.classList.remove("nav-open");
      if(burger) burger.setAttribute("aria-expanded","false");
    }
  });
  var toTop=document.getElementById("toTop");
  function toTopShow(){ if(toTop) toTop.classList.toggle("show", window.scrollY>500); }
  window.addEventListener("scroll", toTopShow, {passive:true}); toTopShow();
  if(toTop) toTop.addEventListener("click", function(){ window.scrollTo({top:0, behavior:"smooth"}); });
})();
</script>`;

function headBlock({ title, desc, canonical, ogImage, ogImageAlt, ldBlocks }) {
  return `  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="In2Skin" />
    <meta property="og:locale" content="en_CA" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:alt" content="${esc(ogImageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${ogImage}" />
    <meta name="geo.region" content="CA-ON" />
    <meta name="geo.placename" content="Bolton" />
${ldBlocks
  .map(
    (ld) => `    <script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
    </script>`
  )
  .join("\n")}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/site.css?v=20261117f" />
    <link rel="stylesheet" href="/assets/motion.css?v=20261117d" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-R45TFHLRYW"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-R45TFHLRYW');
    </script>
  </head>`;
}

function tick(items) {
  return (
    `<ul class="tick-list">` +
    items
      .map(
        (t) =>
          `\n            <li><span class="tk"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5" stroke="#2F4A2C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${esc(t)}</span></li>`
      )
      .join("") +
    `\n          </ul>`
  );
}

function pricePanel({ minsLabel, pickId }) {
  return `        <aside class="price-panel">
          <div class="pp-mins">${esc(minsLabel)} · Bolton, Ontario</div>
          <a class="btn btn-book btn-big" href="/?pick=${esc(pickId)}#services" style="width:100%;">See price and book</a>
          <a class="btn btn-ghost" href="${PHONE_TEL}" style="width:100%;">Call ${PHONE_DISPLAY}</a>
          <p class="fine" data-price-teaser>${esc(DEPOSIT_SENTENCE)}</p>
        </aside>`;
}

function serviceLd({ name, desc, slug, priceNum }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name,
    description: desc,
    url: `${SITE}/${slug}/`,
    provider: {
      "@type": "BeautySalon",
      name: "In2Skin",
      url: `${SITE}/`,
      telephone: "+1-289-212-4124",
      priceRange: "$35 - $475",
      areaServed: ["Bolton", "Caledon", "Kleinburg", "Vaughan", "Brampton", "Nobleton", "King City", "Orangeville", "Georgetown", "Toronto", "Mississauga"],
    },
    offers:
      priceNum > 0
        ? { "@type": "Offer", "price": String(priceNum), "priceCurrency": "CAD", "itemOffered": { "@type": "Service", "name": name } }
        : { "@type": "Offer", "itemOffered": { "@type": "Service", "name": name, "description": "Custom treatment — priced per consultation, ask for a quote." } },
  };
}
function faqLd(faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((qa) => ({
      "@type": "Question",
      name: qa[0],
      acceptedAnswer: { "@type": "Answer", text: qa[1] },
    })),
  };
}

function shell({ head, hero, crumbs, main, panel }) {
  return `<!doctype html>
<html lang="en-CA">
${head}
  <body>
${HEADER_HTML}
    <main>
${hero}
      <div class="wrap"><div class="crumbs">${crumbs}</div>
      <div class="svc-layout">
        <div class="svc-main">
${main}
        </div>
${panel}
      </div></div>
      <div style="height:64px;"></div>
    </main>
${FOOTER_HTML}
    <button class="to-top" id="toTop" aria-label="Back to top">↑</button>
${NAV_SCRIPT}
  </body>
</html>
`;
}

function page(s, override) {
  const o = override || {};
  const slug = o.slug || s.id;
  const name = o.name || s.name;
  const img = o.img || s.img;
  const imgAlt = o.imgAlt || s.imgAlt;
  const video = o.video !== undefined ? o.video : SERVICE_VIDEOS[s.id];
  const title = o.title || SEO_TITLES[slug] || SEO_TITLES[s.id];
  const desc = o.desc || SEO_DESCS[slug] || SEO_DESCS[s.id];
  const pickId = o.pickId || s.id;
  const media = video
    ? `<video src="/${video}" poster="/${img}" autoplay muted loop playsinline preload="metadata" aria-label="${esc(imgAlt)}"></video>`
    : `<img src="/${img}" alt="${esc(imgAlt)}" />`;
  const pairs = s.pairs
    .map((pid) => {
      const p = PAGE_BY_ID[pid];
      if (!p) throw new Error(`unknown pair id ${pid} for ${s.id}`);
      return `<a class="pair-chip" href="/${p.slug}/">${esc(p.name)} · ${p.mins} min</a>`;
    })
    .join("");
  const faq = s.faq
    .map(([q, a]) => {
      const teaser = /\$\s?\d/.test(a) ? ' data-price-teaser' : "";
      return `<details><summary>${esc(q)}<span class="plus">+</span></summary><p${teaser}>${esc(a)}</p></details>`;
    })
    .join("");
  const works =
    s.id === "classic-facial" || s.id === "anti-aging-facial"
      ? `<h2>Make it The Works</h2><p>Facial treatment + red light + reflexology, all at once — <a href="/the-works/">The Works</a>. Just mention it when you book.</p>`
      : "";
  const head = headBlock({
    title,
    desc,
    canonical: `${SITE}/${slug}/`,
    ogImage: `${SITE}/${img}`,
    ogImageAlt: imgAlt,
    ldBlocks: [serviceLd({ name, desc, slug, priceNum: s.priceNum }), faqLd(s.faq)],
  });
  const hero = `      <section class="svc-hero">
        ${media}
        <div class="shade"></div>
        <div class="cap"><div class="wrap"><div class="cat">${esc(s.cat)} · Bolton, Ontario</div><h1>${esc(name)}</h1></div></div>
      </section>`;
  const main = `          ${s.intro.map((p) => `<p>${esc(p)}</p>`).join("\n          ")}
          <h2>What\u2019s included</h2>${tick(s.includes)}
          <h2>Benefits</h2>${tick(s.benefits)}
          ${works}
          <h2>Questions</h2>
          <div class="faq">${faq}</div>
          <h2>Pairs well with</h2>
          <div class="pair-row">${pairs}</div>`;
  return shell({
    head,
    hero,
    crumbs: `<a href="/">Home</a> · <a href="/">Treatments</a> · ${esc(name)}`,
    main,
    panel: pricePanel({ minsLabel: s.minsLabel, pickId }),
  });
}

// /the-works/ from COMBOS — same C4/C5 header/footer, C3-style
// panel (duration only, gold "See price and book" pre-picking the
// Classic option). Copy below is the approved Works page copy.
const WORKS_COPY = {
  intro: ["Facial treatment + red light therapy + reflexology, all at the same time while your mask works. So relaxing, clients fall asleep."],
  includes: [
    "Your facial treatment — Classic or Anti-Aging, tailored to your skin that day",
    "Warm red light therapy while your mask works",
    "Reflexology to finish — gentle foot pressure, whole-body calm",
    "One unhurried visit, one price",
  ],
  ways: ["The Works with Classic Facial — 55 minutes", "The Works with Anti-Aging Facial — 80 minutes"],
  faq: [
    ["What is The Works?", "A facial treatment, red light therapy and reflexology, all at the same time while your mask works — $160 with a Classic Facial (55 minutes) or $195 with an Anti-Aging Facial (80 minutes)."],
    ["How does it feel?", "Warm, gentle & deeply relaxing. Many clients drift off — and wake up glowing."],
    ["Can I add anything else?", "Yes — NANO Needling ($65) or Microdermabrasion ($55) pair well with either option. Just mention it when you book."],
    ["Is it good for a first visit?", "Perfect for first-timers — the full experience in one visit."],
  ],
  pairs: ["nano-needling", "microdermabrasion"],
};
function worksPage() {
  const comboClassic = COMBOS.find((c) => c.id === "combo-classic");
  const comboAnti = COMBOS.find((c) => c.id === "combo-anti");
  if (!comboClassic || !comboAnti) throw new Error("COMBOS missing combo-classic / combo-anti in index.html");
  const title = SEO_TITLES["the-works"];
  const desc = SEO_DESCS["the-works"];
  const img = "assets/works-massage.webp";
  const imgAlt = "The Works treatment room — a massage table set with candles, white tulips and a rolled towel, ready for a facial treatment, red light and reflexology session";
  const faq = WORKS_COPY.faq
    .map(([q, a]) => {
      const teaser = /\$\s?\d/.test(a) ? ' data-price-teaser' : "";
      return `<details><summary>${esc(q)}<span class="plus">+</span></summary><p${teaser}>${esc(a)}</p></details>`;
    })
    .join("");
  const pairs = WORKS_COPY.pairs
    .map((pid) => {
      const p = PAGE_BY_ID[pid];
      return `<a class="pair-chip" href="/${p.slug}/">${esc(p.name)} · ${p.mins} min</a>`;
    })
    .join("");
  const ways = WORKS_COPY.ways
    .map((w, i) => {
      const pick = i === 0 ? "combo-classic" : "combo-anti";
      return `\n            <li><span class="tk"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5" stroke="#2F4A2C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><a href="/?pick=${pick}#services">${esc(w)}</a></span></li>`;
    })
    .join("");
  const head = headBlock({
    title,
    desc,
    canonical: `${SITE}/the-works/`,
    ogImage: `${SITE}/${img}`,
    ogImageAlt: imgAlt,
    ldBlocks: [
      serviceLd({ name: "The Works", desc, slug: "the-works", priceNum: comboClassic.priceNum }),
      faqLd(WORKS_COPY.faq),
    ],
  });
  const hero = `      <section class="svc-hero">
        <video src="/assets/video-red-light.mp4" poster="/${img}" autoplay muted loop playsinline preload="metadata" aria-label="${esc(imgAlt)}"></video>
        <div class="shade"></div>
        <div class="cap"><div class="wrap"><div class="cat">Signature Combo · Bolton, Ontario</div><h1>The Works — all at once</h1></div></div>
      </section>`;
  const main = `          ${WORKS_COPY.intro.map((p) => `<p>${esc(p)}</p>`).join("\n          ")}
          <h2>What\u2019s included</h2>${tick(WORKS_COPY.includes)}
          <h2>Two ways to have it</h2><ul class="tick-list">${ways}
          </ul>
          <h2>Questions</h2>
          <div class="faq">${faq}</div>
          <h2>Pairs well with</h2>
          <div class="pair-row">${pairs}</div>
          <div class="photo-stack" style="margin-top:28px;"><img class="framed-img" src="/assets/works-mask.jpg" alt="A custom mask being brushed onto a resting client’s face while she relaxes during The Works" loading="lazy" /></div>`;
  const panel = `        <aside class="price-panel">
          <div class="pp-mins">${esc(comboClassic.minsLabel)} · Bolton, Ontario</div>
          <a class="btn btn-book btn-big" href="/?pick=combo-classic#services" style="width:100%;">See price and book</a>
          <a class="btn btn-ghost" href="/?pick=combo-anti#services" style="width:100%;">The Works with Anti-Aging — ${esc(comboAnti.minsLabel)}</a>
          <a class="btn btn-ghost" href="${PHONE_TEL}" style="width:100%;">Call ${PHONE_DISPLAY}</a>
          <p class="fine" data-price-teaser>${esc(DEPOSIT_SENTENCE)}</p>
        </aside>`;
  return shell({
    head,
    hero,
    crumbs: `<a href="/">Home</a> · <a href="/">Treatments</a> · The Works`,
    main,
    panel,
  });
}

const pages = [];
// Needling splits FIRST (from the merged entry's shared copy), then
// the other services in SERVICES order.
const needling = svcById("needling");
if (!needling) throw new Error("merged needling entry missing from SERVICES in index.html");
for (const split of [
  { slug: "nano-needling", name: "NANO Needling", img: "assets/nano-needling.webp", video: "assets/video-nano-needling.mp4" },
  { slug: "microneedling", name: "Microneedling", img: "assets/microneedling.webp", video: "assets/video-microneedling.mp4" },
]) {
  const dir = join(ROOT, split.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    page(needling, { slug: split.slug, name: split.name, img: split.img, video: split.video, pickId: "needling" })
  );
  pages.push(`/${split.slug}/`);
  console.log("wrote", `${split.slug}/index.html`);
}
for (const s of SERVICES) {
  if (s.id === "needling") continue;
  const dir = join(ROOT, s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(s));
  pages.push(`/${s.id}/`);
  console.log("wrote", `${s.id}/index.html`);
}
// /the-works/ from COMBOS.
{
  const dir = join(ROOT, "the-works");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), worksPage());
  pages.push("/the-works/");
  console.log("wrote", "the-works/index.html");
}
// 404.html — same C4/C5 header/footer, Book Online + Call, no
// prices, no street address. Regenerated here so it tracks the
// live header/footer.
writeFileSync(
  join(ROOT, "404.html"),
  `<!doctype html>
<html lang="en-CA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>Page not found | In2Skin — Bolton, Ontario</title>
    <meta name="description" content="That page isn't here — but a facial treatment in Bolton is. Book online or call In2Skin on (289) 212-4124." />
    <meta name="robots" content="noindex" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/site.css?v=20261117f" />
    <link rel="stylesheet" href="/assets/motion.css?v=20261117d" />
  </head>
  <body>
${HEADER_HTML}
    <main>
      <div class="wrap" style="padding:72px 0 96px; text-align:center;">
        <div class="crumbs" style="text-align:left;"><a href="/">Home</a> · Page not found</div>
        <h1 style="margin-top:28px;">This page isn&rsquo;t here</h1>
        <p style="max-width:520px; margin:12px auto 28px;">The link may have moved, or the address may have a typo. The studio is still here in Bolton — and booking takes a minute.</p>
        <p>
          <a class="btn btn-book" href="/book/">Book Online</a>
          <a class="btn btn-ghost" href="${PHONE_TEL}" style="margin-left:10px;">Call ${PHONE_DISPLAY}</a>
        </p>
        <p style="margin-top:22px;"><a href="/">Back to the home page</a> · <a href="/services/">See all treatments</a></p>
      </div>
    </main>
${FOOTER_HTML}
    <button class="to-top" id="toTop" aria-label="Back to top">↑</button>
${NAV_SCRIPT}
  </body>
</html>
`
);
console.log("wrote 404.html");
// /needling/ is never a URL — drop any stale build of it.
if (existsSync(join(ROOT, "needling"))) {
  rmSync(join(ROOT, "needling"), { recursive: true, force: true });
  console.log("removed stale needling/");
}

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [`/`, ...pages, ...EXTRA_PAGES.filter((p) => !pages.includes(p))]
    .map((p) => `  <url><loc>${SITE}${p}</loc></url>`)
    .join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
console.log("wrote sitemap.xml with", pages.length + EXTRA_PAGES.filter((p) => !pages.includes(p)).length + 1, "urls");
