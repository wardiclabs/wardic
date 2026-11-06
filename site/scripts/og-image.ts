/**
 * The site's link-preview image, `public/og.png` (1200 × 630, Open Graph's size): the lockup on dark
 * (brand/), the home page's description under it, and the site's address, on Polar Night, drawn by
 * Chromium. Run it again after the lockup or the description changes: `bun run og-image`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { frontOf } from "../plugins/page-front-matter.ts"

const SITE = join(import.meta.dirname, "..")
const lockup = readFileSync(join(SITE, "..", "brand", "wardic-lockup-on-dark.svg"), "utf8")
const font = readFileSync(join(SITE, "public", "fonts", "manrope-latin.woff2")).toString("base64")
const description = frontOf(join(SITE, "src", "content", "index.mdx"), "description") ?? ""

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Manrope; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 200 800; }
  html, body { margin: 0; }
  body {
    width: 1200px; height: 630px; box-sizing: border-box; padding: 96px 104px;
    display: flex; flex-direction: column; justify-content: center; gap: 44px;
    background: radial-gradient(ellipse at 85% 0%, #3b4252 0%, #2e3440 60%);
    color: #eceff4; font-family: Manrope, sans-serif;
  }
  .lockup svg { width: 580px; height: auto; display: block; }
  p { margin: 0; font-size: 46px; font-weight: 600; line-height: 1.25; max-width: 940px; text-wrap: balance; }
  .address { font-size: 28px; font-weight: 700; color: #88c0d0; }
  .aurora { position: absolute; left: 0; right: 0; bottom: 0; height: 10px;
    background: linear-gradient(90deg, #8fbcbb, #88c0d0, #81a1c1, #ebcb8b, #b48ead); }
</style>
<div class="lockup">${lockup}</div>
<p>${description}</p>
<div class="address">wardic.dev</div>
<div class="aurora"></div>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(SITE, "public", "og.png") })
await browser.close()
console.log("og-image: public/og.png")
