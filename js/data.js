/* In2Skin prototype — single source of truth (prices copied from the live site's
   price source: index.html SERVICES / ADDONS / COMBOS at commit 7e386ce).
   Nothing here is invented. Consultation $30 and deposit $30 are Tony's rulings. */
window.IN2 = {
  phone: { tel: "+12892124124", display: "(289) 212-4124" },
  depositDollars: 30,
  consultDollars: 30,
  groups: [
    { id: "facials", title: "Facials", exclusive: true, items: [
      { id: "classic-facial", clip: "assets/clips/classic-facial.mp4", poster: "assets/clips/classic-facial.webp", name: "Classic Facial", mins: 55, price: 85, img: "assets/classic-facial.webp",
        desc: "Cleanse, steam, extractions, mask and a facial massage." },
      { id: "anti-aging-facial", clip: "assets/clips/anti-aging.mp4", poster: "assets/clips/anti-aging.webp", name: "Anti-Aging Facial", mins: 80, price: 125, img: "assets/anti-aging.webp",
        desc: "The Classic, plus a second mask, arm massage and Circadia serums." }
    ]},
    { id: "advanced", title: "Advanced & combo", exclusive: true, items: [
      { id: "chemical-peels", clip: "assets/clips/chemical-peel.mp4", poster: "assets/clips/chemical-peel.webp", name: "Chemical Peels", mins: 55, price: 125, priceMax: 475, img: "assets/chemical-peels.webp",
        desc: "A Circadia peel matched to you. Brighter, smoother skin." },
      { id: "the-works", name: "The Works", mins: "55–80", price: 160, priceMax: 195, img: "assets/works-massage.webp", needsVariant: true,
        desc: "Facial, red light and reflexology in one visit.",
        variants: [
          { id: "combo-classic", label: "With a Classic Facial", mins: 55, price: 160 },
          { id: "combo-anti", label: "With an Anti-Aging Facial", mins: 80, price: 195 }
        ]}
    ]},
    { id: "addons", title: "Add to your visit", exclusive: false, items: [
      { id: "needling", clip: "assets/clips/microneedling.mp4", poster: "assets/clips/microneedling.webp", name: "NANO Needling", mins: 20, price: 65, img: "assets/microneedling.webp",
        desc: "Ultra-fine nano tips help serums absorb more deeply." },
      { id: "microdermabrasion", clip: "assets/clips/microdermabrasion.mp4", poster: "assets/clips/microdermabrasion.webp", name: "Microdermabrasion", mins: 20, price: 55, img: "assets/microdermabrasion.webp",
        desc: "A gentle polish. Smoother, brighter skin." },
      { id: "light-therapy", clip: "assets/clips/red-light.mp4", poster: "assets/clips/red-light.webp", name: "Light Therapy", mins: 20, price: 55, img: "assets/red-light.webp", pairs: true,
        desc: "Warm red light that supports collagen and evens tone." },
      { id: "reflexology", clip: "assets/clips/reflexology.mp4", poster: "assets/clips/reflexology.webp", name: "Reflexology", mins: 20, price: 35, img: "assets/reflexology.webp", pairs: true,
        desc: "Gentle foot pressure for whole-body relaxation." }
    ]}
  ],
  concerns: [
    ["Acne-prone skin", "/acne-prone-skin/"], ["Rosacea and sensitive skin", "/rosacea-sensitive-skin/"], ["Dull skin", "/dull-skin/"],
    ["Fine lines", "/fine-lines/"], ["Tired skin", "/tired-skin/"]
  ],
  treatments: [
    ["Classic Facial", "/classic-facial/"], ["Anti-Aging Facial", "/anti-aging-facial/"], ["The Works", "/the-works/"], ["Chemical Peels", "/chemical-peels/"],
    ["NANO Needling", "/nano-needling/"], ["Microdermabrasion", "/microdermabrasion/"], ["Light Therapy", "/light-therapy/"], ["Reflexology", "/reflexology/"]
  ]
};
