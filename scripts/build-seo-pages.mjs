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
  ["classic-facial", "Classic Facial", "$85"],
  ["anti-aging-facial", "Anti-Aging Facial", "$125"],
  ["nano-needling", "NANO Needling", "$65"],
  ["microdermabrasion", "Microdermabrasion", "$55"],
  ["light-therapy", "Light Therapy", "$55"],
  ["reflexology", "Reflexology", "$35"],
  ["chemical-peels", "Chemical Peels", "$125–$475"],
  ["microneedling", "Microneedling", "$65"],
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
            <p style="margin-top:10px;"><a href="https://www.facebook.com/profile.php?id=61596402642954" target="_blank" rel="noopener">Follow us on Facebook</a></p>
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
              <li>New to In2Skin? A $30 consultation is credited in full toward your first treatment</li>
              <li><a href="/questions/">Questions about facials? See our answers</a></li>
              <li><a href="/privacy.html">Privacy — how we handle your information</a></li>
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
      priceRange: "$35 - $475",
      address: {
        "@type": "PostalAddress",
        streetAddress: "92 Willow Street",
        addressLocality: "Bolton",
        addressRegion: "ON",
        postalCode: "L7E 3G3",
        addressCountry: "CA",
      },
      geo: { "@type": "GeoCoordinates", latitude: GEO.lat, longitude: GEO.lon },
      areaServed: ["Bolton", "Caledon", "Kleinburg", "Vaughan", "Brampton", "Nobleton", "King City", "Orangeville", "Georgetown", "Toronto", "Mississauga"],
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
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
    desc: "Facials in Caledon at In2Skin — a private, one-on-one aesthetics studio right here in Bolton, in the Town of Caledon. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask. The everyday refresh, and the best first facial.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once while the mask works.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35 — add one to any facial, or book one on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit, for times that fit around work and school. Gift certificates start at $10 and never expire, and you can book an appointment for a friend and have the confirmation go straight to them.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["Is the studio actually in Caledon?", "Yes — In2Skin is in Bolton, which is in the Town of Caledon. The studio is a private treatment room, by appointment."],
      ["How long is the drive from Caledon East or Caledon Village?", "About 10 to 20 minutes on local roads from most of Caledon. Directions are shared when you book."],
      ["What should I book for my first facial?", "The Classic Facial, $85 for 55 minutes. It is tailored to your skin that day, with every step explained."],
      ["Do you have evening appointments?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
    ],
    areaServedExtra: "Caledon",
  },
  {
    slug: "facials-kleinburg",
    town: "Kleinburg",
    title: "Facials in Kleinburg | In2Skin — Bolton, Ontario",
    desc: "Facials near Kleinburg at In2Skin — a private, one-on-one aesthetics studio in Bolton, straight up Highway 50, about 15 minutes away. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Kleinburg?", "About 15 minutes — straight up Highway 50 from Kleinburg village to Bolton. Directions are shared when you book."],
      ["What should I book first?", "The Classic Facial, $85 for 55 minutes, is the best first visit — tailored to your skin that day."],
      ["Is there a longer treatment for a real break?", "Yes — the Anti-Aging Facial is 80 minutes for $125, and The Works adds red light and reflexology at the same time, $160 with a Classic Facial."],
      ["Can I book for a friend in Kleinburg?", "Yes — choose 'For a Friend' when you book and the confirmation goes straight to them."],
    ],
    areaServedExtra: "Kleinburg",
  },
  {
    slug: "facials-vaughan",
    town: "Vaughan",
    title: "Facials in Vaughan | In2Skin — Bolton, Ontario",
    desc: "Facials near Vaughan at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 20 minutes north of Woodbridge on Highway 50. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Early morning and evening appointments — Private Hours — suit Vaughan clients who work all week: the regular price plus $15 per visit.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask. The everyday refresh.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35 — or book an add-on on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Gift certificates start at $10 and never expire, and a treatment voucher — a named facial, paid ahead — makes an easy gift for someone in Vaughan who would never book for themselves.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Vaughan?", "About 20 minutes north of Woodbridge on Highway 50. From Maple and Thornhill, a similar trip via Rutherford Road and Highway 50."],
      ["Why drive to Bolton for a facial?", "For a private, one-on-one studio — one guest at a time, no waiting room, no rush — instead of a busy city spa."],
      ["Do you have appointments after work?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
      ["What does a facial cost?", "The Classic Facial is $85 for 55 minutes; the Anti-Aging Facial is $125 for 80 minutes. Add-ons run $35 to $65."],
    ],
    areaServedExtra: "Vaughan",
  },
  {
    slug: "facials-brampton",
    town: "Brampton",
    title: "Facials in Brampton | In2Skin — Bolton, Ontario",
    desc: "Facials near Brampton at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 25 minutes north on Highway 50. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "Microdermabrasion — $55 · 20 minutes. A precision polish for brighter, smoother skin — a favourite before events and photos.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Brampton?", "About 25 minutes north on Highway 50, by way of Mayfield Road. Directions are shared when you book."],
      ["What is good before a wedding or event?", "Microdermabrasion, $55, gives an instant radiant glow, and a Classic Facial the week before leaves skin fresh and bright."],
      ["What does a facial cost?", "The Classic Facial is $85 for 55 minutes; the Anti-Aging Facial is $125 for 80 minutes. Add-ons run $35 to $65."],
      ["Can I book an evening appointment?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
    ],
    areaServedExtra: "Brampton",
  },
  {
    slug: "facials-nobleton",
    town: "Nobleton",
    title: "Facials in Nobleton | In2Skin — Bolton, Ontario",
    desc: "Facials near Nobleton at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 10 minutes away on King Road. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask. The everyday refresh.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "Reflexology — $35 · 20 minutes. Gentle pressure on the feet that leaves the whole body calm — book it on its own, or add it to a facial.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Nobleton?", "About 10 minutes — King Road west from Nobleton, then south into Bolton. Directions are shared when you book."],
      ["Can I come for just a reflexology session?", "Yes — Reflexology is $35 for 20 minutes and can be booked on its own, or added to any facial."],
      ["What should I book first?", "The Classic Facial, $85 for 55 minutes, tailored to your skin that day."],
      ["Do you have appointments after work?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
    ],
    areaServedExtra: "Nobleton",
  },
  {
    slug: "facials-king-city",
    town: "King City",
    title: "Facials in King City | In2Skin — Bolton, Ontario",
    desc: "Facials near King City at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 20 minutes west on King Road. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
    cat: "Facials near King City",
    h1: "Facials near King City",
    img: "visit-tea.webp",
    imgAlt: "A warm cup of tea on a wooden table in soft light, after a treatment",
    intro: [
      "King City runs on the GO train — and In2Skin runs on the same clock. The studio is in Bolton, about 20 minutes west on King Road, with Private Hours by request that suit a commuter's day.",
      "Book after the train home. One guest at a time, in a quiet room, with the whole appointment built around your skin that day.",
    ],
    sections: [
      {
        h: "The drive from King City",
        body: [
          "King Road west from King City brings you to Bolton in about 20 minutes — a straight run through King Township. Directions are shared when you book.",
          "Evening appointments are the natural fit: Private Hours are available early mornings and evenings, by request. Mornings before the train work too.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Eighty unhurried minutes of firming massage, targeted serums and rich hydration.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once — many clients drift off.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours cost the regular price plus $15 per visit. Gift certificates start at $10 and never expire — an easy gift for someone who commutes all week and never books anything for themselves.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from King City?", "About 20 minutes west on King Road. Directions are shared when you book."],
      ["Do you have appointments after work?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
      ["What should I book after a long week?", "The Works, $160 with a Classic Facial — facial, red light and reflexology all at once. Many clients fall asleep."],
      ["What does a facial cost?", "The Classic Facial is $85 for 55 minutes; the Anti-Aging Facial is $125 for 80 minutes."],
    ],
    areaServedExtra: "King City",
  },
  {
    slug: "facials-orangeville",
    town: "Orangeville",
    title: "Facials in Orangeville | In2Skin — Bolton, Ontario",
    desc: "Facials near Orangeville at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 30 minutes east on Highway 9. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Orangeville?", "About 30 minutes east on Highway 9. Directions are shared when you book."],
      ["Is it worth the drive from Orangeville?", "For a private, one-on-one studio — one guest at a time, no waiting room, no rush — clients say yes. Many book the longer treatments and make a morning of it."],
      ["What should I book first?", "The Classic Facial, $85 for 55 minutes, tailored to your skin that day."],
      ["Do you have Sunday appointments?", "No — Sundays the studio is closed. Private Hours are available early mornings and evenings, by request."],
    ],
    areaServedExtra: "Orangeville",
  },
  {
    slug: "facials-georgetown",
    town: "Georgetown",
    title: "Facials in Georgetown | In2Skin — Bolton, Ontario",
    desc: "Facials near Georgetown at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 30 minutes east on Highway 7. Classic Facial $85, Anti-Aging $125. Book online or call (289) 212-4124.",
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
          "Weekend appointments suit Georgetown clients best: Saturday appointments run through the regular day, and Private Hours are available early mornings and evenings, by request.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35 — or book an add-on on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit. Gift certificates start at $10 and never expire.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Georgetown?", "About 30 minutes east on Highway 7. Directions are shared when you book."],
      ["Do you have weekend appointments?", "Yes — Saturdays run through the regular day. Sundays the studio is closed, and Private Hours are available early mornings and evenings, by request."],
      ["What should I book first?", "The Classic Facial, $85 for 55 minutes, tailored to your skin that day."],
      ["What does a facial cost?", "The Classic Facial is $85 for 55 minutes; the Anti-Aging Facial is $125 for 80 minutes. Add-ons run $35 to $65."],
    ],
    areaServedExtra: "Georgetown",
  },
  {
    slug: "facials-toronto",
    town: "Toronto",
    title: "Facials for Toronto | In2Skin — Bolton, Ontario",
    desc: "Facials for Toronto clients at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 45 minutes from downtown. Classic Facial $85, Anti-Aging $125 — the same quality as a $150–$300 downtown facial, for about half the price. Book online or call (289) 212-4124.",
    cat: "Facials for Toronto",
    h1: "Facials for Toronto",
    img: "facial-massage.jpg",
    imgAlt: "A client resting with eyes closed while an esthetician massages her face during a facial",
    intro: [
      "Toronto has no shortage of spas — but downtown prices have climbed past what a facial should cost. A custom facial downtown runs $150 to $300, a HydraFacial $190 to $400, and peels $150 to $400. In2Skin is the same quality of care — professional Circadia products, one-on-one attention, decades of experience — for $85 and $125.",
      "Clients drive up from downtown, Etobicoke, North York and Scarborough for the quiet as much as the price: a private studio in Bolton where one guest is treated at a time, with no waiting room, no rush, and no one else's appointment running over into yours.",
    ],
    sections: [
      {
        h: "The drive from Toronto",
        body: [
          "Downtown Toronto to Bolton is about 45 minutes to an hour, by Highway 400 north to King Road or Highway 427 to Highway 50. From Etobicoke and North York it is quicker — often under 45 minutes. Directions are shared when you book, and the studio is by appointment, so there is never a wait when you arrive.",
          "Early morning and evening appointments — Private Hours — suit Toronto clients who work all week: the regular price plus $15 per visit.",
        ],
      },
      {
        h: "An escape from the city",
        body: [
          "Clients travel in from across Toronto & the GTA — downtown, Etobicoke, North York, Scarborough and Mississauga — for a slower pace, and a studio that feels a world away from the city.",
          "No waiting room, no rush, and no one else's appointment running over into yours. Just a quiet room, one guest at a time — worth the drive.",
        ],
      },
      {
        h: "The price gap, honestly",
        body: [
          "A quality facial downtown costs $150 to $300 — and that is before the add-ons. At In2Skin the Classic Facial is $85 for 55 minutes and the Anti-Aging Facial is $125 for 80 minutes. The difference is not the care: it is a small private studio in Bolton instead of a downtown medspa paying downtown rent.",
          "That is the whole point — premium quality at about half the Toronto price. Not a cheap facial. The same professional products, the same unhurried hour, the same glow — for less.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35 — or book an add-on on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Gift certificates start at $10 and never expire, and a treatment voucher — a named facial, paid ahead — makes an easy gift for someone in Toronto who would never book for themselves.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from downtown Toronto?", "About 45 minutes to an hour by Highway 400 or Highway 427. From Etobicoke and North York it is often under 45 minutes. Directions are shared when you book."],
      ["Why drive to Bolton for a facial?", "For the same quality at about half the downtown price — a Classic Facial is $85 and an Anti-Aging Facial is $125, where a custom facial downtown runs $150 to $300 — in a private, one-on-one studio with no waiting room and no rush."],
      ["What does a facial cost in Toronto?", "Downtown, a custom facial runs $150 to $300, a HydraFacial $190 to $400, and peels $150 to $400. At In2Skin the same kind of care is $85 for a Classic Facial and $125 for an Anti-Aging Facial."],
      ["Do you have appointments after work?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
    ],
    areaServedExtra: "Toronto",
  },
  {
    slug: "facials-mississauga",
    town: "Mississauga",
    title: "Facials in Mississauga | In2Skin — Bolton, Ontario",
    desc: "Facials near Mississauga at In2Skin — a private, one-on-one aesthetics studio in Bolton, about 35 to 45 minutes away. Classic Facial $85, Anti-Aging $125 — about half what a facial costs in Mississauga. Book online or call (289) 212-4124.",
    cat: "Facials near Mississauga",
    h1: "Facials near Mississauga",
    img: "quiet-candles.webp",
    imgAlt: "A calm, candlelit treatment room with a facial bed, warm light and soft towels",
    intro: [
      "Mississauga has plenty of spas — most of them busy, and most of them charging about $130 for a facial, with medspas running $105 to $350. In2Skin is a private studio in Bolton, about 35 to 45 minutes away, where one guest is treated at a time and a Classic Facial is $85.",
      "Clients come up from Port Credit, Streetsville, Erin Mills, Cooksville and Meadowvale for the quiet as much as the price: a proper facial, a real break, and no one rushing you out the door.",
    ],
    sections: [
      {
        h: "The drive from Mississauga",
        body: [
          "Highway 407 or Highway 401 to Highway 50 brings you to Bolton in about 35 to 45 minutes from most of Mississauga. Directions are shared when you book, and the studio is by appointment, so there is never a wait when you arrive.",
          "Early morning and evening appointments — Private Hours — suit Mississauga clients who work all week: the regular price plus $15 per visit.",
        ],
      },
      {
        h: "The price gap, honestly",
        body: [
          "A facial in Mississauga averages about $130, and a signature facial at a medspa can run $160 to $350. At In2Skin the Classic Facial is $85 for 55 minutes and the Anti-Aging Facial is $125 for 80 minutes. The difference is not the care: it is a small private studio in Bolton instead of a city spa paying city rent.",
          "Premium quality at about half the price — not a cheap facial. The same professional products, the same unhurried hour, the same glow — for less.",
        ],
      },
      {
        h: "Treatments that fit",
        ticks: [
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask, with no downtime.",
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted serums and rich hydration, for firm, youthful skin.",
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Add-ons from $35: NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Gift certificates start at $10 and never expire, and a treatment voucher — a named facial, paid ahead — makes an easy gift for someone in Mississauga who would never book for themselves.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["How far is In2Skin from Mississauga?", "About 35 to 45 minutes by Highway 407 or Highway 401 to Highway 50. Directions are shared when you book."],
      ["What does a facial cost in Mississauga?", "About $130 on average, with medspas running $105 to $350. At In2Skin the Classic Facial is $85 for 55 minutes and the Anti-Aging Facial is $125 for 80 minutes."],
      ["Why drive to Bolton for a facial?", "For the same quality at about half the price, in a private, one-on-one studio — one guest at a time, no waiting room, no rush."],
      ["Do you have appointments after work?", "Yes — Private Hours are available early mornings and evenings, by request, for the regular price plus $15 per visit. Sundays the studio is closed."],
    ],
    areaServedExtra: "Mississauga",
  },
];

const CONDITIONS = [
  {
    slug: "acne-prone-skin",
    title: "Facials for Acne-Prone Skin in Bolton | In2Skin",
    desc: "Facials for acne-prone skin in Bolton at In2Skin — gentle deep cleansing, calming care and clear-skin routines. Classic Facial $85, Microdermabrasion $55. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, gentle exfoliation, steam and a hydration mask. The best first step for breakout-prone skin.",
          "Microdermabrasion — $55 · 20 minutes. A gentle polish that sweeps away dull, rough surface cells so pores stay clear and skin looks brighter.",
          "Light Therapy — $55 · 20 minutes. Warm red light that encourages a calmer, more even complexion.",
          "Chemical Peels — $125–$475 · 55 minutes, including your consultation. Gentle to advanced strengths, matched to your skin at consultation — the exact price is confirmed up front.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Teenagers are welcome — the Classic Facial is the recommended affordable option for teen acne, and everything is explained as it happens. Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["Will a facial help my breakouts?", "Yes — a facial for acne-prone skin focuses on deep cleansing and gentle exfoliation to keep pores clear, with calming care afterwards. Regular visits help skin stay balanced."],
      ["Is a facial okay for teenagers?", "Yes — the Classic Facial is the recommended affordable first step for teen acne. Everything is explained as it happens."],
      ["How often should I book?", "Every 4 to 6 weeks. Most clients make it a monthly routine."],
      ["What does it cost?", "The Classic Facial is $85 for 55 minutes. Microdermabrasion is $55 and Light Therapy is $55 — either can be added to a facial or booked on its own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "rosacea-sensitive-skin",
    title: "Facials for Rosacea & Sensitive Skin in Bolton | In2Skin",
    desc: "Facials for rosacea and sensitive skin in Bolton at In2Skin — calm, soothing, one-on-one care with products chosen for your skin that day. Classic Facial $85, Light Therapy $55. Book online or call (289) 212-4124.",
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
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask — products chosen for sensitive skin, with no downtime.",
          "Light Therapy — $55 · 20 minutes. Warm red light that supports a calmer, more even complexion. Deeply restful, and pairs well with a facial.",
          "Anti-Aging Facial — $125 · 80 minutes. Gentle, unhurried care with products chosen for your skin that day, for comfort throughout.",
          "Reflexology — $35 · 20 minutes. Calm for the whole body while your skin rests — add it to a facial, or book it on its own.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Tell the studio about your skin when you book — the treatment is shaped around it. Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit.",
        ],
      },
    ],
    leadPrice: "$85",
    leadMins: "Classic Facial · 55 minutes",
    faq: [
      ["Is a facial safe for rosacea-prone skin?", "Yes — treatments are chosen for your skin that day, with gentle products and a soft touch. Tell the studio about your skin when you book."],
      ["What helps redness most?", "Calm, soothing care: gentle products, soft touch, and red light therapy, which encourages a more even-looking complexion."],
      ["How does a facial feel on sensitive skin?", "Warm, gentle and deeply relaxing. The esthetician watches how your skin responds at every step and adjusts."],
      ["What does it cost?", "The Classic Facial is $85 for 55 minutes. Light Therapy is $55 for 20 minutes and can be added to a facial or booked on its own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "dull-skin",
    title: "Facials for Dull Skin in Bolton | In2Skin",
    desc: "Facials for dull skin in Bolton at In2Skin — gentle polish, deep hydration and an instant radiant glow. Microdermabrasion $55, Classic Facial $85. Book online or call (289) 212-4124.",
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
          "A facial for dull skin combines a gentle deep cleanse, soft exfoliation, warm steam and rich hydration, finished with a hydration mask matched to your skin that day. Clearing dull surface build-up lets moisture absorb properly, so skin leaves soft, supple and comfortably hydrated.",
          "Microdermabrasion is the quick version: a precision polish that sweeps away the rough outer layer in 20 minutes, for an instant radiant glow.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Microdermabrasion — $55 · 20 minutes. A precision polishing wand sweeps away dull, dead surface cells. Skin feels smoother right away and looks brighter — a favourite before weddings, events and photos.",
          "Classic Facial — $85 · 55 minutes. Deep cleanse, exfoliation, steam, massage and a hydration mask, with no downtime.",
          "NANO Needling — $65 · 20 minutes. Ultra-fine tips help professional serums absorb more deeply, so skin looks plumper, smoother and more radiant.",
          "Light Therapy — $55 · 20 minutes. Warm red light that supports the skin's natural renewal, for a firmer-looking, more even glow.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "For a special occasion, book microdermabrasion a day or two before — the glow is instant, with no downtime. Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit.",
        ],
      },
    ],
    leadPrice: "$55",
    leadMins: "Microdermabrasion · 20 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$85 · 55 min</strong>",
    faq: [
      ["What makes skin look dull?", "Usually surface build-up: dead cells and dryness sitting on top, blocking light and stopping moisture from absorbing."],
      ["What gives the fastest glow?", "Microdermabrasion, $55 for 20 minutes — skin looks brighter and feels smoother right away, with no downtime."],
      ["How long does the glow last?", "Days — and with a facial every 4 to 6 weeks, skin stays brighter month after month."],
      ["What does a full facial cost?", "The Classic Facial is $85 for 55 minutes. Microdermabrasion and Light Therapy are $55 each and can be added to a facial or booked on their own."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "fine-lines",
    title: "Facials for Fine Lines in Bolton | In2Skin",
    desc: "Facials for fine lines in Bolton at In2Skin — firming massage, targeted serums and collagen care. Anti-Aging Facial $125, NANO Needling $65. Book online or call (289) 212-4124.",
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
          "Needling goes deeper — Sarah picks micro or nano needles for your face; fine needles create controlled micro-channels that prompt the skin's natural repair and new collagen, improving the look of fine lines, uneven texture and enlarged pores over a series of treatments.",
        ],
      },
      {
        h: "Treatments that help",
        ticks: [
          "Anti-Aging Facial — $125 · 80 minutes. Firming massage, targeted anti-aging serums and rich hydration, for firm, youthful skin.",
          "Needling (micro or nano) — $65 · 20 minutes. Sarah picks the needle size for your face — ultra-fine tips help serums absorb more deeply, and fine needles prompt new collagen, improving the look of fine lines, acne scarring, uneven texture and enlarged pores.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "Microneedling is $65 for 20 minutes. Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit.",
        ],
      },
    ],
    leadPrice: "$125",
    leadMins: "Anti-Aging Facial · 80 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$85 · 55 min</strong>",
    faq: [
      ["What is the best facial for fine lines?", "The Anti-Aging Facial, $125 for 80 minutes — firming massage, targeted serums and rich hydration, for firmer, smoother, brighter skin."],
      ["What is microneedling?", "Collagen induction therapy: fine needles create controlled micro-channels, prompting the skin's natural repair and new collagen. It's $65 for 20 minutes, and Sarah picks the needle size (micro or nano) that's best for your face at the visit."],
      ["How often should I book?", "Every 4 to 6 weeks. Results build with regular visits."],
      ["Can I add anything to a facial for fine lines?", "Yes — NANO Needling, $65, helps serums absorb more deeply, and Light Therapy, $55, supports the skin's natural renewal."],
    ],
    areaServedExtra: "Bolton",
  },
  {
    slug: "tired-skin",
    title: "Facials for Tired Skin in Bolton | In2Skin",
    desc: "Facials for tired skin in Bolton at In2Skin — the full reset: facial, red light and reflexology all at once. The Works $160, Classic Facial $85. Book online or call (289) 212-4124.",
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
          "The Works — $160 with a Classic Facial, $195 with an Anti-Aging Facial. Facial, red light therapy and reflexology, all at once.",
          "Classic Facial — $85 · 55 minutes. Deep cleanse, steam, massage and a hydration mask. The everyday refresh, with no downtime.",
          "Reflexology — $35 · 20 minutes. Gentle pressure on the feet that leaves the whole body calm and rebalanced — many clients sleep beautifully that night.",
          "Light Therapy — $55 · 20 minutes. Warm red light that supports the skin's natural renewal, for a firmer-looking, more even glow.",
        ],
      },
      {
        h: "Good to know",
        body: [
          "The Works is the gift people give to someone who never stops: book it for a friend and the confirmation goes straight to them. Private Hours, early mornings and evenings by request, are the regular price plus $15 per visit.",
        ],
      },
    ],
    leadPrice: "$160",
    leadMins: "The Works · 55 minutes",
    panelExtra: "Classic Facial: <strong style=\"color:var(--sage-deep);\">$85 · 55 min</strong>",
    faq: [
      ["What is The Works?", "A facial, red light therapy and reflexology, all at the same time while the mask works. $160 with a Classic Facial, $195 with an Anti-Aging Facial."],
      ["Will I fall asleep?", "Many clients do — it is that relaxing. And you wake up glowing."],
      ["What if I just want the reflexology?", "Reflexology is $35 for 20 minutes and can be booked on its own."],
      ["What does a basic facial cost?", "The Classic Facial is $85 for 55 minutes."],
    ],
    areaServedExtra: "Bolton",
  },
];

const QUESTIONS = {
  slug: "questions",
  title: "Questions About Facials in Bolton — Prices from $85 | In2Skin",
  desc: "Questions about facials in Bolton, answered plainly: Classic Facial $85 (55 min), Anti-Aging Facial $125 (80 min), $30 consultation credited toward your first treatment. In2Skin — call (289) 212-4124.",
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
        "Classic Facial — $85 · 55 minutes",
        "Anti-Aging Facial — $125 · 80 minutes",
        "The Works — $160 with a Classic Facial (55 min), $195 with an Anti-Aging Facial (80 min)",
        "Add-ons — NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35 (all four add-ons 20 minutes)",
        "Chemical Peels — $125–$475, 55 minutes, exact price confirmed at consultation",
        "Microneedling — $65 for 20 minutes",
        "New to In2Skin? A $30 consultation is credited in full toward your first treatment · Private Hours — the regular price plus $15 per visit",
      ],
    },
  ],
  leadPrice: "$85",
  leadMins: "Classic Facial · 55 minutes",
  faq: [
    ["How much does a facial cost in Bolton?", "At In2Skin, the Classic Facial is $85 for 55 minutes and the Anti-Aging Facial is $125 for 80 minutes. Add-ons run $35 to $65, chemical peels run $125 to $475, and microneedling is $65."],
    ["What does a facial do?", "A facial deep-cleanses, exfoliates, steams, massages and hydrates your skin, finished with a mask matched to your skin that day. Skin leaves brighter, fresher and more hydrated — with a glow that lasts for days."],
    ["How long does a facial take?", "The Classic Facial takes 55 minutes and the Anti-Aging Facial takes 80 minutes. Add-ons take 20 minutes each, and can be added to a facial or booked on their own."],
    ["How often should I get a facial?", "Every 4 to 6 weeks. Most clients make it a monthly ritual."],
    ["What is a first visit like?", "A consultation first, then the treatment — with every step explained as it happens. It is tailored to your skin that day."],
    ["What are Private Hours?", "Premier appointments reserved just for you — early mornings and evenings, by request. You pay the regular price of the services you pick, plus $15 per visit. Sundays the studio is closed."],
    ["Can I buy a gift certificate?", "Yes — gift a Classic Facial ($85), an Anti-Aging Facial ($125), The Works ($160), or any custom amount from $10. A certificate code is emailed to the recipient, ready to redeem when they book, and gift codes never expire. You can also buy a treatment voucher: a named facial, paid ahead."],
    ["How do I book?", "Book online anytime on this website, or call (289) 212-4124. You pay in full securely by card when you book online and receive an email confirmation. Cash or Interac e-transfer are also welcome at the studio. Advance booking is recommended to get the time you want."],
    ["Where is the studio?", "In2Skin is a private, one-on-one aesthetics studio in Bolton, Ontario. Appointments are by booking, and directions are shared when you book. Clients visit from Caledon, Kleinburg, Vaughan, Brampton, Nobleton, King City, Orangeville, Georgetown, Mississauga and across Toronto and the GTA."],
    ["Can I book an appointment for a friend?", "Yes — in the online booking wizard, choose 'For a Friend' and add your friend's name, phone and email. The confirmation goes straight to them, and they just show up."],
    ["What payment methods do you take?", "Card online at booking (Visa, Mastercard, American Express, Apple Pay), or cash or Interac e-transfer at the studio. Card charges show as IN2SKIN on the statement. Plain Interac-only debit cards cannot be charged by card — those clients pay by e-transfer."],
    ["What if I need to change my booking?", "Call (289) 212-4124 and the studio will move it for you."],
    ["What are the benefits of a facial?", "A facial deep-cleanses, exfoliates and hydrates your skin, boosts circulation and leaves skin brighter, softer and glowing. Regular facials keep pores clear, help breakouts settle and slow the look of ageing — and the hour itself is deeply relaxing."],
    ["What should I expect during a facial?", "A consultation first, then a deep cleanse, steam, extractions if needed, gentle exfoliation, a relaxing face, neck and décolletage massage, a hydration mask matched to your skin, and serum and moisturizer to finish. Every step is explained as it happens, and you can ask for anything to be gentler or skipped."],
    ["Why are your facials less expensive than other Bolton spas?", "In2Skin is a small private studio — one room, one guest at a time — so a Classic Facial is $85 for 55 minutes. For comparison, a medi-spa in Bolton lists its 60-minute facials at $120."],
    ["Is red light therapy safe?", "Yes — red light therapy is non-invasive and painless, with no recovery time. You lie back under warm red light for 20 restful minutes. It supports collagen and a calmer, more even complexion."],
    ["What is reflexology?", "Reflexology is gentle, rhythmic pressure on points on your feet that map to the rest of your body — the arch to your back, the toes to your head and neck. It helps the whole body unwind, and many clients sleep beautifully that night. It is $35 for 20 minutes, on its own or added to a facial."],
    ["How much downtime is there after a chemical peel?", "It depends on the strength of the peel. Gentle peels have little to no downtime — skin looks fresh right away. Deeper peels can mean a few days of flaking or peeling as fresh skin emerges. Your consultation matches the peel to your skin and confirms exactly what to expect, before anything begins."],
    ["What is the best facial in Bolton?", "There is no single best facial — the best first facial at In2Skin is the Classic Facial, $85 for 55 minutes, tailored to your skin that day. If fine lines are your main concern, the Anti-Aging Facial, $125 for 80 minutes, adds firming massage and targeted serums."],
    ["Where can I get microneedling near Bolton?", "At In2Skin, a private, one-on-one aesthetics studio in Bolton, Ontario — call (289) 212-4124 to book. Microneedling is collagen induction therapy that prompts the skin’s natural repair and new collagen, improving the look of fine lines, acne scarring, uneven texture and enlarged pores over a series of treatments. It's $65 for 20 minutes, and Sarah picks the needle size (micro or nano) that's best for your face at the visit."],
    ["What is the difference between a facial and a chemical peel?", "A facial deep-cleanses, exfoliates, steams, massages and hydrates your skin, finished with a hydration mask — the Classic Facial is $85 for 55 minutes. A chemical peel is a professional Circadia peel solution that lifts away dull surface layers so fresher, brighter skin emerges; peels are $125–$475 for 55 minutes, including the consultation that matches the peel to your skin, with the exact price confirmed up front."],
    ["Do I need to book a facial in advance in Bolton?", "Yes — advance booking is recommended at In2Skin to get the time you want. You can book online anytime on the website or call (289) 212-4124, and you pay in full securely by card when you book online."],
    ["How much does The Works facial cost in Bolton?", "The Works is $160 with a Classic Facial (55 minutes) or $195 with an Anti-Aging Facial (80 minutes) at In2Skin in Bolton. It is a facial, red light therapy and reflexology all at the same time, while the mask works."],
    ["Can I book a facial early in the morning or on a Sunday in Bolton?", "Early mornings and evenings are available as Private Hours, by request — call (289) 212-4124 or email bookings@boltonfacials.com and Sarah will set it up. You pay the regular price of the services you pick, plus $15 per visit. Sundays the studio is closed."],
    ["Is there a facial for teenagers with acne in Bolton?", "Yes — the Classic Facial, $85 for 55 minutes, is the recommended affordable first step for teen acne at In2Skin in Bolton. It focuses on a thorough deep cleanse, gentle exfoliation and calming, hydrating care, with every step explained as it happens."],
    ["How much does microneedling cost in Bolton?", "Microneedling at In2Skin is $65 for 20 minutes. Sarah picks the needle size (micro or nano) that's best for your face at the visit."],
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
