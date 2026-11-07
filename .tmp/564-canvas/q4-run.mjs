// PROTOTYPE Q4 (#564), the runner: bundles perf/q4-page.ts with Bun, opens it in Playwright's Chromium
// (headless, WebGL through SwiftShader), prints the per-case lag histograms.
//   bun p5-run.mjs
import { chromium } from "../../node_modules/playwright/index.mjs"
const built = await Bun.build({ entrypoints: [new URL("./perf/q4-page.ts", import.meta.url).pathname], target: "browser", format: "esm" })
if (!built.success) { console.error(built.logs); process.exit(1) }
const js = await built.outputs[0].text()
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] })
const page = await browser.newPage()
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()))
page.on("pageerror", (e) => console.error("pageerror:", e.message))
await page.setContent(`<!doctype html><body><script type="module">${js.replace(/<\/script/g, "<\\/script")}</script></body>`)
await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 })
console.log(JSON.stringify(await page.evaluate(() => window.__results), null, 2))
console.log("chromium", browser.version())
await browser.close()
