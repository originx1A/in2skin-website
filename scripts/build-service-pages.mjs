// Build the nine static service pages + sitemap.xml from the homepage's own
// data (SERVICES, SERVICE_VIDEOS, AH_PRICE, SEO_TITLES, SEO_DESCS in
// index.html), so the pages can never drift from the approved copy/prices.
// Run: npm run build:pages   (or: node scripts/build-service-pages.mjs)
// Re-run after any change to index.html services data.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const SERVICES = extractArray("SERVICES");
const SERVICE_VIDEOS = extract("SERVICE_VIDEOS");
const AH_PRICE = extract("AH_PRICE");
const SEO_TITLES = extract("SEO_TITLES");
const SEO_DESCS = extract("SEO_DESCS");

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
  "/acne-prone-skin/",
  "/rosacea-sensitive-skin/",
  "/dull-skin/",
  "/fine-lines/",
  "/tired-skin/",
  "/questions/",
];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const svcById = (id) => SERVICES.find((s) => s.id === id);

function page(s) {
  const video = SERVICE_VIDEOS[s.id];
  const media = video
    ? `<video src="/${video}" poster="/${s.img}" autoplay muted loop playsinline preload="metadata" aria-label="${esc(s.imgAlt)}"></video>`
    : `<img src="/${s.img}" alt="${esc(s.imgAlt)}" />`;
  const pairs = s.pairs
    .map((pid) => {
      const p = svcById(pid);
      return `<a class="pair-chip" href="/${p.id}/">${esc(p.name)} <b>${esc(p.price)} · ${p.mins} min</b></a>`;
    })
    .join("");
  const faq = s.faq
    .map((qa) => `<details><summary>${esc(qa[0])}<span class="plus">+</span></summary><p>${esc(qa[1])}</p></details>`)
    .join("");
  const tick = (items) =>
    `<ul class="tick-list">` +
    items.map((t) => `<li><span class="tk"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5" stroke="#2F4A2C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${esc(t)}</span></li>`).join("") +
    `</ul>`;
  const works =
    s.id === "classic-facial" || s.id === "anti-aging-facial"
      ? `<h2>Make it The Works</h2><p>Facial + red light + reflexology, all at once — <strong>The Works: ${s.id === "classic-facial" ? "$135" : "$165"}</strong>. Just mention it when you book.</p>`
      : "";
  const priceOffer =
    s.priceNum > 0
      ? `{ "@type": "Offer", "price": "${s.priceNum}", "priceCurrency": "CAD", "itemOffered": { "@type": "Service", "name": "${esc(s.name)}" } }`
      : `{ "@type": "Offer", "itemOffered": { "@type": "Service", "name": "${esc(s.name)}", "description": "Custom treatment — priced per consultation, ask for a quote." } }`;
  const ld = {
    service: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: s.name,
      description: SEO_DESCS[s.id],
      url: `${SITE}/${s.id}/`,
      provider: {
        "@type": "BeautySalon",
        name: "In2Skin",
        url: `${SITE}/`,
        telephone: "+1-289-212-4124",
        priceRange: "$25 - $475",
        address: {
          "@type": "PostalAddress",
          streetAddress: "92 Willow Street",
          addressLocality: "Bolton",
          addressRegion: "ON",
          postalCode: "L7E 3G3",
          addressCountry: "CA",
        },
        geo: { "@type": "GeoCoordinates", latitude: 43.88088, longitude: -79.73492 },
        areaServed: ["Bolton", "Caledon", "Kleinburg", "Vaughan", "Brampton", "Nobleton", "King City", "Orangeville", "Georgetown", "Toronto"],
      },
      offers: JSON.parse(priceOffer),
    },
    faq: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: s.faq.map((qa) => ({
        "@type": "Question",
        name: qa[0],
        acceptedAnswer: { "@type": "Answer", text: qa[1] },
      })),
    },
  };

  return `<!doctype html>
<html lang="en-CA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>${esc(SEO_TITLES[s.id])}</title>
    <meta name="description" content="${esc(SEO_DESCS[s.id])}" />
    <link rel="canonical" href="${SITE}/${s.id}/" />
    <meta name="geo.region" content="CA-ON" />
    <meta name="geo.placename" content="Bolton" />
    <script type="application/ld+json">
${JSON.stringify(ld.service, null, 2)}
    </script>
    <script type="application/ld+json">
${JSON.stringify(ld.faq, null, 2)}
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/assets/site.css?v=20261117f" />
    <link rel="stylesheet" href="/assets/motion.css?v=20261117d" />
  </head>
  <body>
    <header class="site">
      <div class="wrap header-in">
        <a class="brand" href="/" aria-label="In2Skin — home"><span class="brand-text"><span class="wordmark">In2Skin</span><span class="tagline">Aesthetics · Bolton</span></span></a>
        <nav class="main" aria-label="Main">
          <a href="/">Home</a>
          <a href="/#book">Book Online</a>
          <a href="/#visit">Visit Us</a>
        </nav>
        <a class="btn btn-book btn-book-sm header-book" href="/#book" style="white-space:nowrap;">Book Online</a>
        <a class="btn btn-ghost header-call" href="${PHONE_TEL}" aria-label="Call In2Skin to book">Call<span class="btn-label-num">&nbsp;· ${PHONE_DISPLAY}</span></a>
      </div>
    </header>
    <main>
      <section class="svc-hero">
        ${media}
        <div class="shade"></div>
        <div class="cap"><div class="wrap"><div class="cat">${esc(s.cat)} · Bolton, Ontario</div><h1>${esc(s.name)}</h1></div></div>
      </section>
      <div class="wrap"><div class="crumbs"><a href="/">Home</a> · <a href="/">Treatments</a> · ${esc(s.name)}</div>
      <div class="svc-layout">
        <div class="svc-main">
          ${s.intro.map((p) => `<p>${esc(p)}</p>`).join("\n          ")}
          <h2>What\u2019s included</h2>${tick(s.includes)}
          <h2>Benefits</h2>${tick(s.benefits)}
          ${works}
          <h2>Questions</h2>
          <div class="faq">${faq}</div>
          <h2>Pairs well with</h2>
          <div class="pair-row">${pairs}</div>
        </div>
        <aside class="price-panel">
          <div class="pp-price">${esc(s.price)}</div>
          <div class="pp-mins">${esc(s.minsLabel)} · Bolton, Ontario</div>
          <p style="font-size:.93rem; color:var(--ink-soft); margin-bottom:16px;">Private Hours: <strong style="color:var(--sage-deep);">${esc(AH_PRICE[s.id])}</strong></p>
          <a class="btn btn-book btn-big" href="/#book" style="width:100%;">${s.price === "Custom" ? "Book a Consultation" : "Book Online — " + esc(s.price)}</a>
          <a class="btn btn-ghost" href="${PHONE_TEL}" style="width:100%;">Call ${PHONE_DISPLAY}</a>
          <p class="fine">Pay in full securely by card when you book.<br />Cash or e-transfer also welcome at your visit.</p>
        </aside>
      </div></div>
      <div style="height:64px;"></div>
    </main>
    <footer class="site">
      <div class="wrap">
        <div class="foot-in">
          <div>
            <p style="font-family:'Cormorant Garamond',serif; font-size:1.5rem; font-weight:600; margin-bottom:8px;">In2Skin</p>
            <p>Facials &amp; skin treatments by appointment in Bolton, Ontario.</p>
            <a class="btn btn-call" href="${PHONE_TEL}" style="margin-top:8px;">Call to Book · ${PHONE_DISPLAY}</a>
          </div>
          <div>
            <h4>Treatments</h4>
            <ul class="foot-links">
              ${SERVICES.map((x) => `<li><a href="/${x.id}/">${esc(x.name)} — ${esc(x.price)}</a></li>`).join("\n              ")}
            </ul>
          </div>
          <div>
            <h4>Good to Know</h4>
            <ul class="foot-links">
              <li>Directions shared when you book</li>
              <li>Booking: by phone, or online anytime</li>
              <li>First visit? $10 toward any service</li>
              <li><a href="/questions/">Questions about facials? See our answers</a></li>
            </ul>
          </div>
        </div>
        <div class="foot-bottom">
          <span>© 2026 In2Skin · Bolton, Ontario</span>
          <span>Website by <a href="mailto:hello.funderwood@gmail.com">Funderwood</a></span>
        </div>
      </div>
    </footer>
    <button class="to-top" id="toTop" aria-label="Back to top">↑</button>
    <script>
    var toTop=document.getElementById("toTop"); function toTopShow(){ if(toTop) toTop.classList.toggle("show", window.scrollY>500); } window.addEventListener("scroll", toTopShow, {passive:true}); toTopShow(); if(toTop) toTop.addEventListener("click", function(){ window.scrollTo({top:0, behavior:"smooth"}); });
    </script>
  </body>
</html>
`;
}

const pages = [];
for (const s of SERVICES) {
  const dir = join(ROOT, s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(s));
  pages.push(`/${s.id}/`);
  console.log("wrote", `${s.id}/index.html`);
}

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  [`/`, ...pages, ...EXTRA_PAGES]
    .map((p) => `  <url><loc>${SITE}${p}</loc></url>`)
    .join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
console.log("wrote sitemap.xml with", pages.length + EXTRA_PAGES.length + 1, "urls");
