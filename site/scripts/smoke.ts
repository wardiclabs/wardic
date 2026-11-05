/**
 * The site's dev check (#618, S3): `bun run smoke:dev` in site/. It starts the dev server, on Solid's
 * development builds, opens every page in Chromium, scrolls each demo into view so it loads and runs,
 * and fails on:
 *
 * - any of Solid's coded diagnostics the binding's tests fail on (`gate-filter.ts`, as the storefront's
 *   `smoke:dev`): the browser's, read from Solid's diagnostics bridge (`@solidjs/diagnostics`, a
 *   devDependency, which the dev server installs) from before hydration, and the server render's,
 *   from the dev server's output;
 * - an error or a warning logged, or an uncaught error.
 *
 * Less what `ALLOWED` names, each with why: what a library the site uses reports, which the site
 * can't change.
 *
 * And that a failure stays where it is: a page whose module throws (served in place of a real one)
 * shows its error in the article with the sidebar still there, and a demo whose module throws shows
 * its error in its frame with the page still there.
 *
 * And the search, on a stand-in for Pagefind's script (the dev server has no index): a query's hits
 * show, and a box cleared before they come shows none.
 *
 * `bun scripts/smoke.ts <text>` opens only the pages whose path has `<text>` in it, and both failure
 * checks. Exits 1 on any failure.
 */
import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { chromium, type ConsoleMessage, type Page } from "playwright"
import { codeOf, gated, reports } from "../../packages/solid/test/v2/gate-filter.ts"

const SITE = join(import.meta.dirname, "..")
const PORT = 3119
const base = `http://127.0.0.1:${PORT}`

/** Every page's path, from its MDX file: `index.mdx` is `/`, `guides/layout.mdx` is `/guides/layout`. */
const pagesIn = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pagesIn(path)
    if (!entry.name.endsWith(".mdx")) return []
    const name = relative(join(SITE, "src/content"), path).replace(/\.mdx$/, "").replace(/(^|\/)index$/, "")
    return [`/${name}`]
  })
const only = process.argv[2]
const PAGES = [...pagesIn(join(SITE, "src/content"))].filter((path) => only === undefined || path.includes(only)).sort()

/** Every line the dev server has printed, read so its pipes never fill; a server render's diagnostics are there. */
const serverLines: Array<string> = []
const server = spawn(join(SITE, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: SITE })
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk: Buffer) => serverLines.push(...chunk.toString().split("\n")))

const ready = async (): Promise<void> => {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(base)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`smoke: ${base} never answered`)
}

/** One of Solid's coded diagnostics, as its bridge hands it over. */
interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly ownerPath?: ReadonlyArray<string>
}

/** A diagnostic the check lets through: its codes, where it comes from, and why. */
interface Allowance {
  readonly codes: ReadonlyArray<string>
  readonly from: (diagnostic: Diagnostic) => boolean
  readonly why: string
}

const ALLOWED: ReadonlyArray<Allowance> = [
  {
    codes: ["EFFECT_WRITES_OWN_SOURCE", "EFFECT_RELAY_TEAR"],
    from: (diagnostic) => (diagnostic.ownerPath ?? []).includes("<Polymorphic>"),
    why:
      "Kobalte (@kobalte/core 2.0.0-alpha.4): every part renders through its <Polymorphic>, whose effect writes " +
      "the element into a signal it then reads (dist/polymorphic/index.jsx:10). CodeTabs' Tabs report both on " +
      "every page with code tabs (#618, S3).",
  },
]

/** Whether `diagnostic` is one `ALLOWED` lets through. */
const allowed = (diagnostic: Diagnostic): boolean => ALLOWED.some((allowance) => allowance.codes.includes(diagnostic.code) && allowance.from(diagnostic))

/** The shape of Solid's diagnostics bridge the check drives (`@solidjs/diagnostics/browser`). */
interface Bridge {
  begin(options: { readonly attribution: boolean }): void
  end(): { readonly diagnostics: ReadonlyArray<Diagnostic> }
  active(): boolean
}

/** Run in each page before its own scripts: when Solid's bridge is installed, begin its session, so hydration is read too. */
const beginAtInstall = (): void => {
  let bridge: Bridge | undefined
  Object.defineProperty(globalThis, "__SOLID_DIAGNOSTICS__", {
    configurable: true,
    get: () => bridge,
    set: (value: Bridge) => {
      bridge = value
      value.begin({ attribution: false })
    },
  })
}

/** A server's printed line, its colours taken off. */
const plain = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "").trim()

/** A diagnostic's report: its code, then its first line. */
const reportOf = (code: string, message: string): string => {
  const line = (message.split("\n")[0] ?? message).slice(0, 200)
  if (line.startsWith(`[${code}]`)) return `diagnostic ${line}`
  return `diagnostic [${code}] ${line}`
}

/** A console message that's a failure: an error or a warning; a coded one is the bridge's to report. */
const failing = (message: ConsoleMessage): boolean => {
  if (codeOf(message.text()) !== undefined) return false
  return message.type() === "error" || message.type() === "warning"
}

/** The bridge's session since it began, ended and begun again: what the gate fails on, and the server's lines since `from`. */
const diagnosed = async (page: Page, from: number): Promise<ReadonlyArray<string>> => {
  const session = await page.evaluate(() => {
    const bridge = (globalThis as unknown as { __SOLID_DIAGNOSTICS__?: Bridge }).__SOLID_DIAGNOSTICS__
    if (bridge === undefined || !bridge.active()) return undefined
    const ended = bridge.end()
    bridge.begin({ attribution: false })
    return ended
  })
  const problems = serverLines
    .slice(from)
    .map(plain)
    .filter(reports)
    .map((line) => `server ${line.slice(0, 200)}`)
  if (session === undefined) return [...problems, "no diagnostics session on the page: is @solidjs/diagnostics the site's devDependency?"]
  for (const diagnostic of session.diagnostics) if (gated(diagnostic.code) && !allowed(diagnostic)) problems.push(reportOf(diagnostic.code, diagnostic.message))
  return problems
}

/** Scroll each demo into view, and wait until it has drawn something (or 5 s). */
const runDemos = async (page: Page): Promise<void> => {
  const demos = await page.locator(".demo").count()
  for (let i = 0; i < demos; i++) {
    const demo = page.locator(".demo").nth(i)
    await demo.scrollIntoViewIfNeeded()
    await demo
      .locator(".demo-stage > *")
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => undefined)
    await page.waitForTimeout(300)
  }
}

/** A module that throws as it renders, served in place of a page's or a demo's. */
const THROWS = 'export default function Throws() { throw new Error("smoke: this module throws") }\n'

await ready()
const browser = await chromium.launch()
const failures: Array<string> = []

/** Open `path` in a fresh page, run `act` on it, and record what went wrong under `label`. */
const check = async (label: string, path: string, act: (page: Page) => Promise<ReadonlyArray<string>>, expectErrors = false): Promise<void> => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await context.addInitScript(beginAtInstall)
  const page = await context.newPage()
  const problems: Array<string> = []
  if (!expectErrors) {
    page.on("console", (message) => {
      if (failing(message)) problems.push(`console ${message.type()}: ${message.text().slice(0, 200)}`)
    })
    page.on("pageerror", (error) => problems.push(`uncaught: ${error.message.slice(0, 200)}`))
  }
  const from = serverLines.length
  try {
    const response = await page.goto(base + path, { waitUntil: "load" })
    if (response?.status() !== 200) problems.push(`status ${response?.status()}`)
    await page.waitForTimeout(400)
    problems.push(...(await act(page)))
    if (!expectErrors) problems.push(...(await diagnosed(page, from)))
  } catch (error) {
    problems.push(`threw: ${String(error).slice(0, 200)}`)
  }
  await context.close()
  if (problems.length === 0) console.log(`ok    ${label}`)
  else {
    console.log(`FAIL  ${label}`)
    for (const problem of problems) console.log(`        ${problem}`)
    failures.push(label)
  }
}

for (const path of PAGES)
  await check(path, path, async (page) => {
    await runDemos(page)
    return []
  })

// A page that throws: opened from another by its sidebar link, so its module loads in the browser.
await check(
  "a page that throws keeps the sidebar",
  "/",
  async (page) => {
    await page.route(/\/src\/content\/guides\/animate\.mdx/, (route) => route.fulfill({ contentType: "text/javascript", body: THROWS }))
    await page.click('.sidebar a[href="/guides/animate"]')
    const shown = await page
      .locator("article .failed")
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    const problems: Array<string> = []
    if (!shown) problems.push("no failure shown in the article")
    if ((await page.locator(".sidebar a").count()) === 0) problems.push("the sidebar went")
    return problems
  },
  true,
)

// A demo that throws: its sample's module, as the demo loads it in view. Opened from another page, as
// a page's first demo can be in view, and loading, as it loads.
await check(
  "a demo that throws keeps the page",
  "/",
  async (page) => {
    await page.route(/\/samples\/[^/]+\/solid2\.tsx/, (route) => route.fulfill({ contentType: "text/javascript", body: THROWS }))
    await page.click('.sidebar a[href="/guides/animate"]')
    const demo = page.locator(".demo").first()
    await demo.scrollIntoViewIfNeeded()
    const shown = await demo
      .locator(".failed")
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    const problems: Array<string> = []
    if (!shown) problems.push("no failure shown in the demo's frame")
    if ((await page.locator("article h1").count()) === 0) problems.push("the page went")
    return problems
  },
  true,
)

/**
 * Pagefind's script, stood in for: a query answers after 300 ms with one hit named for it, and one a
 * newer query replaced answers `null`, as Pagefind's debounce does.
 */
const PAGEFIND = `
let latest = 0
export async function debouncedSearch(query) {
  const mine = ++latest
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (mine !== latest) return null
  return { results: [{ data: async () => ({ url: "/why.html", excerpt: query, meta: { title: "Hit for " + query } }) }] }
}
`

await check("search: a query's hits show, and a box cleared before they come shows none", "/", async (page) => {
  await page.route(/\/pagefind\/pagefind\.js/, (route) => route.fulfill({ contentType: "text/javascript", body: PAGEFIND }))
  await page.click(".search-button")
  const input = page.locator(".search-input")
  const problems: Array<string> = []
  await input.fill("spring")
  await page.waitForTimeout(700)
  const shown = await page.locator(".search-hits li").allTextContents()
  if (shown.length !== 1 || !shown[0]!.includes("Hit for spring")) problems.push(`after "spring": ${JSON.stringify(shown)}`)
  // #618 (S3): cleared within the debounce, the last query's hits landed after the box was empty.
  await input.fill("drag")
  await page.waitForTimeout(100)
  await input.fill("")
  await page.waitForTimeout(700)
  const cleared = await page.locator(".search-hits li").allTextContents()
  if (cleared.length !== 0) problems.push(`cleared: ${JSON.stringify(cleared)}`)
  return problems
})

await browser.close()
server.kill()
const checks = PAGES.length + 3
console.log(`\nsite (dev): ${checks - failures.length} of ${checks} checks passed`)
process.exit(failures.length === 0 ? 0 : 1)
