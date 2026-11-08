// PROTOTYPE (#564 follow-up), the runner for dom/page.ts: bundles it, opens each mode on a fresh page in
// Playwright's Chromium, and per round retargets every element, then lets 30 frames run. Chromium's own
// accounting (CDP Performance.getMetrics) splits each window into script, style recalc and layout time.
//   bun .tmp/564-canvas/dom/run.mjs [n] [reps]
import { chromium } from "../../../node_modules/playwright/index.mjs"

const N = Number(process.argv[2] ?? 1000)
const REPS = Number(process.argv[3] ?? 5)
const ROUNDS = 8
const FRAMES = 30
const built = await Bun.build({
  entrypoints: [new URL("./page.ts", import.meta.url).pathname],
  target: "browser",
  format: "esm",
  conditions: ["@wardic/source", "browser"],
  define: { "process.env.NODE_ENV": '"production"' },
})
if (!built.success) {
  console.error(built.logs)
  process.exit(1)
}
const js = await built.outputs[0].text()
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/page.js"></script></body></html>`

const browser = await chromium.launch()
const metricsOf = async (cdp) => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
const ms = (a, b, key) => (b[key] - a[key]) * 1000

const one = async (mode) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.on("pageerror", (e) => console.error(mode, "pageerror:", e.message))
  page.on("console", (m) => m.type() === "error" && console.error(mode, "console:", m.text()))
  await page.route("http://probe.local/**", (route) =>
    route.request().url().endsWith("/page.js")
      ? route.fulfill({ contentType: "application/javascript; charset=utf-8", body: js })
      : route.fulfill({ contentType: "text/html; charset=utf-8", body: html }))
  await page.goto(`http://probe.local/?mode=${mode}&n=${N}`)
  await page.waitForFunction(() => window.__probe?.ready === true)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable", { timeDomain: "threadTicks" })
  const rows = []
  for (let round = 0; round < ROUNDS; round++) {
    const a = await metricsOf(cdp)
    const inPage = await page.evaluate(() => window.__probe.retarget())
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
    const b = await metricsOf(cdp)
    await page.evaluate((n) => window.__probe.frames(n), FRAMES)
    const c = await metricsOf(cdp)
    const moving = await page.evaluate(() => window.__probe.moving())
    rows.push({
      retargetMs: ms(a, b, "ScriptDuration"),
      retargetInPageMs: inPage,
      scriptPerFrame: ms(b, c, "ScriptDuration") / FRAMES,
      stylePerFrame: ms(b, c, "RecalcStyleDuration") / FRAMES,
      layoutPerFrame: ms(b, c, "LayoutDuration") / FRAMES,
      taskPerFrame: ms(b, c, "TaskDuration") / FRAMES,
      movingAfter: moving,
    })
  }
  await page.close()
  return rows.slice(2) // the first two rounds warm the JIT
}

const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]
const results = {}
for (let rep = 0; rep < REPS; rep++) {
  for (const mode of ["ward", "batch", "floor"]) {
    const rows = await one(mode)
    ;(results[mode] ??= []).push(...rows)
  }
}
console.log(`chromium ${browser.version()}, N = ${N}, ${REPS} reps × ${ROUNDS - 2} rounds, ${FRAMES} frames a round`)
console.log("mode    retarget ms (CDP / in-page)   per frame: script   style   layout   task (ms)")
for (const [mode, rows] of Object.entries(results)) {
  const m = (k) => median(rows.map((r) => r[k])).toFixed(3)
  console.log(`${mode.padEnd(7)} ${m("retargetMs").padStart(9)} / ${m("retargetInPageMs").padStart(7)}        ${m("scriptPerFrame").padStart(7)} ${m("stylePerFrame").padStart(7)} ${m("layoutPerFrame").padStart(8)} ${m("taskPerFrame").padStart(7)}`)
}
await browser.close()
