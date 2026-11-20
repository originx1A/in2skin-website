// scripts/side-by-side.mjs — LIVE (7e386ce, port 8124) vs PREVIEW (port 8123)
// side-by-side screenshots: hero + price list (Classic picked, green;
// preview's next-step line pulsing gold) at 1440 and 390.
// Usage: node scripts/side-by-side.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";

const OUT = "layout-shots-home";
fs.mkdirSync(OUT, { recursive: true });
const LIVE = "http://localhost:8124";
const PREV = "http://localhost:8123";

const browser = await chromium.launch();

async function shot(base, width, name, pick) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 } });
  const page = await ctx.newPage();
  // 7e386ce (LIVE) keeps the price list in the #/book hash view; the
  // rebuild puts it on the home page at #services.
  const isLive = base === LIVE;
  await page.goto(base + (pick && isLive ? "/#/book" : "/"), { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (pick) {
    await page.evaluate(() => { const s = document.querySelector("#services"); if (s) s.scrollIntoView(); });
    await page.waitForTimeout(600);
    await page.click('.tx-row[data-tx-id="classic-facial"]', { timeout: 5000 }).catch(async () => {
      // fall back: click the row containing "Classic Facial"
      await page.locator(".tx-row", { hasText: "Classic Facial" }).first().click();
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const el = document.querySelector("#services");
      scrollTo(0, el.getBoundingClientRect().top + scrollY - 96);
    });
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

for (const w of [1440, 390]) {
  await shot(LIVE, w, `live-hero-${w}`, false);
  await shot(PREV, w, `prev-hero-${w}`, false);
  await shot(LIVE, w, `live-prices-${w}`, true);
  await shot(PREV, w, `prev-prices-${w}`, true);
}
await browser.close();

// Compose side-by-sides with PIL (LIVE left, PREVIEW right).
const py = `
from PIL import Image, ImageDraw
import os
os.chdir("${OUT}")
for w in (1440, 390):
    for kind in ("hero", "prices"):
        a = Image.open(f"live-{kind}-{w}.png"); b = Image.open(f"prev-{kind}-{w}.png")
        h = max(a.height, b.height)
        canvas = Image.new("RGB", (a.width + b.width + 12, h + 28), (255, 255, 255))
        canvas.paste(a, (0, 28)); canvas.paste(b, (a.width + 12, 28))
        d = ImageDraw.Draw(canvas)
        d.text((8, 8), "LIVE (7e386ce)", fill=(0, 0, 0))
        d.text((a.width + 20, 8), "PREVIEW (cooper/restore-7e386ce)", fill=(0, 0, 0))
        canvas.save(f"side-{kind}-{w}.png")
        print(f"side-{kind}-{w}.png", canvas.size)
`;
fs.writeFileSync("/tmp/compose-sbs.py", py);
execSync("python3 /tmp/compose-sbs.py", { stdio: "inherit" });
console.log("done");
