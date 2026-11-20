#!/usr/bin/env node
/* Generate site-data.json + llms.txt from the pricing source of truth
   (lib/schedule.js) — never copy numbers by hand. Re-run after any
   price, duration or payment-model change:
   node scripts/build-site-data.mjs
   Prices, minutes, categories, combos and the deposit sentence come
   from lib/schedule.js. NAV / FOOTER mirror the header/footer in
   index.html (same links, same order); TOWNS is the 10-town list the
   footer and the location pages use. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SERVICES, COMBOS, GIFT_OPTIONS, DEPOSIT_CENTS, DEPOSIT_SENTENCE, QUIET_PREMIUM_CENTS } = require("../lib/schedule.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://boltonfacials.com";
const PHONE_DISPLAY = "(289) 212-4124";
const PHONE_TEL = "+12892124124";

// Header nav in index.html, same links in the same order.
const NAV = {
  services: "/services/",
  howToChoose: "/how-to-choose/",
  concerns: [
    { label: "Dry skin", href: "/dry-skin/" },
    { label: "Acne", href: "/acne-prone-skin/" },
    { label: "Teen acne", href: "/teen-acne/" },
    { label: "Rosacea and sensitive", href: "/rosacea-sensitive-skin/" },
    { label: "Dull", href: "/dull-skin/" },
    { label: "Fine lines", href: "/fine-lines/" },
    { label: "Tired", href: "/tired-skin/" },
  ],
  occasions: [
    { label: "Before your wedding", href: "/before-your-wedding/" },
    { label: "Business and workday prep", href: "/business-workday-prep/" },
    { label: "Before a vacation", href: "/before-your-vacation/" },
    { label: "After-hours", href: "/after-hours-appointments/" },
  ],
  gift: "/gift/",
  contact: "/contact/",
  book: "/book/",
  call: `tel:${PHONE_TEL}`,
};

// Footer link groups in index.html, same links in the same order.
const FOOTER = {
  treatments: [
    { label: "Classic Facial", href: "/classic-facial/" },
    { label: "Anti-Aging Facial", href: "/anti-aging-facial/" },
    { label: "The Works", href: "/the-works/" },
    { label: "Chemical Peels", href: "/chemical-peels/" },
    { label: "Microneedling", href: "/microneedling/" },
    { label: "NANO Needling", href: "/nano-needling/" },
    { label: "Microdermabrasion", href: "/microdermabrasion/" },
    { label: "Light Therapy", href: "/light-therapy/" },
    { label: "Reflexology", href: "/reflexology/" },
  ],
  helpMeChoose: [
    { label: "How to choose", href: "/how-to-choose/" },
    { label: "Consultation", href: "/consultation/" },
  ],
  concerns: NAV.concerns,
  occasions: NAV.occasions,
  visit: [
    { label: "Contact and hours", href: "/contact/" },
    { label: "Questions about facial treatments? See our answers", href: "/questions/" },
    { label: "Gift certificates", href: "/gift/" },
    { label: "Privacy — how we handle your information", href: "/privacy.html" },
  ],
  towns: [
    { label: "Caledon", href: "/facials-caledon/" },
    { label: "Kleinburg", href: "/facials-kleinburg/" },
    { label: "Vaughan", href: "/facials-vaughan/" },
    { label: "Brampton", href: "/facials-brampton/" },
    { label: "Nobleton", href: "/facials-nobleton/" },
    { label: "King City", href: "/facials-king-city/" },
    { label: "Orangeville", href: "/facials-orangeville/" },
    { label: "Georgetown", href: "/facials-georgetown/" },
    { label: "Toronto", href: "/facials-toronto/" },
    { label: "Mississauga", href: "/facials-mississauga/" },
  ],
};

const TOWNS = FOOTER.towns.map((t) => t.label);

const consult = SERVICES.find((s) => s.id === "consultation");
const money = (cents) => "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");

const siteData = {
  site: SITE,
  name: "In2Skin",
  phone: PHONE_DISPLAY,
  email: "bookings@boltonfacials.com",
  services: SERVICES.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.cat,
    minutes: s.mins,
    price: s.priceLabel,
    priceCents: s.priceNum * 100,
  })),
  combos: COMBOS.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.cat,
    minutes: c.mins,
    price: c.priceLabel,
    priceCents: c.priceNum * 100,
  })),
  durations: Object.fromEntries([...SERVICES, ...COMBOS].map((s) => [s.id, s.mins])),
  prices: Object.fromEntries([...SERVICES, ...COMBOS].map((s) => [s.id, s.priceLabel])),
  deposit: {
    cents: DEPOSIT_CENTS,
    label: money(DEPOSIT_CENTS),
    sentence: DEPOSIT_SENTENCE,
  },
  consult: consult
    ? { id: consult.id, name: consult.name, minutes: consult.mins, price: consult.priceLabel, priceCents: consult.priceNum * 100 }
    : null,
  payment: DEPOSIT_SENTENCE,
  privateHoursPremiumCents: QUIET_PREMIUM_CENTS,
  nav: NAV,
  footer: FOOTER,
  towns: TOWNS,
};

writeFileSync(join(ROOT, "site-data.json"), JSON.stringify(siteData, null, 2) + "\n");
console.log("wrote site-data.json");

const serviceLines = SERVICES.filter((s) => s.id !== "consultation")
  .map((s) => `- ${s.name}: ${s.priceLabel} for ${s.mins} minutes`)
  .join("\n");
const comboLines = COMBOS.map((c) => `- ${c.name}: ${c.priceLabel} for ${c.mins} minutes`).join("\n");
const giftLines = Object.values(GIFT_OPTIONS)
  .map((g) => `- ${g.name}: ${money(g.amountCents)}`)
  .join("\n");
const townLinks = FOOTER.towns.map((t) => `- ${t.label}: ${SITE}${t.href}`).join("\n");

const llms = `# In2Skin — Aesthetics Studio in Bolton, Ontario

> In2Skin is a private, one-on-one aesthetics studio in Bolton, Ontario, Canada.
> Every treatment is custom — made for the client's skin that day. One client at a
> time: no waiting room, no rush. Professional skincare line: Circadia.
> Website: ${SITE}/
> Full detail for AI assistants: ${SITE}/llms-full.txt — every
> service, price, booking rule, gift, voucher and referral rule in plain text.

## Location

- Bolton, Ontario, Canada (private studio, by appointment; directions shared when you book)
- Service area: Bolton, Caledon, Kleinburg, Vaughan, Brampton, Nobleton, King City,
  Orangeville, Georgetown, and Toronto & the GTA (Toronto, Mississauga, Etobicoke,
  North York). Clients travel from Toronto for the private, quiet, one-on-one experience.

## Booking

- Book online anytime on the website, or call ${PHONE_DISPLAY}
- ${DEPOSIT_SENTENCE}
- Book without a deposit and your slot is held for 30 minutes, then it opens back up.
- Advance booking is recommended to get the time you want
- First visit: a $30 consultation (20 minutes, video or in person), credited in full toward your first treatment. That is the one first-visit offer.
- Gift certificates: gift a Classic Facial ($85), an Anti-Aging Facial ($125),
  The Works ($160), or any custom amount. Paid securely by card online; a certificate
  code is emailed to the recipient, ready to redeem when they book. Gift codes never expire
- Book for a friend: the booking wizard has a "For a Friend" option — enter the
  friend's name, phone and email; the confirmation goes straight to them and they
  just show up
- Regular hours: Monday to Saturday, appointments starting 10:00 AM–4:00 PM. Sundays the studio is closed.
- Early mornings and evenings can be arranged by contacting the studio; the regular price plus $15 per visit.

## Services (prices in Canadian dollars, CAD)

${serviceLines}

## The Works (facial treatment + red light therapy + reflexology, all at once)

${comboLines}

## Consultation

- Consultation: $30 for 20 minutes, video (Google Meet) or in person, paid up front by card, credited in full toward your first treatment. First-time clients only.

## Gift certificates

${giftLines}

- Gift codes never expire. Any leftover value stays on the code for a future visit.

## Facial treatments near Bolton

${townLinks}

## Payment

- ${DEPOSIT_SENTENCE}
- Plain Interac-only debit cards cannot be charged by card — those clients pay by e-transfer.
- The charge shows as IN2SKIN on card statements.
`;

writeFileSync(join(ROOT, "llms.txt"), llms);
console.log("wrote llms.txt from site-data.json");
console.log("services:", siteData.services.map((s) => `${s.id} ${s.price}/${s.minutes}min`).join(", "));
