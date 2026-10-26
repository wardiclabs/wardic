/**
 * The showcase's smoke test (#296 Q6): `bun ../shared/src/smoke.ts <app>` from an app's directory,
 * after `vite build`. It serves the production build with `vite preview`, opens the gallery and each
 * example's route in Chromium, and checks, for each:
 *
 * - it answers 200, with nothing logged as an error or a warning, no uncaught error, and no
 *   hydration mismatch;
 * - its demo moves, then settles: the example's `watch` element changes its computed opacity or
 *   transform after load (after a click on its `interact` element, for a demo that waits for the
 *   visitor), then holds still for 15 frames, within 5 s.
 *
 * And that the store answers the browser itself, not only the server render: the visitor's cookie
 * is kept, and the header's store settings, fetched when the panel opens, load.
 *
 * And each example as a visitor reaches it: from the gallery, by its link, rendered by the router in
 * the browser, so the server functions it calls go from there. Each must render its demo with nothing
 * logged and nothing uncaught.
 *
 * Each page's screenshot lands in `<app>/.smoke/`, for a person to look at. Exits 1 on any failure.
 */
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { type BrowserContext, chromium, type ConsoleMessage, type Page, type Request } from "playwright"
import { EXAMPLES, routeOf } from "./examples.ts"

const APPS: Readonly<Record<string, { readonly port: number }>> = { solid1: { port: 4101 }, solid2: { port: 4102 } }

const app = process.argv[2] ?? ""
const config = APPS[app]
if (config === undefined) throw new Error(`smoke: an app is solid1 or solid2, not "${app}"`)
const base = `http://127.0.0.1:${config.port}`
const shots = join(process.cwd(), ".smoke")
mkdirSync(shots, { recursive: true })

// The app's own Vite: `npx vite` from the app picks the repo root's older one.
const vite = join(process.cwd(), "node_modules", ".bin", "vite")
const server = spawn(vite, ["preview", "--host", "127.0.0.1", "--port", String(config.port), "--strictPort"], { stdio: "pipe" })
const stop = (): void => {
  server.kill("SIGTERM")
}
process.on("exit", stop)

const ready = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`smoke: ${base} never answered`)
}

/** A console message that's a failure: an error or a warning, or Solid's hydration complaint. */
const failing = (message: ConsoleMessage): boolean =>
  message.type() === "error" || message.type() === "warning" || /hydrat/i.test(message.text())

/** Each frame's computed opacity and transform of the first `selector`, for up to `ms`. */
const sampleFrames = (page: Page, selector: string, ms: number): Promise<ReadonlyArray<string>> =>
  page.evaluate(
    ({ selector, ms }) =>
      new Promise<Array<string>>((resolve) => {
        const samples: Array<string> = []
        const start = performance.now()
        const step = (): void => {
          const el = document.querySelector(selector)
          if (el !== null) {
            const style = getComputedStyle(el)
            samples.push(`${style.opacity}|${style.transform}`)
          }
          const last = samples.slice(-15)
          const settled = samples.length > 15 && new Set(samples).size > 1 && new Set(last).size === 1
          if (settled || performance.now() - start > ms) resolve(samples)
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    { selector, ms },
  )

/**
 * Waits for `page` to have loaded and its network to go quiet: no request open for half a second.
 * As Playwright's `networkidle`, but a live feed (Solid 2's `live()`, under `/_server/live/`) stays
 * open for as long as the page shows it, so it doesn't count.
 */
const quietOf = (page: Page): (() => Promise<void>) => {
  const open = new Set<Request>()
  page.on("request", (request) => {
    if (!request.url().includes("/_server/live/")) open.add(request)
  })
  page.on("requestfinished", (request) => open.delete(request))
  page.on("requestfailed", (request) => open.delete(request))
  return async () => {
    await page.waitForLoadState("load")
    const start = Date.now()
    let since = start
    while (Date.now() - since < 500 && Date.now() - start < 30_000) {
      if (open.size > 0) since = Date.now()
      await page.waitForTimeout(50)
    }
  }
}

/**
 * One of an example's steps: a click on a selector; `drag:<selector>:<dx>:<dy>`, a press on its
 * centre, a slow move by (dx, dy), and a release; or `scroll:<selector>:<dy>`, the element scrolled
 * by dy over a dozen frames (#388), not waited on: a scroll-linked value moves with the scroll, so
 * the watch has to see it while it runs.
 */
const act = async (page: Page, step: string): Promise<void> => {
  const scroll = /^scroll:(.+):(-?\d+)$/.exec(step)
  if (scroll !== null) {
    return page.locator(scroll[1]!).evaluate((el, dy) => {
      let left = 12
      const next = (): void => {
        el.scrollBy(0, dy / 12)
        left -= 1
        if (left > 0) requestAnimationFrame(next)
      }
      requestAnimationFrame(next)
    }, Number(scroll[2]))
  }
  const drag = /^drag:(.+):(-?\d+):(-?\d+)$/.exec(step)
  if (drag === null) return page.click(step)
  const box = await page.locator(drag[1]!).boundingBox()
  if (box === null) throw new Error(`smoke: nothing to drag at ${drag[1]}`)
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + Number(drag[2]), from.y + Number(drag[3]), { steps: 20 })
  await page.mouse.up()
}

interface Result {
  readonly route: string
  readonly problems: ReadonlyArray<string>
}

const check = async (page: Page, route: string, watch: string | undefined, interact: string | ReadonlyArray<string> | undefined): Promise<Result> => {
  const problems: Array<string> = []
  const onConsole = (message: ConsoleMessage): void => {
    if (failing(message)) problems.push(`console ${message.type()}: ${message.text().slice(0, 200)}`)
  }
  const onError = (error: Error): void => {
    problems.push(`uncaught: ${error.message.slice(0, 200)}`)
  }
  page.on("console", onConsole)
  page.on("pageerror", onError)
  const quiet = quietOf(page)
  const response = await page.goto(base + route, { waitUntil: "commit" })
  if (response === null || response.status() !== 200) problems.push(`status ${response?.status()}`)
  if (interact !== undefined) {
    // A demo that waits for the visitor: once it has hydrated, click it, then watch what that moves.
    await quiet()
    for (const step of [interact].flat()) await act(page, step)
  }
  if (watch !== undefined) {
    const samples = await sampleFrames(page, watch, 5000)
    const moved = new Set(samples).size > 1
    const last = samples.slice(-15)
    if (!moved) problems.push(`"${watch}" never moved (${samples.length} frames sampled)`)
    else if (new Set(last).size !== 1) problems.push(`"${watch}" hadn't settled after 5 s`)
  }
  await quiet()
  await page.screenshot({ path: join(shots, `${route.replaceAll("/", "_") || "_"}.png`), fullPage: true })
  page.off("console", onConsole)
  page.off("pageerror", onError)
  return { route, problems }
}

/**
 * The store, from the browser: the visitor's cookie is kept, so a cart lasts between requests, and a
 * server function the browser calls itself decodes. The store settings' switch is an action whose
 * settings the browser then fetches again: the panel must still show them, switched. In a context of
 * its own, so its visitor, asking for failures, isn't the pages' visitor.
 */
const checkStore = async (context: BrowserContext, page: Page): Promise<Result> => {
  const problems: Array<string> = []
  await page.goto(base + "/")
  await page.waitForLoadState("networkidle")
  const cookies = await context.cookies(base)
  if (!cookies.some((cookie) => cookie.name === "storefront-visitor")) problems.push("the visitor's cookie wasn't kept")
  await page.click('button[aria-label="Store settings"]')
  const failSwitch = '.settings-panel input[type="checkbox"]'
  const switched = (on: boolean): Promise<boolean> =>
    page
      .click(failSwitch, { timeout: 5000 })
      .then(() => page.waitForFunction(({ selector, on }) => (document.querySelector(selector) as HTMLInputElement | null)?.checked === on, { selector: failSwitch, on }, { timeout: 5000 }))
      .then(() => true)
      .catch(() => false)
  await page.waitForSelector(failSwitch, { timeout: 5000 })
  if (!(await switched(true))) problems.push("the store's settings, fetched again by the browser after a change, didn't load")
  else if (!(await switched(false))) problems.push("the store's settings couldn't be switched back")
  await page.waitForLoadState("networkidle")
  return { route: "/ (the store, from the browser)", problems }
}

/**
 * Each example reached from the gallery by its link, the router rendering it in the browser (no
 * document from the server), then the gallery loaded again. A server function an example calls
 * from the browser must send its arguments: `undefined` isn't JSON, and Solid 2 refuses it.
 */
const checkNavigation = async (page: Page): Promise<ReadonlyArray<Result>> => {
  const results: Array<Result> = []
  const problems: Array<string> = []
  let documents = 0
  page.on("console", (message) => {
    if (failing(message)) problems.push(`console ${message.type()}: ${message.text().slice(0, 200)}`)
  })
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message.slice(0, 200)}`))
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents++
  })
  const quiet = quietOf(page)
  await page.goto(base + "/", { waitUntil: "commit" })
  await quiet()
  for (const example of EXAMPLES) {
    const route = routeOf(example)
    problems.length = 0
    documents = 0
    await page.click(`a[href='${route}']`)
    await page.waitForURL(base + route)
    await quiet()
    if ((await page.locator(".demo").count()) === 0) problems.push("no demo on the page")
    if (documents > 0) problems.push("its link loaded a document from the server, not the router")
    results.push({ route: `${route}, from the gallery's link`, problems: [...problems] })
    // Back to the gallery, loaded afresh: a page that failed may have no link left to click.
    await page.goto(base + "/", { waitUntil: "commit" })
    await quiet()
  }
  return results
}

await ready()
const browser = await chromium.launch()
const results: Array<Result> = []
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  results.push(await check(await context.newPage(), "/", undefined, undefined))
  const storeContext = await browser.newContext()
  results.push(await checkStore(storeContext, await storeContext.newPage()))
  await storeContext.close()
  for (const example of EXAMPLES) results.push(await check(await context.newPage(), routeOf(example), example.watch, example.interact))
  results.push(...(await checkNavigation(await context.newPage())))
} finally {
  await browser.close()
  stop()
}

let failed = 0
for (const result of results) {
  if (result.problems.length === 0) {
    console.log(`ok    ${result.route}`)
    continue
  }
  failed++
  console.log(`FAIL  ${result.route}`)
  for (const problem of result.problems) console.log(`      ${problem}`)
}
console.log(`\n${app}: ${results.length - failed} of ${results.length} routes passed; screenshots in ${shots}`)
process.exit(failed === 0 ? 0 : 1)
