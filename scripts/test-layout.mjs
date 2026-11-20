// scripts/test-layout.mjs  —  run: node scripts/test-layout.mjs <baseUrl> <path> [<path>...]
// e.g. node scripts/test-layout.mjs https://PREVIEW.vercel.app / /services/ /book/ /contact/ /how-to-choose/ /faq/ /gift/
// Needs: npm i -D playwright ; npx playwright install chromium
import { chromium } from 'playwright';
import fs from 'fs';
const [base, ...paths] = process.argv.slice(2);
const WIDTHS = [320, 390, 768, 1024, 1280, 1440, 1920];
const out = process.env.SHOTS || 'layout-shots'; fs.mkdirSync(out, { recursive: true });
let fail = 0;
const browser = await chromium.launch();
for (const p of (paths.length ? paths : ['/'])) for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: w < 700 ? 844 : 900 } });
  await page.goto(base.replace(/\/$/, '') + p, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vis = el => el.checkVisibility && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const rects = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim(); const el = n.parentElement;
      if (!t || !el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest('svg') || !vis(el)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const fixed = (() => { for (let e = el; e; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return e; return null; })();
      for (const c of rg.getClientRects()) {
        if (c.width < 2 || c.height < 4) continue;
        const sy = fixed ? 0 : scrollY, sx = fixed ? 0 : scrollX;
        const padY = c.height * 0.15;
        rects.push({ t: t.slice(0, 40), el, fixed: !!fixed, l: c.left + sx, r: c.right + sx, tp: c.top + sy + padY, b: c.bottom + sy - padY });
      }
    }
    const bad = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.fixed !== b.fixed && !(a.fixed ? b.tp < innerHeight : a.tp < innerHeight)) continue; // fixed bars vs content: only the first screen counts
      if (a.fixed && !b.fixed) { /* compare in viewport coords at scroll 0 */ }
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.tp, b.tp);
      if (ox > 2 && oy > 2) bad.push(`"${a.t}" overlaps "${b.t}"`);
    }
    // text clipped by its own box
    const clipped = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.children.length === 0 && e.textContent.trim() && getComputedStyle(e).overflow !== 'visible' && e.scrollWidth > e.clientWidth + 2).map(e => 'clipped: ' + e.textContent.trim().slice(0, 40));
    const hscroll = document.documentElement.scrollWidth > innerWidth + 1 ? [`horizontal scroll: ${document.documentElement.scrollWidth} > ${innerWidth}`] : [];
    // duplicates (main content only): same paragraph/heading/button text twice
    const main = document.querySelector('main') || document.body;
    const seen = new Map(), dups = [];
    main.querySelectorAll('h1,h2,h3,p,li,summary,button,a.btn,.btn').forEach(e => {
      if (e.closest('header,nav,footer,[data-allow-repeat]') || !vis(e)) return;
      const k = e.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (k.length < 12 && !/^(book|call)/.test(k)) return;
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    seen.forEach((c, k) => { if (c > 1) dups.push(`duplicate x${c}: "${k.slice(0, 60)}"`); });
    // prices only inside [data-price-list], [data-price-teaser], [data-summary]
    const stray = [...main.querySelectorAll('h1,h2,h3,p,li,span,b,strong,button,a')].filter(e => e.children.length === 0 && vis(e) && /\$\s?\d/.test(e.textContent) && !e.closest('[data-price-list],[data-price-teaser],[data-summary],[data-allow-repeat]')).map(e => 'price outside the one list: ' + e.textContent.trim().slice(0, 40));
    // CTA rules
    const first = [...document.querySelectorAll('a.btn-book,button.btn-book,.btn-gold')].filter(e => vis(e) && e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 0);
    const ctas = first.length > 2 ? [`too many gold Book buttons in the first screen: ${first.length}`] : [];
    return { bad, clipped, hscroll, dups, stray, ctas };
  });
  const issues = [...r.hscroll, ...r.bad, ...r.clipped, ...r.dups, ...r.stray, ...r.ctas];
  await page.screenshot({ path: `${out}/${p.replace(/\W+/g, '_')}-${w}.png`, fullPage: true });
  console.log(`${issues.length ? 'FAIL' : 'PASS'}  ${p}  ${w}px` + (issues.length ? '\n   - ' + [...new Set(issues)].slice(0, 12).join('\n   - ') : ''));
  fail += issues.length ? 1 : 0;
  await page.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
