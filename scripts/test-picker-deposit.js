// Picker deposit + price-audit tests (Tony Nov 20, 2026).
// Static + data checks for the main booking flow rebuild: the A2 price
// table in every carrier (picker data, server table, chat answers),
// guided add-on lighting from compat.js, glow + explainer on every
// picker step, and ?service= preselection.
// Run: node scripts/test-picker-deposit.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Load a browser script (window.X = ...) into a sandbox and return X.
function loadBrowser(p, key) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read(p), sandbox);
  return sandbox.window[key];
}

const IN2 = loadBrowser("js/data.js", "IN2");
const COMPAT = loadBrowser("js/compat.js", "IN2_COMPAT");
const { SERVICES, COMBOS } = require("../lib/schedule");
const index = read("index.html");
const mainJs = read("js/main.js");
const chatJs = read("js/chat.js");
const compatJs = read("js/compat.js");
const consultJs = read("js/consult.js");

let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }

// --- (1) Price audit: every A2 price, in the picker data, the server
// table, and the chat answers. ---
const EXPECT = {
  "classic-facial": [85, 55], "anti-aging-facial": [125, 80],
  "nano-needling": [65, 20], "microdermabrasion": [55, 20],
  "light-therapy": [55, 20], "reflexology": [35, 20],
  "chemical-peels": [125, 55], "consultation": [30, 20],
};
const flat = {};
for (const g of IN2.groups) for (const it of g.items) flat[it.id] = it;
for (const [id, [price, mins]] of Object.entries(EXPECT)) {
  // The picker id for NANO Needling is "needling"; the server id is
  // "nano-needling" — same treatment, $65 / 20 min. Consultation is not
  // a picker group item; it lives in consultDollars (checked below).
  if (id === "consultation") continue;
  const it = flat[id === "nano-needling" ? "needling" : id];
  ok(it, `data.js has ${id}`);
  ok(it.price === price, `data.js ${id} price $${price}, got $${it.price}`);
  ok(it.mins === mins, `data.js ${id} is ${mins} min, got ${it.mins}`);
}
const works = flat["the-works"];
ok(works.variants.find((v) => v.id === "combo-classic" && v.price === 160 && v.mins === 55), "data.js The Works + Classic is $160/55");
ok(works.variants.find((v) => v.id === "combo-anti" && v.price === 195 && v.mins === 80), "data.js The Works + Anti-Aging is $195/80");
ok(works.priceMax === 195, "data.js The Works tops at $195");
ok(flat["chemical-peels"].priceMax === 475, "data.js peels top at $475");
ok(IN2.depositDollars === 30, "data.js deposit is $30");
ok(IN2.consultDollars === 30, "data.js consultation is $30");
// One needling item (Tony Nov 20, 2026): microneedling and NANO needling
// are the same treatment — the picker shows one combined name, and the
// treatments list carries it too. Asset filenames excepted.
ok(flat["needling"].name === "Microneedling / NANO Needling", "data.js needling is named Microneedling / NANO Needling");
ok(IN2.treatments.some(([name]) => name === "Microneedling / NANO Needling"), "data.js treatments list has Microneedling / NANO Needling");
ok(!Object.values(flat).some((it) => it.name === "Microneedling" || it.name === "NANO Needling"), "data.js has no standalone Microneedling or NANO Needling service name");
// Server table agrees: both needling ids share the one combined display
// name (microneedling stays as an id for old booking records — never
// offered in the picker).
for (const [id, [price, mins]] of Object.entries(EXPECT)) {
  const s = SERVICES.find((x) => x.id === id);
  ok(s, `schedule.js SERVICES has ${id}`);
  ok(s.priceNum === price, `schedule.js ${id} price $${price}, got $${s.priceNum}`);
  ok(s.mins === mins, `schedule.js ${id} is ${mins} min, got ${s.mins}`);
}
const serverMicro = SERVICES.find((x) => x.id === "microneedling");
ok(serverMicro && serverMicro.priceNum === 65 && serverMicro.mins === 20, "schedule.js keeps microneedling $65/20 for old records only");
ok(serverMicro && serverMicro.name === "Microneedling / NANO Needling", "schedule.js microneedling shares the combined name");
const serverNano = SERVICES.find((x) => x.id === "nano-needling");
ok(serverNano && serverNano.name === "Microneedling / NANO Needling", "schedule.js nano-needling is named Microneedling / NANO Needling");
const comboClassic = COMBOS.find((x) => x.id === "combo-classic");
ok(comboClassic.priceNum === 160 && comboClassic.mins === 55, "schedule.js combo-classic $160/55");
const comboAnti = COMBOS.find((x) => x.id === "combo-anti");
ok(comboAnti.priceNum === 195 && comboAnti.mins === 80, "schedule.js combo-anti $195/80");
// Chat answers carry the same prices.
for (const s of [
  "Classic Facial</b> $85 · 55 min",
  "Anti-Aging Facial</b> $125 · 80 min",
  "The Works</b> $160 with a Classic (55 min) or $195 with an Anti-Aging (80 min)",
  "Chemical Peels</b> $125–$475 · 55 min",
  "Microneedling / NANO Needling $65, Microdermabrasion $55, Light Therapy $55, Reflexology $35",
]) {
  ok(chatJs.includes(s), `chat.js prices include: ${s}`);
}
// Chat + compat use the combined name only. (The explanatory sentence
// "Microneedling and NANO needling are the same treatment" is prose, not
// a second service name — strip it too before the sweep.)
for (const [src, js] of [["chat.js", chatJs], ["compat.js", compatJs]]) {
  ok(js.includes("Microneedling / NANO Needling"), `${src} uses the combined needling name`);
  const rest = js.split("Microneedling / NANO Needling").join("").replace(/microneedling and nano needling/gi, "");
  ok(!/microneedling/i.test(rest), `${src} has no standalone Microneedling service name`);
  ok(!/NANO Needling/.test(rest), `${src} has no standalone NANO Needling service name`);
}
ok(!/from \$150/i.test(chatJs), "chat.js never quotes $150 as our price");

// --- (2) Guided add-on lighting: compat.js rules decide lit vs unlit. ---
function rule(a, b) {
  const r = COMPAT.rules.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return r ? r.s : "ok";
}
ok(rule("chemical-peels", "needling") === "no", "peels + needling is incompatible (unlit)");
ok(rule("chemical-peels", "microdermabrasion") === "no", "peels + microdermabrasion is incompatible (unlit)");
ok(rule("chemical-peels", "light-therapy") === "check", "peels + light is check-at-visit");
ok(rule("needling", "microdermabrasion") === "check", "needling + microdermabrasion is check-at-visit");
ok(rule("classic-facial", "light-therapy") === "ok", "classic + light is compatible (lit gold)");
ok(rule("classic-facial", "reflexology") === "ok", "classic + reflexology is compatible (lit gold)");
ok(rule("the-works", "needling") === "ok", "works + needling is compatible (lit gold)");
// Every offered add-on has a why line and learn-more text, and the
// picker renders them (lit button + why + learn details; unlit reason).
for (const [main, offered] of Object.entries(COMPAT.offer)) {
  for (const id of offered) {
    ok(COMPAT.why[id] && (COMPAT.why[id]["*"] || COMPAT.why[id][main]), `${main} offers ${id} with a why line`);
    ok(COMPAT.learn[id], `${id} has learn-more text`);
  }
}
ok(COMPAT.learnLinks.needling === "/nano-needling/", "needling learn link goes to /nano-needling/");
ok(COMPAT.included["the-works"].items.includes("light-therapy") && COMPAT.included["the-works"].items.includes("reflexology"), "The Works includes light + reflexology");
ok(mainJs.includes("ao-pick") && mainJs.includes("ao-off") && mainJs.includes('data-toggle'), "picker renders lit toggles and unlit reasons");
ok(mainJs.includes("ao-check"), "picker shows the check-at-visit note on flagged pairs");

// --- (3) Glow + explainer on every picker step. ---
const HINT_KEYS = ["who", "treatment", "variant", "addon", "summary", "date", "time", "details", "option", "reserve", "friend"];
for (const k of HINT_KEYS) {
  ok(mainJs.includes(`${k}: "`), `main.js has a ${k} explainer line`);
}
const hintFor = { addon: "addons", friend: "who" };
for (const k of HINT_KEYS) {
  const span = hintFor[k] || k;
  ok(index.includes(`id="hint-${span}"`), `index.html has #hint-${span} for the ${k} step`);
}
ok(mainJs.includes("glow-pick"), "picker marks the current step with glow-pick");
ok(index.includes('class="cal-help"'), "calendar step has its own explainer line");

// --- (4) ?service= preselection: deep links land on the picker with the
// service already chosen. ---
ok(mainJs.includes('get("service")'), "picker reads ?service=");
ok(mainJs.includes('"microneedling": "needling"'), "microneedling deep link maps to the combined needling add-on");
ok(mainJs.includes('"nano-needling": "needling"'), "nano-needling deep link maps to the picker add-on");
ok(mainJs.includes("combo-classic") && mainJs.includes("combo-anti"), "picker preselects Works variants from a deep link");
for (const dir of ["classic-facial", "anti-aging-facial", "the-works", "chemical-peels", "nano-needling", "microdermabrasion", "light-therapy", "reflexology"]) {
  ok(read(`${dir}/index.html`).includes(`/?service=${dir}#services`), `${dir} Book buttons pass ?service=${dir}`);
}
// The microneedling page redirects to the NANO page.
const vercel = JSON.parse(read("vercel.json"));
ok(vercel.redirects && vercel.redirects.some((r) => r.source === "/microneedling/" && r.destination === "/nano-needling/" && r.permanent), "vercel.json redirects /microneedling/ to /nano-needling/");
const sitemap = read("sitemap.xml");
ok(!sitemap.includes("/microneedling/"), "sitemap no longer lists /microneedling/");
ok(sitemap.includes("/nano-needling/"), "sitemap lists /nano-needling/");

// --- (5) One needling item in public copy: sweep every served page, the
// llms files and the docs for a standalone needling service name. Ids,
// URLs and asset filenames are not service names and are not swept.
function walkPub(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "scripts", "tests"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPub(p, out);
    else if (/\.(html|txt|md|json)$/.test(e.name)) out.push(p);
  }
}
const pubFiles = []; walkPub(ROOT, pubFiles);
ok(pubFiles.length > 30, `sweep covers ${pubFiles.length} public files`);
for (const f of pubFiles) {
  const t = fs.readFileSync(f, "utf8");
  const rest = t.split("Microneedling / NANO Needling").join("").replace(/microneedling and nano needling/gi, "");
  const rel = path.relative(ROOT, f);
  ok(!/NANO Needling/.test(rest), `${rel}: no standalone NANO Needling`);
  ok(!/"Microneedling"/.test(rest) && !/>Microneedling</.test(rest), `${rel}: no standalone Microneedling service name`);
}

// --- (6) Continue-bar totals (Tony Nov 20 17:55): the sticky bars show the
// running calculation — picks + accumulated minutes + total price.
ok(mainJs.includes("Continue — pick a day ↓' + (T.items.length ? ' · ' + hm(T.mins) + ' · ' + pr(T, T.total)"), "Continue button shows minutes + total");
ok(mainJs.includes('parts.push(hm(T.mins) + " · " + pr(T, T.total))'), "Reserve bar shows minutes + total");

// --- (7) Calendar greying: a day with no times left is greyed out, even
// when the range free count still says the day has slots (the count is for
// the whole day — it still counts starts that have already passed).
ok(mainJs.includes("NOW.min >= SL.RULES.lastStart"), "home picker greys out today once the last start is gone");
ok(consultJs.includes("NOW.min >= SL.RULES.lastStart"), "consult picker greys out today once the last start is gone");

console.log(`picker-deposit tests: all ${n} checks passed`);
