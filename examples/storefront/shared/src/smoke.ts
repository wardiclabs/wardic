/**
 * The showcase's smoke test (#296 Q6, #366 Q9): `bun ../shared/src/smoke.ts <app>` from an app's
 * directory, after its build. It serves the production build (`vite preview` for the Solid apps,
 * `next start` for Motion's), opens the gallery and each example's route in Chromium, and checks,
 * for each:
 *
 * - it answers 200, with nothing logged as an error or a warning, no uncaught error, and no
 *   hydration mismatch;
 * - its demo moves, then settles: the example's `watch` element changes its computed opacity or
 *   transform after load (after a click on its `interact` element, for a demo that waits for the
 *   visitor), then holds still for 15 frames, within 5 s;
 * - in a Solid app: the code's Motion tab shows Motion's files in place of the demo's, and links to
 *   it running (#366).
 *
 * And that every example has its Motion version, in the Next.js app (#366 Q9).
 *
 * And that the store answers the browser itself, not only the server render: the visitor's cookie
 * is kept, and the header's store settings, fetched when the panel opens, load.
 *
 * And each example as a visitor reaches it: from the gallery, by its link, rendered by the router in
 * the browser, so the server functions it calls go from there. Each must render its demo with nothing
 * logged and nothing uncaught.
 *
 * Each page's screenshot lands in `<app>/.smoke/`, for a person to look at. Exits 1 on any failure.
 *
 * `--dev`, for the Solid 2 app (#460, Q9): the same checks on its dev server, on Solid's development
 * builds, failing on every coded diagnostic the binding's tests fail on (`gate-filter.ts`). The
 * dev server installs Solid's diagnostics bridge (`@solidjs/diagnostics`, a devDependency), and the
 * smoke begins its session as the bridge is installed, before hydration, so a page's whole life is
 * read: every code at every severity, from the bridge, and the server render's, from the dev server's
 * output. Each page's session, with its attribution (re-runs, costs, holds), lands in
 * `<app>/.smoke/dev/diagnostics/`, for the heuristics the gate leaves out. Run it on any change to
 * the Solid 2 binding, beside the browser suite.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type BrowserContext, chromium, type ConsoleMessage, type Page, type Request } from "playwright"
// The binding's own gate, so the dev mode fails on what its tests fail on.
import { codeOf, gated, reports } from "../../../../packages/solid/test/v2/gate-filter.ts"
import { APPS, type AppId } from "./apps.ts"
import { EXAMPLES, hasExample, routeOf } from "./examples.ts"

const app = process.argv[2] ?? ""
if (!(app in APPS)) throw new Error(`smoke: an app is solid1, solid2 or next, not "${app}"`)
/** The dev mode (#460, Q9): the Solid 2 app's dev server, failing on its coded diagnostics. */
const dev = process.argv.includes("--dev")
if (dev && app !== "solid2") throw new Error("smoke: --dev is the Solid 2 app's, whose dev build reports coded diagnostics")
const config = APPS[app as AppId]
/** The examples this app has: all of them, less those for another binding's pattern alone. */
const examples = EXAMPLES.filter((example) => hasExample(config.id, example))
/**
 * A deployment to check instead of this app's build (examples/storefront/deploy): its address, as
 * `STOREFRONT_SMOKE_URL`, and, for a Solid app, where its Motion tab should link, as
 * `STOREFRONT_NEXT_URL`. Nothing is started then.
 */
const deployed = process.env.STOREFRONT_SMOKE_URL
if (dev && deployed !== undefined) throw new Error("smoke: --dev runs the app's own dev server, not a deployment")
const base = deployed ?? `http://127.0.0.1:${config.port}`
const shots = join(process.cwd(), ".smoke", dev ? "dev" : "")
mkdirSync(shots, { recursive: true })
/** Where the dev mode keeps each page's diagnostics session. */
const sessions = join(shots, "diagnostics")
if (dev) mkdirSync(sessions, { recursive: true })

/** Whether the Next.js app has an example in Motion (#366): its folder in `src/examples/`. */
const nextHas = (id: string): boolean => existsSync(join(process.cwd(), "..", "next", "src", "examples", id, "Demo.tsx"))

/** Every example the Next.js app has, in Motion (#366 Q9): one missing fails every app's run, named. */
const completeness: Result = {
  route: "every example in Motion (the Next.js app)",
  problems: EXAMPLES.filter((example) => hasExample("next", example) && !nextHas(example.id)).map((example) => `${routeOf(example)} has no Motion version: next/src/examples/${example.id}/Demo.tsx`),
}

/**
 * The app's own server for its build: its own Vite (`npx vite` from the app picks the repo root's
 * older one), or Next.js; with `--dev`, its Vite dev server.
 */
const vite = join(process.cwd(), "node_modules", ".bin", "vite")
const command: ReadonlyArray<string> =
  app === "next"
    ? [join(process.cwd(), "node_modules", ".bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(config.port)]
    : [vite, ...(dev ? [] : ["preview"]), "--host", "127.0.0.1", "--port", String(config.port), "--strictPort"]
const server = deployed === undefined ? spawn(command[0]!, command.slice(1), { stdio: "pipe", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } }) : undefined
/**
 * Every line the server has printed, read so its pipes never fill. The dev mode reads a server
 * render's diagnostics there; Vite's dev server also prints the browser's console, each message
 * under a `[vite] (client)` line, which the bridge has already read.
 */
const serverLines: Array<string> = []
const readLines = (chunk: Buffer): void => {
  serverLines.push(...chunk.toString().split("\n"))
}
server?.stdout?.on("data", readLines)
server?.stderr?.on("data", readLines)
const stop = (): void => {
  server?.kill("SIGTERM")
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

/**
 * A console message that's a failure: an error or a warning, or Solid's hydration complaint. In the
 * dev mode, a coded diagnostic's lines are the bridge's to report (`diagnosed`), at every severity.
 */
const failing = (message: ConsoleMessage): boolean => {
  if (dev && codeOf(message.text()) !== undefined) return false
  return message.type() === "error" || message.type() === "warning" || /hydrat/i.test(message.text())
}

/** One of Solid's coded diagnostics, as its bridge hands it over. */
interface Diagnostic {
  readonly code: string
  readonly severity: string
  readonly message: string
}

/** The shape of Solid's diagnostics bridge the smoke drives (`@solidjs/diagnostics/browser`). */
interface Bridge {
  begin(options: { readonly attribution: boolean }): void
  end(): { readonly diagnostics: ReadonlyArray<Diagnostic> }
  active(): boolean
}

/**
 * Run in each page before its own scripts (the dev mode): when Solid's bridge is installed, the dev
 * client entry's first import, begin its session, so hydration is read too.
 */
const beginAtInstall = (): void => {
  let bridge: Bridge | undefined
  Object.defineProperty(globalThis, "__SOLID_DIAGNOSTICS__", {
    configurable: true,
    get: () => bridge,
    set: (value: Bridge) => {
      bridge = value
      value.begin({ attribution: true })
    },
  })
}

/** A diagnostic's report: its code, then its first line. */
const reportOf = (code: string, message: string): string => {
  const line = (message.split("\n")[0] ?? message).slice(0, 200)
  if (line.startsWith(`[${code}]`)) return `diagnostic ${line}`
  return `diagnostic [${code}] ${line}`
}

/** A server's printed line, its colours taken off. */
const plain = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "").trim()

/** Codes a page may make, each with why (`Example.allowDiagnostics`). */
type Allowed = Readonly<Record<string, string>>

/**
 * The dev mode's reading of a page (`label` names its session's file): the bridge's session since it
 * began, ended and begun again, its diagnostics the gate fails on, less those `allowed`, and the
 * server's since `from`.
 */
const diagnosed = async (page: Page, label: string, from: number, allowed: Allowed = {}): Promise<ReadonlyArray<string>> => {
  if (!dev) return []
  const session = await page.evaluate(() => {
    const bridge = (globalThis as unknown as { __SOLID_DIAGNOSTICS__?: Bridge }).__SOLID_DIAGNOSTICS__
    if (bridge === undefined || !bridge.active()) return undefined
    const ended = bridge.end()
    bridge.begin({ attribution: true })
    return ended
  })
  const problems = serverLines
    .slice(from)
    .map(plain)
    .filter((line) => reports(line) && !(codeOf(line)! in allowed))
    .map((line) => `server ${line.slice(0, 200)}`)
  if (session === undefined) return [...problems, "no diagnostics session on the page: is @solidjs/diagnostics the app's devDependency?"]
  writeFileSync(join(sessions, `${label.replaceAll("/", "_") || "_"}.json`), JSON.stringify(session))
  for (const diagnostic of session.diagnostics) if (gated(diagnostic.code) && !(diagnostic.code in allowed)) problems.push(reportOf(diagnostic.code, diagnostic.message))
  return problems
}

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
 * A live feed's request: Solid 2's `live()`, under `/_server/live/`, or the Motion app's server-sent
 * events (`/api/wishlist`). It stays open for as long as the page shows it.
 */
const isFeed = (request: Request): boolean => request.url().includes("/_server/live/") || request.url().includes("/api/wishlist")

/**
 * Waits for `page` to have loaded and its network to go quiet: no request open for half a second.
 * As Playwright's `networkidle`, but a live feed doesn't count.
 */
const quietOf = (page: Page): (() => Promise<void>) => {
  const open = new Set<Request>()
  page.on("request", (request) => {
    if (!isFeed(request)) open.add(request)
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

/**
 * The code's tabs on a Solid app's page (#366 Q2), for an example the Next.js app has: the Motion tab
 * shows Motion's files in place of the demo's, and its link goes to the example in the Next.js app.
 */
const checkTabs = async (page: Page, route: string, problems: Array<string>): Promise<void> => {
  // From a fresh load: what the demo opened (a dialog, a drawer) may cover the page.
  await page.goto(base + route, { waitUntil: "load" })
  if ((await page.locator("label[for=code-motion]").count()) === 0) return void problems.push("no Motion tab beside the code")
  const shown = (selector: string): Promise<boolean> => page.$eval(selector, (el) => getComputedStyle(el).display !== "none")
  if (await shown(".code-pane-motion")) problems.push("Motion's code shows before its tab is chosen")
  await page.click("label[for=code-motion]")
  if (!(await shown(".code-pane-motion")) || (await shown(".code-pane-solid"))) problems.push("the Motion tab didn't show Motion's code in place of the demo's")
  if ((await page.locator(".code-pane-motion .code-file").count()) === 0) problems.push("the Motion tab has no files")
  const run = await page.getAttribute(".code-run", "href")
  const expected = (process.env.STOREFRONT_NEXT_URL ?? `:${APPS.next.port}`) + route
  if (run === null || !run.endsWith(expected)) problems.push(`the Motion tab's link goes to ${run}, not ${expected}`)
}

const check = async (page: Page, route: string, watch: string | undefined, interact: string | ReadonlyArray<string> | undefined, tabs = false, allowed: Allowed = {}): Promise<Result> => {
  const problems: Array<string> = []
  const from = serverLines.length
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
  problems.push(...(await diagnosed(page, route, from, allowed)))
  if (tabs) {
    const tabsFrom = serverLines.length
    await checkTabs(page, route, problems)
    problems.push(...(await diagnosed(page, `${route}, tabs`, tabsFrom, allowed)))
  }
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
  const from = serverLines.length
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
  problems.push(...(await diagnosed(page, "/, the store", from)))
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
  for (const example of examples) {
    const route = routeOf(example)
    problems.length = 0
    documents = 0
    const from = serverLines.length
    await page.click(`a[href='${route}']`)
    await page.waitForURL(base + route)
    await quiet()
    if ((await page.locator(".demo").count()) === 0) problems.push("no demo on the page")
    if (documents > 0) problems.push("its link loaded a document from the server, not the router")
    problems.push(...(await diagnosed(page, `${route}, from the gallery`, from, example.allowDiagnostics)))
    results.push({ route: `${route}, from the gallery's link`, problems: [...problems] })
    // Back to the gallery, loaded afresh: a page that failed may have no link left to click.
    await page.goto(base + "/", { waitUntil: "commit" })
    await quiet()
  }
  return results
}

await ready()
const browser = await chromium.launch()
const results: Array<Result> = [completeness]
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (dev) await context.addInitScript(beginAtInstall)
  results.push(await check(await context.newPage(), "/", undefined, undefined))
  const storeContext = await browser.newContext()
  if (dev) await storeContext.addInitScript(beginAtInstall)
  results.push(await checkStore(storeContext, await storeContext.newPage()))
  await storeContext.close()
  // The code's tabs, on a Solid app's page of an example the Next.js app has too.
  for (const example of examples) {
    results.push(await check(await context.newPage(), routeOf(example), example.watch, example.interact, app !== "next" && hasExample("next", example), example.allowDiagnostics))
  }
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
console.log(`\n${app}${dev ? " (dev)" : ""}: ${results.length - failed} of ${results.length} routes passed; screenshots in ${shots}`)
process.exit(failed === 0 ? 0 : 1)
