// `bun examples/layout-lab/scripts/scroll-gap.ts [profile...]`: scenario 19's bars (#240), measured in
// composited frames (a CDP screencast) through a fling, Busy off and on. Per frame, each bar's painted
// width along its centre row, sub-pixel by coverage, against CSS's own scroll-driven reference bar:
//
// - the progress bar, `scaleX: scrollYProgress`: a Timeline value where the browser has scroll
//   timelines, drawn with the scroll itself;
// - the gate bar, `createTransform(scrollYProgress, (p) => p)`: the gate draws it from the main thread's
//   copy of the scroll, as every scroll-linked value was before #240.
//
// A bar's gap (reference − bar) is how far what drew it trails the screen: in px, and in frames of the
// reference's own speed then. Profiles: mobile (390×844, touch fling), hidpi (800×600 at DPR 2, touch
// fling), hidpiWheel (the same, wheel notches), desktop (1400×1000 at DPR 1, touch fling), wheel (the
// same, wheel notches). At DPR 1 on a desktop, Chrome scrolls this box on the main thread, so every bar
// moves together. Needs the lab running (`LAB_URL`, the Solid 1 dev server's by default) and Chromium.
// `ROWS=1` prints every frame's widths.
import { chromium } from "playwright"
import { PNG } from "pngjs"

const profiles = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["mobile", "hidpi", "hidpiWheel", "desktop"]
const BAR_PX = 300
const MOVES = Number(process.env.MOVES ?? 6)
const STEP = Number(process.env.STEP ?? 12)
const CELLS = ["bar", "gate", "reference", "scroller"] as const

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}
interface Shot {
  readonly data: Buffer
  readonly t: number
  readonly meta: { readonly deviceWidth: number; readonly offsetTop: number }
}
interface Row {
  readonly t: number
  readonly bar: number
  readonly gate: number
  readonly ref: number
}

const pct = (xs: ReadonlyArray<number>, p: number): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}

/** A bar's gap to the reference over the frames the scroll moved: px, and frames of the reference's speed. */
const gapOf = (moving: ReadonlyArray<Row & { readonly dt: number; readonly dref: number }>, of: (r: Row) => number) => {
  const px = moving.map((r) => r.ref - of(r))
  const frames = moving.filter((r) => Math.abs(r.dref) > 1).map((r) => (r.ref - of(r)) / ((r.dref / r.dt) * (1000 / 60)))
  return {
    px: { p50: +pct(px, 0.5).toFixed(1), p90: +pct(px, 0.9).toFixed(1), max: +Math.max(...px.map(Math.abs), 0).toFixed(1) },
    frames: { p50: +pct(frames, 0.5).toFixed(2), p90: +pct(frames, 0.9).toFixed(2) },
  }
}

for (const profile of profiles) {
  const browser = await chromium.launch()
  // hidpi: a desktop at DPR 2, where Chrome composites a scroller it scrolls on the main thread at DPR 1.
  const options = {
    mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    hidpi: { viewport: { width: 800, height: 600 }, deviceScaleFactor: 2, hasTouch: true },
    hidpiWheel: { viewport: { width: 800, height: 600 }, deviceScaleFactor: 2, hasTouch: true },
  }[profile] ?? { viewport: { width: 1400, height: 1000 }, hasTouch: true }
  const page = await browser.newPage(options)
  await page.goto(process.env.LAB_URL ?? "http://localhost:5173/")
  await page.waitForFunction(() => (window as unknown as { __layoutLab?: unknown }).__layoutLab !== undefined)
  // Only s19's card: other cards' stages are wider than a phone's 390 px, which widens the layout
  // viewport past the visual one and offsets DOM rects from what the screen (and touch input) use.
  await page.addStyleTag({ content: '.card:not(:has([data-scenario="scroll-linked"])) { display: none !important }' })
  const root = page.locator('[data-scenario="scroll-linked"]')
  await root.locator(".stage").evaluate((el) => el.scrollIntoView({ block: "start" }))
  await page.waitForTimeout(800)
  const vv = await page.evaluate(() => [innerWidth, visualViewport!.offsetTop, visualViewport!.scale])
  if (vv[0] !== options.viewport.width || vv[1] !== 0 || vv[2] !== 1) throw new Error(`viewport ${vv}`)
  const rects: Record<string, Rect> = await root.evaluate(
    (r, cells) =>
      Object.fromEntries(
        cells.map((c) => {
          const b = r.querySelector(`[data-cell="${c}"]`)!.getBoundingClientRect()
          return [c, { x: b.x, y: b.y, w: b.width, h: b.height }]
        }),
      ),
    [...CELLS],
  )
  const cdp = await page.context().newCDPSession(page)
  const box = rects["scroller"]!
  for (const busy of [false, true]) {
    await root.locator('[data-cell="scroller"]').evaluate((el) => (el.scrollTop = 0))
    if (busy) await root.locator('[data-action="busy"]').click()
    await page.waitForTimeout(600)
    const shots: Array<Shot> = []
    cdp.on("Page.screencastFrame", (f) => {
      shots.push({ data: Buffer.from(f.data, "base64"), t: (f.metadata.timestamp ?? 0) * 1000, meta: f.metadata })
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
    })
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 })
    await page.waitForTimeout(300)
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    if (profile.toLowerCase().includes("wheel")) {
      // Wheel notches through CDP, not awaited (as the touch moves are).
      const sent: Array<Promise<unknown>> = []
      for (let k = 0; k < 8; k++) {
        sent.push(cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: 70 }))
        await new Promise((r) => setTimeout(r, 30))
      }
      await Promise.all(sent)
    } else {
      // A touch fling: MOVES moves of STEP px every 16 ms, let go moving, and the fling runs on.
      let y = box.y + box.h - 4
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y }] })
      // Not awaited: CDP answers a touch event once the page acked it, which a busy main thread holds
      // (Playwright's own window touchstart listener isn't passive); a finger doesn't wait.
      const sent: Array<Promise<unknown>> = []
      for (let i = 0; i < MOVES; i++) {
        await new Promise((r) => setTimeout(r, 16))
        y -= STEP
        sent.push(cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y }] }))
      }
      sent.push(cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }))
      await Promise.all(sent)
    }
    await page.waitForTimeout(2000)
    await cdp.send("Page.stopScreencast")
    cdp.removeAllListeners("Page.screencastFrame")
    if (busy) await root.locator('[data-action="busy"]').click()

    // Each bar's width in a frame: coverage along its centre row against the stage's background.
    const rows: Array<Row> = shots.map((s) => {
      const png = PNG.sync.read(s.data)
      const scale = png.width / s.meta.deviceWidth
      const widthOf = (r: Rect): number => {
        const y = Math.round((r.y + r.h / 2 - s.meta.offsetTop) * scale)
        const at = (x: number): [number, number, number] => {
          const i = (png.width * y + x) << 2
          return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!]
        }
        const x0 = Math.round(r.x * scale)
        const bg = at(Math.round((r.x + BAR_PX + 4) * scale))
        const full = at(x0 + Math.round(2 * scale))
        const d = (a: [number, number, number], b: [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        const span = d(full, bg)
        if (span < 40) return 0
        let w = 0
        for (let x = x0 - 2; x < Math.round((r.x + BAR_PX + 2) * scale); x++) w += Math.min(1, d(at(x), bg) / span)
        return w / scale
      }
      return { t: s.t, bar: widthOf(rects["bar"]!), gate: widthOf(rects["gate"]!), ref: widthOf(rects["reference"]!) }
    })
    // Frames where the reference moved since the last capture: the scroll is on.
    const moving = rows.flatMap((r, i) => (i > 0 && Math.abs(r.ref - rows[i - 1]!.ref) > 0.5 ? [{ ...r, dt: r.t - rows[i - 1]!.t, dref: r.ref - rows[i - 1]!.ref }] : []))
    const dts = rows.slice(1).map((r, i) => r.t - rows[i]!.t)
    const key = `${profile} busy ${busy ? "on" : "off"}`
    console.log(
      key,
      JSON.stringify({
        captures: rows.length,
        captureMs: { p50: +pct(dts, 0.5).toFixed(1), p90: +pct(dts, 0.9).toFixed(1) },
        movingCaptures: moving.length,
        timeline: gapOf(moving, (r) => r.bar),
        gate: gapOf(moving, (r) => r.gate),
      }),
    )
    if (process.env.ROWS === "1") for (const r of rows) console.log(`  ${r.t.toFixed(0)}  bar ${r.bar.toFixed(1)}  gate ${r.gate.toFixed(1)}  ref ${r.ref.toFixed(1)}`)
  }
  await browser.close()
}
