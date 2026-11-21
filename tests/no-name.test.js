// node tests/no-name.test.js  — the public site must never name the esthetician (Tony, Nov 20 2026)
// Walks everything the preview serves plus the backend code whose strings
// can reach a client (API errors, emails). Excluded: tests/ + scripts/
// (test code, never served), admin/ + api/admin/ (the sign-in-only admin
// panel and its API — admin-only copy, not public), docs/ (notes), shots/
// and node_modules/.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), hits = [];
const SKIP = new Set(["tests", "scripts", "admin", "docs", "shots", "node_modules"]);
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), st = fs.statSync(p);
  if (st.isDirectory()) { if (f === "api") { for (const g of fs.readdirSync(p)) { const q = path.join(p, g); if (fs.statSync(q).isDirectory()) { if (g !== "admin") walk(q); } else if (/\.js$/.test(g)) fs.readFileSync(q, "utf8").split("\n").forEach((l, i) => { if (/sarah/i.test(l)) hits.push(path.relative(root, q) + ":" + (i + 1)); }); } } else if (!SKIP.has(f)) walk(p); }
  else if (/\.(html|js|css|json|txt|xml|webmanifest)$|^_headers$/.test(f)) fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (/sarah/i.test(l)) hits.push(path.relative(root, p) + ":" + (i + 1)); }); } })(root);
if (hits.length) { console.error("FAIL: 'Sarah' found on the public site:\n  " + hits.join("\n  ")); process.exit(1); }
console.log("PASS: no 'Sarah' in any public page, script, style or data file");
