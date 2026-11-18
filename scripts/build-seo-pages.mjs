// Build the SEO pages: 8 location pages, 5 skin-concern pages, 1 questions
// page — all static HTML in the service-page style (same header, hero,
// layout, price panel and footer). Run: node scripts/build-seo-pages.mjs
// Pages are static; sitemap entries live in scripts/build-service-pages.mjs
// (EXTRA_PAGES) so `npm run build:pages` keeps the sitemap complete.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://boltonfacials.com";
const PHONE_DISPLAY = "(289) 212-4124";
const PHONE_TEL = "tel:+12892124124";
const GEO = { lat: 43.88088, lon: -79.73492 };

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TREATMENT_LINKS = [
  ["classic-facial", "Classic Facial", "$65"],
  ["anti-aging-facial", "Anti-Aging Facial", "$95"],
  ["nano-needling", "NANO Needling", "$55"],
  ["microdermabrasion", "Microdermabrasion", "$45"],
  ["light-therapy", "Light Therapy", "$45"],
  ["reflexology", "Reflexology", "$25"],
  ["chemical-peels", "Chemical Peels", "$95–$475"],
  ["microneedling", "Microneedling", "Custom"],
  ["skin-tightening", "Skin Tightening", "Custom"],
];

const FOOT_TREATMENTS = TREATMENT_LINKS.map(
  ([id, name, price]) => `<li><a href="/${id}/">${esc(name)} — ${esc(price)}</a></li>`
).join("\n              ");

function footer() {
  return `<footer class="site">
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
              ${FOOT_TREATMENTS}
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
    </footer>`;
}

function header() {
  return `<header class="site">
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
    </header>`;
}

// p = { slug, title, desc, cat, h1, img, imgAlt, crumbs, intro[], sections: [{h, body[] | ticks[]}], leadPrice, leadPriceLabel, leadMins, panelExtra, faq: [[q,a]], crossTitle, cross: [[href, label]], serviceName, serviceDesc, areaServedExtra }
function page(p) {
  const serviceLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: p.serviceName,
    description: p.desc,
    url: `${SITE}/${p.slug}/`,
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
      geo: { "@type": "GeoCoordinates", latitude: GEO.lat, longitude: GEO.lon },
      areaServed: ["Bolton", "Caledon", "Kleinburg", "Vaughan", "Brampton", "Nobleton", "King City", "Orangeville", "Georgetown", "Toronto"],
    },
    areaServed: p.areaServedExtra || "Bolton",
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map(([q, a]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  const sections = p.sections
    .map((s) => {
      const body = s.ticks
        ? `<ul class="tick-list">` +
          s.ticks
            .map(
              (t) =>
                `<li><span class="tk"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5" stroke="#2F4A2C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${esc(t)}</span></li>`
            )
            .join("") +
          `</ul>`
        : s.body.map((para) => `<p>${esc(para)}</p>`).join("\n          ");
      return `<h2>${esc(s.h)}</h2>${body}`;
    })
    .join("\n          ");
  const faqHtml = p.faq
    .map(([q, a]) => `<details><summary>${esc(q)}<span class="plus">+</span></summary><p>${esc(a)}</p></details>`)
    .join("");
  const cross = p.cross
    .map(([href, label]) => `<a class="pair-chip" href="${href}">${esc(label)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en-CA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>${esc(p.title)}</title>
    <meta name="description" content="${esc(p.desc)}" />
    <link rel="canonical" href="${SITE}/${p.slug}/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="In2Skin" />
    <meta property="og:locale" content="en_CA" />
    <meta property="og:url" content="${SITE}/${p.slug}/" />
    <meta property="og:title" content="${esc(p.title)}" />
    <meta property="og:description" content="${esc(p.desc)}" />
    <meta property="og:image" content="${SITE}/assets/${p.img}" />
    <meta property="og:image:alt" content="${esc(p.imgAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(p.title)}" />
    <meta name="twitter:description" content="${esc(p.desc)}" />
    <meta name="twitter:image" content="${SITE}/assets/${p.img}" />
    <meta name="geo.region" content="CA-ON" />
    <meta name="geo.placename" content="Bolton" />
    <script type="application/ld+json">
${JSON.stringify(serviceLd, null, 2)}
    </script>
    <script type="application/ld+json">
${JSON.stringify(faqLd, null, 2)}
    </script>
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
  </head>
  <body>
    ${header()}
    <main>
      <section class="svc-hero">
        <img src="/assets/${p.img}" alt="${esc(p.imgAlt)}" />
        <div class="shade"></div>
        <div class="cap"><div class="wrap"><div class="cat">${esc(p.cat)} · Bolton, Ontario</div><h1>${esc(p.h1)}</h1></div></div>
      </section>
      <div class="wrap"><div class="crumbs">${p.crumbs}</div>
      <div class="svc-layout">
        <div class="svc-main">
          ${p.intro.map((para) => `<p>${esc(para)}</p>`).join("\n          ")}
          ${sections}
          <h2>Questions</h2>
          <div class="faq">${faqHtml}</div>
          <h2>${esc(p.crossTitle)}</h2>
          <div class="pair-row">${cross}</div>
        </div>
        <aside class="price-panel">
          <div class="pp-price">${esc(p.leadPrice)}</div>
          <div class="pp-mins">${esc(p.leadMins)} · Bolton, Ontario</div>
          ${p.panelExtra ? `<p style="font-size:.93rem; color:var(--ink-soft); margin-bottom:16px;">${p.panelExtra}</p>` : ""}
          <a class="btn btn-book btn-big" href="/#book" style="width:100%;">Book Online — ${esc(p.leadPrice)}</a>
          <a class="btn btn-ghost" href="${PHONE_TEL}" style="width:100%;">Call ${PHONE_DISPLAY}</a>
          <p class="fine">Pay in full securely by card when you book.<br />Cash or e-transfer also welcome at your visit.</p>
        </aside>
      </div></div>
      <div style="height:64px;"></div>
    </main>
    ${footer()}
    <button class="to-top" id="toTop" aria-label="Back to top">↑</button>
    <script>
    var toTop=document.getElementById("toTop"); function toTopShow(){ if(toTop) toTop.classList.toggle("show", window.scrollY>500); } window.addEventListener("scroll", toTopShow, {passive:true}); toTopShow(); if(toTop) toTop.addEventListener("click", function(){ window.scrollTo({top:0, behavior:"smooth"}); });
    </script>
  </body>
</html>
`;
}

const LOCATIONS = [
  {
    slug: "facials-caledon",
    town: "Caledon",
    title: "Facials in Caledon | In2Skin — Bolton, Ontario",
    desc: "Facials in Caledon at In2Skin — a private, one-on-one aesthetics studio right here in Bolton, in the Town of Caledon. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Caledon",
    h1: "Facials in Caledon",
    img: "area-village.webp",
    imgAlt: "A quiet village street in Bolton, Ontario, in soft evening light",
    intro: [
      "You don't need to leave town for a proper facial. In2Skin is right here in Bolton — in the Town of Caledon — a private, one-on-one studio where every treatment is made for your skin that day.",
      "No highway, no city traffic, no crowded spa with three other clients in the room. Just one guest at a time, in a calm room, with time to do the work properly.",
    ],
    sections: [
      {
        h: "A short drive from anywhere in Caledon",
        body: [
          "Bolton sits at the south end of Caledon, an easy drive on local roads from Caledon East, Caledon Village, Inglewood, Mono Mills, Alton and Cheltenham — most of the town is 10 to 20 minutes away. Directions are shared when you book, and the studio is by appointment, so there is never a wait.",
          "Because the studio is local, regular visits are easy to keep: a facial every 4 to 6 weeks fits into a normal week, not a special trip.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask. The everyday refresh, and the best first facial.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once while the mask works.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25 — add one to any facial, or book one on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit, for times that fit around work and school. Gift certificates start at $10 and never expire, and you can book an appointment for a friend and have the confirmation go straight to them.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["Is the studio actually in Caledon?", "Yes — In2Skin is in Bolton, which is in the Town of Caledon. The studio is a private treatment room, by appointment."],
      ["How long is the drive from Caledon East or Caledon Village?", "About 10 to 20 minutes on local roads from most of Caledon. Directions are shared when you book."],
      ["What should I book for my first facial?", "The Classic Facial, $65 for 55 minutes. It is tailored to your skin that day, with every step explained — and $10 off your first visit."],
      ["Do you have evening appointments?", "Yes — Private Hours run weekday evenings after 7 PM and on Sundays, for $15 more per visit."],
    ],
    areaServedExtra: "Caledon",
  },
  {
    slug: "facials-kleinburg",
    town: "Kleinburg",
    title: "Facials in Kleinburg | In2Skin — Bolton, Ontario",
    desc: "Facials near Kleinburg at In2Skin — a private, one-on-one aesthetics studio in Bolton, straight up Highway 50, about 15 minutes away. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Kleinburg",
    h1: "Facials near Kleinburg",
    img: "area-road.webp",
    imgAlt: "A quiet country road in Caledon, Ontario, lined with trees",
    intro: [
      "Kleinburg knows the value of a quiet village — and Bolton is the same kind of place, straight up Highway 50, about 15 minutes away. In2Skin is a private, one-on-one studio: one guest at a time, no waiting room, no rush.",
      "Come up for a facial, then wander the village. It is the same unhurried feeling Kleinburg is known for, with an esthetician's full attention on your skin.",
    ],
    sections: [
      {
        h: "The drive from Kleinburg",
        body: [
          "Highway 50 north from Kleinburg village brings you to Bolton in about 15 minutes — a straight, easy drive through open country. Directions are shared when you book, and appointments are one at a time, so your time is yours from the moment you arrive.",
          "Many Kleinburg clients book the longer treatments: eighty unhurried minutes is the point of the trip, not something squeezed in between errands.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask, with no downtime.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Kleinburg?", "About 15 minutes — straight up Highway 50 from Kleinburg village to Bolton. Directions are shared when you book."],
      ["What should I book first?", "The Classic Facial, $65 for 55 minutes, is the best first visit — tailored to your skin that day, with $10 off."],
      ["Is there a longer treatment for a real break?", "Yes — the Anti-Aging Facial is 80 minutes for $95, and The Works adds red light and reflexology at the same time, $135 with a Classic Facial."],
      ["Can I book for a friend in Kleinburg?", "Yes — choose 'For a Friend' when you book and the confirmation goes straight to them."],
    ],
    areaServedExtra: "Kleinburg",
  },
  {
    slug: "facials-vaughan",
    town: "Vaughan",
    title: "Facials in Vaughan | In2Skin — Bolton, Ontario",
    desc: "Facials near Vaughan at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 20 minutes north of Woodbridge on Highway 50. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Vaughan",
    h1: "Facials near Vaughan",
    img: "area-aerial.webp",
    imgAlt: "An aerial view of green countryside and quiet roads north of Vaughan, Ontario",
    intro: [
      "Vaughan has plenty of spas — most of them busy, loud, and booked back to back. In2Skin is the opposite: a private studio in Bolton, about 20 minutes north of Woodbridge on Highway 50, where one guest is treated at a time.",
      "Clients come up from Woodbridge, Maple, Thornhill and Concord for the quiet. No waiting room, no rush, no one else's appointment running over into yours.",
    ],
    sections: [
      {
        h: "The drive from Vaughan",
        body: [
          "Highway 50 north from Woodbridge brings you to Bolton in about 20 minutes. From Maple and Thornhill it is a similar trip by way of Rutherford Road and Highway 50. Directions are shared when you book.",
          "Evening and Sunday appointments — Private Hours — suit Vaughan clients who work in the city all week: weekday mornings 7 to 9, evenings after 7, and Sundays, for $15 more per visit.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask. The everyday refresh.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25 — or book an add-on on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Gift certificates start at $10 and never expire, and a treatment voucher — a named facial, paid ahead — makes an easy gift for someone in Vaughan who would never book for themselves.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Vaughan?", "About 20 minutes north of Woodbridge on Highway 50. From Maple and Thornhill, a similar trip via Rutherford Road and Highway 50."],
      ["Why drive to Bolton for a facial?", "For a private, one-on-one studio — one guest at a time, no waiting room, no rush — instead of a busy city spa."],
      ["Do you have appointments after work?", "Yes — Private Hours run weekday evenings after 7 PM and on Sundays, for $15 more per visit."],
      ["What does a facial cost?", "The Classic Facial is $65 for 55 minutes; the Anti-Aging Facial is $95 for 80 minutes. Add-ons run $25 to $55."],
    ],
    areaServedExtra: "Vaughan",
  },
  {
    slug: "facials-brampton",
    town: "Brampton",
    title: "Facials in Brampton | In2Skin — Bolton, Ontario",
    desc: "Facials near Brampton at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 25 minutes north on Highway 50. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Brampton",
    h1: "Facials near Brampton",
    img: "spa-room-new.jpg",
    imgAlt: "A calm, private treatment room with a facial bed, warm light and soft towels",
    intro: [
      "Brampton is full of salons — and full of lineups. In2Skin is a different kind of appointment: a private studio in Bolton, about 25 minutes north on Highway 50, where one guest is treated at a time and the room is quiet.",
      "Clients come up from Brampton for the calm as much as the skin work: a proper facial, a real break, and no one rushing you out the door.",
    ],
    sections: [
      {
        h: "The drive from Brampton",
        body: [
          "Highway 50 north from Brampton — by way of Mayfield Road — brings you to Bolton in about 25 minutes. Directions are shared when you book, and the studio is by appointment, so there is never a wait when you arrive.",
          "Brampton clients often book ahead of a big day: microdermabrasion for an instant radiant glow before weddings, events and photos, or a full facial the week before.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask, with no downtime.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "Microdermabrasion — $45 · 15 minutes. A precision polish for brighter, smoother skin — a favourite before events and photos.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Brampton?", "About 25 minutes north on Highway 50, by way of Mayfield Road. Directions are shared when you book."],
      ["What is good before a wedding or event?", "Microdermabrasion, $45, gives an instant radiant glow, and a Classic Facial the week before leaves skin fresh and bright."],
      ["What does a facial cost?", "The Classic Facial is $65 for 55 minutes; the Anti-Aging Facial is $95 for 80 minutes. Add-ons run $25 to $55."],
      ["Can I book an evening appointment?", "Yes — Private Hours run weekday evenings after 7 PM and on Sundays, for $15 more per visit."],
    ],
    areaServedExtra: "Brampton",
  },
  {
    slug: "facials-nobleton",
    town: "Nobleton",
    title: "Facials in Nobleton | In2Skin — Bolton, Ontario",
    desc: "Facials near Nobleton at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 10 minutes away on King Road. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Nobleton",
    h1: "Facials near Nobleton",
    img: "studio-plants.jpg",
    imgAlt: "A bright, calm studio corner with green plants and soft natural light",
    intro: [
      "Nobleton's closest facial studio is just down the road. In2Skin is in Bolton, about 10 minutes away on King Road — a private, one-on-one studio where one guest is treated at a time.",
      "Close enough to pop over on a lunch break or after work, and quiet enough to feel like a real break. No highway, no city traffic — just a short drive through King Township.",
    ],
    sections: [
      {
        h: "The drive from Nobleton",
        body: [
          "King Road west from Nobleton, then south into Bolton — about 10 minutes, door to door. Directions are shared when you book, and appointments are one at a time, so your time starts when you arrive.",
          "Because it is so close, Nobleton clients are often the regulars: a Classic Facial every 4 to 6 weeks, kept up month after month.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask. The everyday refresh.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "Reflexology — $25 · 15 minutes. Gentle pressure on the feet that leaves the whole body calm — book it on its own, or add it to a facial.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Nobleton?", "About 10 minutes — King Road west from Nobleton, then south into Bolton. Directions are shared when you book."],
      ["Can I come for just a reflexology session?", "Yes — Reflexology is $25 for 15 minutes and can be booked on its own, or added to any facial."],
      ["What should I book first?", "The Classic Facial, $65 for 55 minutes, tailored to your skin that day — with $10 off your first visit."],
      ["Do you have appointments after work?", "Yes — Private Hours run weekday evenings after 7 PM and on Sundays, for $15 more per visit."],
    ],
    areaServedExtra: "Nobleton",
  },
  {
    slug: "facials-king-city",
    town: "King City",
    title: "Facials in King City | In2Skin — Bolton, Ontario",
    desc: "Facials near King City at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 20 minutes west on King Road. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near King City",
    h1: "Facials near King City",
    img: "visit-tea.webp",
    imgAlt: "A warm cup of tea on a wooden table in soft light, after a treatment",
    intro: [
      "King City runs on the GO train — and In2Skin runs on the same clock. The studio is in Bolton, about 20 minutes west on King Road, with evening Private Hours that suit a commuter's day.",
      "Book after the train home, or on a Sunday. One guest at a time, in a quiet room, with the whole appointment built around your skin that day.",
    ],
    sections: [
      {
        h: "The drive from King City",
        body: [
          "King Road west from King City brings you to Bolton in about 20 minutes — a straight run through King Township. Directions are shared when you book.",
          "Evening appointments are the natural fit: Private Hours run weekday evenings after 7 PM, and Sundays are open all day. Mornings before the train work too — Private Hours start at 7 AM.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask, with no downtime.",
          "Anti-Aging Facial — $95 · 80 minutes. Eighty unhurried minutes of firming massage, targeted serums and rich hydration.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once — many clients drift off.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours are $15 more per visit. Gift certificates start at $10 and never expire — an easy gift for someone who commutes all week and never books anything for themselves.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from King City?", "About 20 minutes west on King Road. Directions are shared when you book."],
      ["Do you have appointments after work?", "Yes — Private Hours run weekday evenings after 7 PM, for $15 more per visit. Sunday appointments are available too."],
      ["What should I book after a long week?", "The Works, $135 with a Classic Facial — facial, red light and reflexology all at once. Many clients fall asleep."],
      ["What does a facial cost?", "The Classic Facial is $65 for 55 minutes; the Anti-Aging Facial is $95 for 80 minutes."],
    ],
    areaServedExtra: "King City",
  },
  {
    slug: "facials-orangeville",
    town: "Orangeville",
    title: "Facials in Orangeville | In2Skin — Bolton, Ontario",
    desc: "Facials near Orangeville at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 30 minutes east on Highway 9. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Orangeville",
    h1: "Facials near Orangeville",
    img: "book-steam.webp",
    imgAlt: "Warm steam rising softly over a facial treatment in a calm studio",
    intro: [
      "Orangeville has its own salons — but nothing quite like a private studio where one guest is treated at a time. In2Skin is in Bolton, about 30 minutes east on Highway 9, and worth the drive for the quiet alone.",
      "Make a morning of it: a facial, then a wander around Bolton village. The drive down Highway 9 is part of the break, not a chore.",
    ],
    sections: [
      {
        h: "The drive from Orangeville",
        body: [
          "Highway 9 east from Orangeville brings you to Bolton in about 30 minutes — a pretty drive through Dufferin County farmland. Directions are shared when you book, and appointments are one at a time, so your time is yours from arrival.",
          "Orangeville clients often book the longer treatments, since they have made the trip: eighty minutes of anti-aging care, or The Works with red light and reflexology at the same time.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask, with no downtime.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Orangeville?", "About 30 minutes east on Highway 9. Directions are shared when you book."],
      ["Is it worth the drive from Orangeville?", "For a private, one-on-one studio — one guest at a time, no waiting room, no rush — clients say yes. Many book the longer treatments and make a morning of it."],
      ["What should I book first?", "The Classic Facial, $65 for 55 minutes, tailored to your skin that day — with $10 off your first visit."],
      ["Do you have Sunday appointments?", "Yes — Sundays are Private Hours, open all day, for $15 more per visit."],
    ],
    areaServedExtra: "Orangeville",
  },
  {
    slug: "facials-georgetown",
    town: "Georgetown",
    title: "Facials in Georgetown | In2Skin — Bolton, Ontario",
    desc: "Facials near Georgetown at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 30 minutes east on Highway 7. Classic Facial $65, Anti-Aging $95. Book online or call (289) 212-4124.",
    cat: "Facials near Georgetown",
    h1: "Facials near Georgetown",
    img: "book-towels.jpg",
    imgAlt: "Freshly folded soft towels in warm light, ready for a treatment",
    intro: [
      "Georgetown is a straight run east on Highway 7 — about 30 minutes — to a studio that does things differently. In2Skin is in Bolton: one guest at a time, one esthetician's full attention, no waiting room and no rush.",
      "Halton Hills clients come for the quiet as much as the skin work. A facial here is a proper break, not another appointment squeezed into a busy day.",
    ],
    sections: [
      {
        h: "The drive from Georgetown",
        body: [
          "Highway 7 east from Georgetown brings you to Bolton in about 30 minutes. Directions are shared when you book, and the studio is by appointment, so there is never a wait when you arrive.",
          "Weekend appointments suit Georgetown clients best: Sundays are open all day as Private Hours, and Saturday appointments run through the regular day.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask, with no downtime.",
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $25: NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25 — or book an add-on on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["How far is In2Skin from Georgetown?", "About 30 minutes east on Highway 7. Directions are shared when you book."],
      ["Do you have weekend appointments?", "Yes — Saturdays run through the regular day, and Sundays are open all day as Private Hours, for $15 more per visit."],
      ["What should I book first?", "The Classic Facial, $65 for 55 minutes, tailored to your skin that day — with $10 off your first visit."],
      ["What does a facial cost?", "The Classic Facial is $65 for 55 minutes; the Anti-Aging Facial is $95 for 80 minutes. Add-ons run $25 to $55."],
    ],
    areaServedExtra: "Georgetown",
  },
];

const CONDITIONS = [
  {
    slug: "acne-prone-skin",
    title: "Facials for Acne-Prone Skin in Bolton | In2Skin",
    desc: "Facials for acne-prone skin in Bolton at In2Skin — gentle deep cleansing, calming care and clear-skin routines. Classic Facial $65, Microdermabrasion $45. Book online or call (289) 212-4124.",
    cat: "Skin Concerns · Acne-Prone Skin",
    h1: "Facials for Acne-Prone Skin",
    img: "facial-close.jpg",
    imgAlt: "Close-up of clear, dewy, glowing skin in soft candlelight after a facial",
    intro: [
      "Breakouts don't need harsh treatment — they need the right treatment. At In2Skin, facials for acne-prone skin focus on a thorough deep cleanse, gentle exfoliation and calming, hydrating care, so pores stay clear and skin stays balanced.",
      "Regular treatments help keep breakouts under control, and the Classic Facial is an affordable, gentle first step — especially for teenagers dealing with their first breakouts.",
    ],
    sections: [
      {
        h: "How a facial helps acne-prone skin",
        body: [
          "A facial clears away the dull surface build-up that traps oil and clogs pores, then calms the skin with hydration matched to your skin that day. Nothing is forced or rushed — the treatment is chosen for your skin, not a one-size-fits-all routine.",
          "With regular visits every 4 to 6 weeks, skin stays clearer and more even, and breakouts become less frequent and less angry.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, gentle exfoliation, steam and a custom mask. The best first step for breakout-prone skin.",
          "Microdermabrasion — $45 · 15 minutes. A gentle polish that sweeps away dull, rough surface cells so pores stay clear and skin looks brighter.",
          "Light Therapy — $45 · 15 minutes. Warm red light that encourages a calmer, more even complexion.",
          "Chemical Peels — $95–$475 · 25 minutes. Gentle to advanced strengths, matched to your skin at consultation — the exact price is confirmed up front.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Teenagers are welcome — the Classic Facial is the recommended affordable option for teen acne, and everything is explained as it happens. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["Will a facial help my breakouts?", "Yes — a facial for acne-prone skin focuses on deep cleansing and gentle exfoliation to keep pores clear, with calming care afterwards. Regular visits help skin stay balanced."],
      ["Is a facial okay for teenagers?", "Yes — the Classic Facial is the recommended affordable first step for teen acne. Everything is explained as it happens."],
      ["How often should I book?", "Every 4 to 6 weeks. Most clients make it a monthly routine."],
      ["What does it cost?", "The Classic Facial is $65 for 55 minutes. Microdermabrasion is $45 and Light Therapy is $45 — either can be added to a facial or booked on its own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "rosacea-sensitive-skin",
    title: "Facials for Rosacea & Sensitive Skin in Bolton | In2Skin",
    desc: "Facials for rosacea and sensitive skin in Bolton at In2Skin — calm, soothing, one-on-one care with products chosen for your skin that day. Classic Facial $65, Light Therapy $45. Book online or call (289) 212-4124.",
    cat: "Skin Concerns · Rosacea & Sensitive Skin",
    h1: "Facials for Rosacea & Sensitive Skin",
    img: "cond-cream.webp",
    imgAlt: "A jar of gentle professional skincare cream beside soft white towels",
    intro: [
      "Skin that flushes easily needs a gentle hand. At In2Skin, treatments for rosacea and sensitive skin are calm and soothing: gentle products, soft touch, and care chosen for your skin on the day — never a set routine forced onto reactive skin.",
      "One-on-one means the esthetician watches how your skin responds at every step, and adjusts. That is the whole point of a private studio.",
    ],
    sections: [
      {
        h: "How we care for sensitive skin",
        body: [
          "Everything is chosen for your skin that day: gentle cleansing, no harsh scrubs, soft steam, and calming products. Red light therapy is a favourite for redness-prone skin — warm, restful light that encourages a calmer, more even-looking complexion.",
          "Treatments are unhurried, so skin is never pushed. If your skin needs a lighter touch on the day, that is what it gets.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask — products chosen for sensitive skin, with no downtime.",
          "Light Therapy — $45 · 15 minutes. Warm red light that supports a calmer, more even complexion. Deeply restful, and pairs well with a facial.",
          "Anti-Aging Facial — $95 · 80 minutes. Gentle, unhurried care with products chosen for your skin that day, for comfort throughout.",
          "Reflexology — $25 · 15 minutes. Calm for the whole body while your skin rests — add it to a facial, or book it on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Tell the studio about your skin when you book — the treatment is shaped around it. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit.",
        ],
      },
    ],
    leadPrice: "$65",
    leadMins: "Classic Facial · 55 minutes",
    panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
    faq: [
      ["Is a facial safe for rosacea-prone skin?", "Yes — treatments are chosen for your skin that day, with gentle products and a soft touch. Tell the studio about your skin when you book."],
      ["What helps redness most?", "Calm, soothing care: gentle products, soft touch, and red light therapy, which encourages a more even-looking complexion."],
      ["How does a facial feel on sensitive skin?", "Warm, gentle and deeply relaxing. The esthetician watches how your skin responds at every step and adjusts."],
      ["What does it cost?", "The Classic Facial is $65 for 55 minutes. Light Therapy is $45 for 15 minutes and can be added to a facial or booked on its own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "dull-skin",
    title: "Facials for Dull Skin in Bolton | In2Skin",
    desc: "Facials for dull skin in Bolton at In2Skin — gentle polish, deep hydration and an instant radiant glow. Microdermabrasion $45, Classic Facial $65. Book online or call (289) 212-4124.",
    cat: "Skin Concerns · Dull Skin",
    h1: "Facials for Dull Skin",
    img: "rev-glow.webp",
    imgAlt: "A woman with fresh, bright, glowing skin in warm natural light",
    intro: [
      "Dull skin is usually tired skin: surface build-up blocking the light, and moisture that can't get in. A facial clears the way — gentle exfoliation lifts the dull layer off, and deep hydration follows, so skin leaves bright, soft and glowing.",
      "The change is visible the same day. Skin looks fresher, makeup sits better, and the glow lasts for days.",
    ],
    sections: [
      {
        h: "How a facial brings back the glow",
        body: [
          "A facial for dull skin combines a gentle deep cleanse, soft exfoliation, warm steam and rich hydration, finished with a custom mask matched to your skin that day. Clearing dull surface build-up lets moisture absorb properly, so skin leaves soft, supple and comfortably hydrated.",
          "Microdermabrasion is the quick version: a precision polish that sweeps away the rough outer layer in 15 minutes, for an instant radiant glow.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Microdermabrasion — $45 · 15 minutes. A precision polishing wand sweeps away dull, dead surface cells. Skin feels smoother right away and looks brighter — a favourite before weddings, events and photos.",
          "Classic Facial — $65 · 55 minutes. Deep cleanse, exfoliation, steam, massage and a custom mask, with no downtime.",
          "NANO Needling — $55 · 15 minutes. Ultra-fine tips help professional serums absorb more deeply, so skin looks plumper, smoother and more radiant.",
          "Light Therapy — $45 · 15 minutes. Warm red light that supports the skin's natural renewal, for a firmer-looking, more even glow.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. For a special occasion, book microdermabrasion a day or two before — the glow is instant, with no downtime. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit.",
        ],
      },
    ],
    leadPrice: "$45",
    leadMins: "Microdermabrasion · 15 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$65 · 55 min</strong>",
    faq: [
      ["What makes skin look dull?", "Usually surface build-up: dead cells and dryness sitting on top, blocking light and stopping moisture from absorbing."],
      ["What gives the fastest glow?", "Microdermabrasion, $45 for 15 minutes — skin looks brighter and feels smoother right away, with no downtime."],
      ["How long does the glow last?", "Days — and with a facial every 4 to 6 weeks, skin stays brighter month after month."],
      ["What does a full facial cost?", "The Classic Facial is $65 for 55 minutes. Microdermabrasion and Light Therapy are $45 each and can be added to a facial or booked on their own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "fine-lines",
    title: "Facials for Fine Lines in Bolton | In2Skin",
    desc: "Facials for fine lines in Bolton at In2Skin — firming massage, targeted serums and collagen care. Anti-Aging Facial $95, NANO Needling $55. Book online or call (289) 212-4124.",
    cat: "Skin Concerns · Fine Lines",
    h1: "Facials for Fine Lines",
    img: "rejuvenation.webp",
    imgAlt: "Smooth, firm, youthful-looking skin glowing in soft light",
    intro: [
      "Fine lines soften when skin is firm, hydrated and making fresh collagen. At In2Skin, treatments for fine lines combine firming massage, targeted anti-aging serums and rich hydration — and for deeper work, collagen induction that prompts the skin's own repair.",
      "Results build with regular visits. Skin looks firmer and smoother right away, and keeps improving over a series of treatments.",
    ],
    sections: [
      {
        h: "How treatments help fine lines",
        body: [
          "An anti-aging facial works on the surface and underneath: deep cleansing and exfoliation, firming and lifting massage, targeted serums, and rich hydration. Lines appear softer, skin looks firmer, and the glow is brighter and more even.",
          "Microneedling goes deeper — fine needles create controlled micro-channels that prompt the skin's natural repair and new collagen, improving the look of fine lines, uneven texture and enlarged pores over a series of treatments.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Anti-Aging Facial — $95 · 80 minutes. Firming massage, targeted anti-aging serums and rich hydration, for firm, youthful skin.",
          "NANO Needling — $55 · 15 minutes. Ultra-fine tips help serums absorb more deeply — fine lines appear softer, skin looks plumper and smoother.",
          "Microneedling — custom, priced per consultation. Collagen induction therapy for fine lines, acne scarring, uneven texture and enlarged pores.",
          "Skin Tightening — custom, priced per consultation. Firming care for skin that has lost elasticity, so it looks tighter and more lifted over time.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. Microneedling and skin tightening are priced at consultation — the exact price is confirmed up front, before anything begins. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit.",
        ],
      },
    ],
    leadPrice: "$95",
    leadMins: "Anti-Aging Facial · 80 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$65 · 55 min</strong>",
    faq: [
      ["What is the best facial for fine lines?", "The Anti-Aging Facial, $95 for 80 minutes — firming massage, targeted serums and rich hydration, for firmer, smoother, brighter skin."],
      ["What is microneedling?", "Collagen induction therapy: fine needles create controlled micro-channels, prompting the skin's natural repair and new collagen. Pricing is confirmed at consultation."],
      ["How often should I book?", "Every 4 to 6 weeks. Results build with regular visits."],
      ["Can I add anything to a facial for fine lines?", "Yes — NANO Needling, $55, helps serums absorb more deeply, and Light Therapy, $45, supports the skin's natural renewal."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "tired-skin",
    title: "Facials for Tired Skin in Bolton | In2Skin",
    desc: "Facials for tired skin in Bolton at In2Skin — the full reset: facial, red light and reflexology all at once. The Works $135, Classic Facial $65. Book online or call (289) 212-4124.",
    cat: "Skin Concerns · Tired Skin",
    h1: "Facials for Tired Skin",
    img: "works-massage.webp",
    imgAlt: "A relaxing shoulder and neck massage during a facial treatment in a calm studio",
    intro: [
      "Tired skin is usually a tired person. Late nights, long weeks, not enough rest — it all shows on your face. The fix is rest, done properly: a facial, warm red light and foot reflexology, all at the same time, while the mask works.",
      "That combination is The Works — and it is so relaxing that people sometimes just fall asleep. You wake up with fresh, bright skin and a clearer head.",
    ],
    sections: [
      {
        h: "The full reset",
        body: [
          "The Works pairs a Classic or Anti-Aging Facial with red light therapy and reflexology, all at once. While the mask works on your skin, warm red light rests over your face and gentle pressure on your feet helps the whole body unwind.",
          "It is the closest thing to a nap that still counts as skincare: 55 minutes with a Classic Facial, 80 minutes with an Anti-Aging Facial.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "The Works — $135 with a Classic Facial, $165 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Classic Facial — $65 · 55 minutes. Deep cleanse, steam, massage and a custom mask. The everyday refresh, with no downtime.",
          "Reflexology — $25 · 15 minutes. Gentle pressure on the feet that leaves the whole body calm and rebalanced — many clients sleep beautifully that night.",
          "Light Therapy — $45 · 15 minutes. Warm red light that supports the skin's natural renewal, for a firmer-looking, more even glow.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "First visit? Take $10 toward any service. The Works is the gift people give to someone who never stops: book it for a friend and the confirmation goes straight to them. Private Hours — weekday mornings 7 to 9, evenings after 7, and Sundays — are $15 more per visit.",
        ],
      },
    ],
    leadPrice: "$135",
    leadMins: "The Works · 55 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$65 · 55 min</strong>",
    faq: [
      ["What is The Works?", "A facial, red light therapy and reflexology, all at the same time while the mask works. $135 with a Classic Facial, $165 with an Anti-Aging Facial."],
      ["Will I fall asleep?", "Many clients do — it is that relaxing. And you wake up glowing."],
      ["What if I just want the reflexology?", "Reflexology is $25 for 15 minutes and can be booked on its own."],
      ["What does a basic facial cost?", "The Classic Facial is $65 for 55 minutes, with $10 off your first visit."],
    ],
    areaServedExtra: "Bolton",
  },
];

const QUESTIONS = {
  slug: "questions",
  title: "Questions About Facials in Bolton — Prices from $65 | In2Skin",
  desc: "Questions about facials in Bolton, answered plainly: Classic Facial $65 (55 min), Anti-Aging Facial $95 (80 min), first visit $10 off. In2Skin — call (289) 212-4124.",
  cat: "Questions · Facials in Bolton",
  h1: "Questions About Facials",
  img: "facial-serene.jpg",
  imgAlt: "A client resting peacefully with eyes closed during a facial, in soft warm light",
  intro: [
    "Everything people actually ask before booking a facial in Bolton — answered plainly, with prices. If your question isn't here, call (289) 212-4124 or ask the assistant on this website.",
  ],
  sections: [
    {
      h: "Prices at a glance",
      ticks: [
        "Classic Facial — $65 · 55 minutes",
        "Anti-Aging Facial — $95 · 80 minutes",
        "The Works — $135 with a Classic Facial (55 min), $165 with an Anti-Aging Facial (80 min)",
        "Add-ons — NANO Needling $55, Microdermabrasion $45, Light Therapy $45, Reflexology $25 (each 15 minutes)",
        "Chemical Peels — $95–$475, 25 minutes, exact price confirmed at consultation",
        "Microneedling and Skin Tightening — custom, priced per consultation",
        "First visit — $10 toward any service · Private Hours — $15 more per visit",
      ],
    },
  ],
  leadPrice: "$65",
  leadMins: "Classic Facial · 55 minutes",
  panelExtra: "Private Hours: <strong style=\"color:var(--sage-deep);\">$80</strong>",
  faq: [
    ["How much does a facial cost in Bolton?", "At In2Skin, the Classic Facial is $65 for 55 minutes and the Anti-Aging Facial is $95 for 80 minutes. Add-ons run $25 to $55, chemical peels run $95 to $475, and microneedling and skin tightening are priced per consultation. First visits get $10 off any service."],
    ["What does a facial do?", "A facial deep-cleanses, exfoliates, steams, massages and hydrates your skin, finished with a mask matched to your skin that day. Skin leaves brighter, fresher and more hydrated — with a glow that lasts for days."],
    ["How long does a facial take?", "The Classic Facial takes 55 minutes and the Anti-Aging Facial takes 80 minutes. Add-ons take 15 minutes each and can be added to a facial or booked on their own."],
    ["How often should I get a facial?", "Every 4 to 6 weeks. Most clients make it a monthly ritual."],
    ["What is a first visit like?", "A consultation first, then the treatment — with every step explained as it happens. It is tailored to your skin that day, and your first visit is $10 off any service."],
    ["What are Private Hours?", "Premier appointments reserved just for you — weekday mornings 7 to 9, evenings after 7 PM, and Sundays — for $15 more per visit."],
    ["Can I buy a gift certificate?", "Yes — gift a Classic Facial ($65), an Anti-Aging Facial ($95), The Works ($135), or any custom amount from $10. A certificate code is emailed to the recipient, ready to redeem when they book, and gift codes never expire. You can also buy a treatment voucher: a named facial, paid ahead."],
    ["How do I book?", "Book online anytime on this website, or call (289) 212-4124. You pay in full securely by card when you book online and receive an email confirmation. Cash or Interac e-transfer are also welcome at the studio. Advance booking is recommended to get the time you want."],
    ["Where is the studio?", "In2Skin is a private, one-on-one aesthetics studio in Bolton, Ontario. Appointments are by booking, and directions are shared when you book. Clients visit from Caledon, Kleinburg, Vaughan, Brampton, Nobleton, King City, Orangeville, Georgetown and across Toronto and the GTA."],
    ["Can I book an appointment for a friend?", "Yes — in the online booking wizard, choose 'For a Friend' and add your friend's name, phone and email. The confirmation goes straight to them, and they just show up."],
    ["What payment methods do you take?", "Card online at booking (Visa, Mastercard, American Express, Apple Pay), or cash or Interac e-transfer at the studio. Card charges show as IN2SKIN on the statement. Plain Interac-only debit cards cannot be charged by card — those clients pay by e-transfer."],
    ["What if I need to change my booking?", "Call (289) 212-4124 and the studio will move it for you."],
    ["What are the benefits of a facial?", "A facial deep-cleanses, exfoliates and hydrates your skin, boosts circulation and leaves skin brighter, softer and glowing. Regular facials keep pores clear, help breakouts settle and slow the look of ageing — and the hour itself is deeply relaxing."],
    ["What should I expect during a facial?", "A consultation first, then a deep cleanse, steam, gentle exfoliation, a relaxing face, neck and shoulder massage, a custom mask matched to your skin, and serum and moisturizer to finish. Every step is explained as it happens, and you can ask for anything to be gentler or skipped."],
    ["Why are your facials less expensive than other Bolton spas?", "In2Skin is a small private studio — one room, one guest at a time — so a Classic Facial is $65 for 55 minutes. For comparison, a medi-spa in Bolton lists its 60-minute facials at $120."],
    ["Is red light therapy safe?", "Yes — red light therapy is non-invasive and painless, with no recovery time. You lie back under warm red light for 15 restful minutes. It supports collagen and a calmer, more even complexion."],
    ["What is reflexology?", "Reflexology is gentle, rhythmic pressure on points on your feet that map to the rest of your body — the arch to your back, the toes to your head and neck. It helps the whole body unwind, and many clients sleep beautifully that night. It is $25 for 15 minutes, on its own or added to a facial."],
    ["How much downtime is there after a chemical peel?", "It depends on the strength of the peel. Gentle peels have little to no downtime — skin looks fresh right away. Deeper peels can mean a few days of flaking or peeling as fresh skin emerges. Your consultation matches the peel to your skin and confirms exactly what to expect, before anything begins."],
    ["What is the best facial in Bolton?", "There is no single best facial — the best first facial at In2Skin is the Classic Facial, $65 for 55 minutes, tailored to your skin that day. If fine lines are your main concern, the Anti-Aging Facial, $95 for 80 minutes, adds firming massage and targeted serums."],
    ["Where can I get microneedling near Bolton?", "At In2Skin, a private, one-on-one aesthetics studio in Bolton, Ontario — call (289) 212-4124 to book. Microneedling is collagen induction therapy that prompts the skin’s natural repair and new collagen, improving the look of fine lines, acne scarring, uneven texture and enlarged pores over a series of treatments, and pricing is custom, confirmed at consultation before anything begins."],
    ["What is the difference between a facial and a chemical peel?", "A facial deep-cleanses, exfoliates, steams, massages and hydrates your skin, finished with a custom mask — the Classic Facial is $65 for 55 minutes. A chemical peel is a professional Circadia peel solution that lifts away dull surface layers so fresher, brighter skin emerges; peels are $95–$475 for 25 minutes, matched to your skin at consultation, with the exact price confirmed up front."],
    ["Do I need to book a facial in advance in Bolton?", "Yes — advance booking is recommended at In2Skin to get the time you want. You can book online anytime on the website or call (289) 212-4124, and you pay in full securely by card when you book online."],
    ["How much does The Works facial cost in Bolton?", "The Works is $135 with a Classic Facial (55 minutes) or $165 with an Anti-Aging Facial (80 minutes) at In2Skin in Bolton. It is a facial, red light therapy and reflexology all at the same time, while the mask works."],
    ["Can I book a facial early in the morning or on a Sunday in Bolton?", "Yes — In2Skin offers Private Hours on weekday mornings from 7 to 9, weekday evenings after 7 PM, and on Sundays, for $15 more per visit. Call (289) 212-4124 or book online to reserve one."],
    ["Is there a facial for teenagers with acne in Bolton?", "Yes — the Classic Facial, $65 for 55 minutes, is the recommended affordable first step for teen acne at In2Skin in Bolton. It focuses on a thorough deep cleanse, gentle exfoliation and calming, hydrating care, with every step explained as it happens."],
    ["How much does microneedling cost in Bolton?", "Microneedling at In2Skin is priced per consultation — there is no fixed price. Your consultation confirms your quote up front, before anything begins."],
  ],
  areaServedExtra: "Bolton",
};

const pages = [];
for (const l of LOCATIONS) {
  const others = LOCATIONS.filter((x) => x.slug !== l.slug).map((x) => [`/${x.slug}/`, `Facials in ${x.town}`]);
  pages.push({
    ...l,
    crumbs: `<a href="/">Home</a> · <a href="/">Facials near Bolton</a> · Facials in ${l.town}`,
    crossTitle: "Also serving nearby",
    cross: others,
  });
}
for (const c of CONDITIONS) {
  const others = CONDITIONS.filter((x) => x.slug !== c.slug).map((x) => [`/${x.slug}/`, x.h1.replace("Facials for ", "")]);
  pages.push({
    ...c,
    crumbs: `<a href="/">Home</a> · <a href="/">Skin Concerns</a> · ${c.h1}`,
    crossTitle: "Other skin concerns",
    cross: others,
  });
}
pages.push({
  ...QUESTIONS,
  crumbs: `<a href="/">Home</a> · Questions`,
  crossTitle: "Facials near Bolton",
  cross: LOCATIONS.map((x) => [`/${x.slug}/`, `Facials in ${x.town}`]),
});

for (const p of pages) {
  const dir = join(ROOT, p.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(p));
  console.log("wrote", `${p.slug}/index.html`);
}
console.log("wrote", pages.length, "SEO pages");
