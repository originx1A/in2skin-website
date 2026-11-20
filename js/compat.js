/* In2Skin booking picker: add-on guidance + compatibility rules.
   DRAFT, pending the studio's confirmation. Edit THIS file only; the picker reads it.
   Evidence and sources: /workspace/company/in2skin/compatibility-matrix-2026-11-20.md
   Status per pair:  "ok" = offer normally · "no" = not on the same day (greyed out with the reason)
                     "check" = offer, with a note that it is confirmed at the visit           */
window.IN2_COMPAT = {
  status: "DRAFT, pending the studio's confirmation",

  /* Already part of the main treatment: never offered as an add-on. */
  included: {
    "the-works": { items: ["light-therapy", "reflexology"], note: "Red light and reflexology are already part of The Works." }
  },

  /* Which add-ons to walk through, in this order, for each main treatment. */
  offer: {
    "classic-facial":    ["light-therapy", "reflexology", "needling", "microdermabrasion"],
    "anti-aging-facial": ["light-therapy", "reflexology", "needling", "microdermabrasion"],
    "the-works":         ["needling", "microdermabrasion"],
    "chemical-peels":    ["reflexology", "light-therapy", "needling", "microdermabrasion"]
  },

  /* Pair rules. Order of a/b does not matter. Anything not listed is "ok". */
  rules: [
    { a: "chemical-peels", b: "needling",          s: "no",    why: "Not on the same day as a chemical peel" },
    { a: "chemical-peels", b: "microdermabrasion", s: "no",    why: "Not on the same day as a chemical peel" },
    { a: "chemical-peels", b: "light-therapy",     s: "check", why: "Your esthetician confirms light after a peel on the day, depending on the peel's strength" },
    { a: "needling",       b: "microdermabrasion", s: "check", why: "Your esthetician confirms needling and microdermabrasion together at your visit" }
  ],

  /* One-line "why" for each add-on, per main treatment ("*" = any). */
  why: {
    "light-therapy": {
      "*": "Calms skin and supports collagen.",
      "anti-aging-facial": "Builds on your facial’s firming work.",
      "chemical-peels": "Soothes skin after a gentle peel."
    },
    "reflexology": {
      "*": "Whole-body calm while your mask works.",
      "chemical-peels": "Head-to-toe calm, face untouched."
    },
    "needling": {
      "*": "Serums sink deeper. Plumper, smoother skin.",
      "anti-aging-facial": "A collagen boost for your anti-aging serums."
    },
    "microdermabrasion": {
      "*": "A gentle polish so products work better."
    }
  },

  /* Optional "Learn more" text (falls back to the description in data.js). */
  learn: {
    "light-therapy": "You lie back under warm red light for 20 minutes. It's non-invasive and painless, with no recovery time.",
    "reflexology": "Points on your feet map to your back, neck and shoulders. Gentle pressure helps your whole body unwind.",
    "needling": "Collagen induction and serum infusion. Your esthetician picks the needle size (micro or nano) that's best for your face at the visit.",
    "microdermabrasion": "A polishing wand sweeps away dull surface skin in 20 minutes: refined texture and a fresh glow, with no downtime."
  },

  learnLinks: { "light-therapy": "/light-therapy/", "reflexology": "/reflexology/", "needling": "/microneedling/", "microdermabrasion": "/microdermabrasion/" }
};
