#!/usr/bin/env node
/* Regenerate assets/content.json + assets/knowledge.json from the
   pricing source of truth (lib/schedule.js) — never copy numbers by
   hand. Re-run after any price, duration or payment-model change:
   node scripts/build-content-json.mjs
   Prices, minutes, categories and the deposit sentence come from
   lib/schedule.js. The descriptive copy comes from the frontend
   SERVICES in index.html (intro / includes / benefits) — update it
   there first if the wording changes. */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SERVICES, COMBOS, DEPOSIT_SENTENCE } = require("../lib/schedule.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPOSIT = DEPOSIT_SENTENCE;

/* Descriptive copy — from the frontend SERVICES in index.html. */
const COPY = {
  "classic-facial": {
    what: "A facial is a one-on-one professional skin treatment for your face, neck and décolletage. The Classic Facial is the signature treatment: cleansing, steam, extractions if needed, a hydration mask, and a facial massage including neck and décolletage — tailored to your skin that day.",
    feelsLike: "Warm, gentle and deeply relaxing. Many clients drift off and wake up glowing.",
    goodFor: "Anyone who wants brighter, fresher, more even-looking skin and deep hydration. The perfect foundation for healthy skin, month after month. Perfect for first-timers — every step is explained.",
  },
  "anti-aging-facial": {
    what: "Eighty minutes of Circadia anti-aging care. Everything in the Classic Facial, plus a second mask, targeted serums and Circadia products in the masks matched to your skin, and an arm massage while the second mask works.",
    feelsLike: "Eighty full minutes of deep relaxation.",
    goodFor: "Anyone noticing fine lines, uneven tone, or skin that looks tired. Fine lines appear softer, skin looks firmer, brighter and more youthful, and feels plump, smooth and deeply nourished.",
  },
  "needling": {
    what: "Microneedling / NANO Needling is one treatment, two needle sizes, $65 for 20 minutes. Microneedling (collagen induction) creates controlled micro-channels that prompt new collagen — improving the look of fine lines, acne scarring, texture and pores over a series. NANO needling infuses professional serum deeply for plumper, smoother, dewy skin. Sarah picks the size that's best for your face at the visit.",
    feelsLike: "A professional treatment with expert care and a soothing finish, plus simple aftercare guidance.",
    goodFor: "Fine lines looking softer over a series of treatments, acne scarring and uneven texture looking improved, pores looking more refined, and skin looking firmer — or plumper, smoother, more radiant skin from the NANO infusion.",
  },
  "microdermabrasion": {
    what: "A 20-minute add-on. A polishing wand sweeps away dull surface skin, then a soothing, hydrating finish. A beautiful base for serums and makeup alike.",
    feelsLike: "A gentle polishing massage, finished with soothing hydration.",
    goodFor: "Skin that feels noticeably smoother right away, a brighter and more even-looking complexion, and makeup that sits more beautifully. A favourite before events and photos.",
  },
  "light-therapy": {
    what: "A 20-minute add-on. You lie back under warm red light for twenty restful minutes. The red light supports collagen, calms skin and evens tone while you rest. It adds to any facial.",
    feelsLike: "Warm and peaceful. Many clients nap while the light works.",
    goodFor: "Firmer, more youthful-looking skin, a calmer and more even complexion, and better results from any facial.",
  },
  "reflexology": {
    what: "A 20-minute add-on. Gentle, skilled pressure across the reflex points of the feet. Points on your feet map to your back, neck and shoulders — the arch to the back, the toes to the head and neck — so tender points can show where the body is holding tension. The perfect finishing touch to any facial.",
    feelsLike: "Gentle, rhythmic pressure — calm spreads through your whole body in minutes.",
    goodFor: "Deep relaxation that spreads through the whole body, and a lighter, calmer, more balanced feeling.",
  },
  "chemical-peels": {
    what: "A chemical peel is a professional Circadia treatment that lifts dull surface layers so fresh, bright skin can emerge. Strengths range from gentle to advanced, and the peel is matched to your skin at a personal consultation, which is part of the 55 minutes. The exact price ($125–$475) is confirmed up front, before anything begins.",
    feelsLike: "A gentle warming sensation as it renews, with expert care throughout.",
    goodFor: "Brighter, more even-looking skin tone, smoother texture, fine lines and sun spots appearing softened, and fresh new skin revealed over the following days.",
  },
  "consultation": {
    what: "A 20-minute consultation with Sarah — video (Google Meet) or in person at the studio. $30, paid up front by card when you book, credited in full toward your first treatment. One-time only, for first-time clients.",
    feelsLike: "A friendly, honest chat about your skin — no pressure, no obligation.",
    goodFor: "Anyone new to In2Skin who wants to talk it over first, or who is far away or short on time (the video call).",
  },
};

const svc = (id) => SERVICES.find((s) => s.id === id);
const contentServices = SERVICES.map((s) => ({
  category: s.cat,
  id: s.id,
  minutes: s.mins,
  name: s.name,
  price: s.priceLabel,
  priceCents: s.priceNum * 100,
  ...(s.id === "chemical-peels"
    ? { note: "Booked at the $125 starting price; the exact price is confirmed at consultation and any balance is settled at the visit." }
    : {}),
}));

const content = {
  booking: {
    forAFriend: "Book for a friend in the booking wizard — the confirmation goes straight to them and they just show up.",
    reschedule: "Call at least 24 hours ahead to move an appointment — no charge to reschedule.",
    steps: "Pick a treatment, pick a day and time, add your details, pay a $30 deposit by card at checkout — the rest is paid at your visit.",
  },
  deposit: DEPOSIT,
  firstVisit: "First visit: a $30 consultation (20 minutes, video or in person), credited in full toward your first treatment. That is the one first-visit offer.",
  giftAnswer: "Gift certificates are easy: gift a <strong>Classic Facial ($85)</strong>, an <strong>Anti-Aging Facial ($125)</strong>, <strong>The Works ($160)</strong> — or any custom amount. Pay securely by card online, and a certificate code is emailed to your friend to redeem when they book. Gift codes never expire.",
  hours: {
    private: "Early mornings and evenings, by request — the regular price plus $15 per visit. Times are never listed; Sarah arranges them directly.",
    regular: "Monday to Saturday, 10:00 AM–4:00 PM. Sundays the studio is closed.",
  },
  location: "Bolton, Ontario, Canada",
  name: "In2Skin",
  payAnswer: "Pay a $30 deposit to lock in your time; it is credited to your treatment and you pay the balance at your visit by <strong>cash, Interac e-transfer or card</strong>. Plain Interac-only debit cards cannot be charged by card, so those clients pay by e-transfer.",
  payment: DEPOSIT + " A plain Interac-only debit card cannot go through the card link — e-transfer covers it. The charge shows as IN2SKIN on card statements. Book without a deposit and your slot is held for 30 minutes, then it opens back up.",
  phone: "(289) 212-4124",
  services: contentServices,
  site: "https://boltonfacials.com/",
};

const knowledgeServices = SERVICES.filter((s) => COPY[s.id]).map((s) => ({
  feelsLike: COPY[s.id].feelsLike,
  goodFor: COPY[s.id].goodFor,
  id: s.id,
  minutes: s.mins,
  name: s.name,
  price: s.priceLabel,
  what: COPY[s.id].what,
}));

const knowledge = {
  combos: COMBOS.map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    what: "Your facial + red light therapy + reflexology, all at once while your mask works. " +
      (c.id === "combo-classic"
        ? "With Classic ($160, 55 min): cleanse, steam, extractions if needed, hydration mask, facial massage incl. neck + décolletage."
        : "With Anti-Aging ($195, 80 min): all of that + a second mask + arm massage while the second mask is on + serums and Circadia products in the masks, matched to the skin."),
  })),
  deposit: DEPOSIT + " Book without a deposit and the slot is held for 30 minutes, then it opens back up. Sarah can waive the deposit for people she knows. Rescheduling is free with 24 hours' notice. On a no-show or late cancel the deposit is never refunded in cash and never lost — it stays as credit toward the next appointment.",
  forPeople: {
    brides: "Brides book ahead of the wedding for glowing skin in photos. Microdermabrasion is a favourite before events, and The Works is the full relaxing experience.",
    business: "A facial is a calm reset in a busy week — many business clients book daytime appointments.",
    teens: "Teen acne care is available in its own teen offering, below the adult services. Adults book first; teens are welcome with a parent.",
    vacation: "Book before a vacation so your skin looks its best on the trip.",
  },
  forSkin: {
    acne: "A facial helps acne-prone skin with a thorough deep cleanse, gentle exfoliation and a mask matched to your skin that day. For acne scarring, Microneedling / NANO Needling is the treatment that helps most.",
    dry: "A facial helps dry skin with a gentle deep cleanse, soft exfoliation, warm steam, a custom hydrating mask, and rich serum and moisturizer for deep hydration and a soft, supple feel.",
    dull: "A facial helps dull skin with exfoliation and steam to lift away dullness, plus a brightening mask and serum for a fresh, glowing finish. Microdermabrasion is a great add-on for instant brightness.",
    fineLines: "An anti-aging facial helps fine lines with firming massage, targeted serums and rich hydration. Microneedling / NANO Needling helps over a series of visits.",
    rosacea: "A facial helps rosacea-prone skin with a gentle cleanse, calming care and a mask matched to sensitive skin. The esthetician adjusts everything to your skin that day.",
    tired: "A facial helps tired skin with deep cleansing, massage, steam and a custom mask — most clients leave looking rested and glowing.",
  },
  services: knowledgeServices,
  studio: {
    address: "Private studio in Bolton. The exact address is on the booking confirmation only, never read out.",
    betweenAppointments: "60 minutes between appointments, for cleaning and prepping the room",
    bookingWindow: "Bookings open from tomorrow up to 60 days ahead.",
    consultation: "20 minutes, $30, video (Google Meet) or in person, paid up front by card, credited in full toward the first treatment. One-time only, for first-time clients. Regular hours book right away; evenings and early mornings are by request, and Sarah says yes or no. Cancel 24 hours or more ahead for a refund or a free reschedule; a missed consultation keeps the $30.",
    email: "bookings@boltonfacials.com",
    firstVisit: "A $30 consultation (20 minutes, video or in person), credited in full toward the first treatment. That is the one first-visit offer.",
    giftCertificates: "Buy any amount for someone. The code carries a balance, anything left stays on the code, and gift codes never expire.",
    name: "In2Skin",
    payment: DEPOSIT + " Plain Interac-only debit cards cannot be charged by card, so those clients pay by e-transfer. The charge shows as IN2SKIN on card statements.",
    phone: "(289) 212-4124",
    place: "Bolton, Ontario, Canada",
    privateHours: "Early mornings and evenings, by request — the regular price plus $15 per visit. Times are never listed; Sarah arranges them directly. Sundays the studio is closed.",
    products: "Circadia professional skincare",
    referrals: "When three friends book and pay in full with your code, you earn $15 treatment credit and a free reflexology add-on. The reward repeats every three referrals. No cash value — credit is for treatments only.",
    regularHours: "Monday to Saturday, 10:00 AM to 4:00 PM. Sundays the studio is closed.",
    reschedule: "Call at least 24 hours ahead to move an appointment, no charge to reschedule.",
    vouchers: "Pay ahead for a named facial plus add-ons and get a code to give as a gift. Any leftover value stays with the person who used the voucher. If the full total is used, the voucher ends when the treatment is completed. No cash value. We suggest enjoying it within 120 days, but the dollar value never expires.",
    website: "https://boltonfacials.com",
  },
};

writeFileSync(join(ROOT, "assets", "content.json"), JSON.stringify(content));
writeFileSync(join(ROOT, "assets", "knowledge.json"), JSON.stringify(knowledge));
console.log("wrote assets/content.json + assets/knowledge.json from lib/schedule.js");
console.log("services:", contentServices.map((s) => `${s.id} ${s.price}/${s.minutes}min`).join(", "));
