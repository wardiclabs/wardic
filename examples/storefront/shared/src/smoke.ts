/**
 * The showcase's smoke test (#296 Q6): `bun ../shared/src/smoke.ts <app>` from an app's directory,
 * after `vite build`. It serves the production build with `vite preview`, opens the gallery and each
 * example's route in Chromium, and checks, for each:
 *
 * - it answers 200, with nothing logged as an error or a warning, no uncaught error, and no
 *   hydration mismatch;
 * - its demo moves, then settles: the example's `watch` element changes its computed opacity or
 *   transform after load, then holds still for 15 frames, within 5 s.
 *
 * Each page's screenshot lands in `<app>/.smoke/`, for a person to look at. Exits 1 on any failure.
 */
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, type ConsoleMessage, type Page } from "playwright"
import { EXAMPLES, routeOf } from "./examples.ts"

const APPS: Readonly<Record<string, { readonly port: number }>> = { solid1: { port: 4101 }, solid2: { port: 4102 } }

const app = process.argv[2] ?? ""
const config = APPS[app]
if (config === undefined) throw new Error(`smoke: an app is solid1 or solid2, not "${app}"`)
const base = `http://127.0.0.1:${config.port}`
const shots = join(process.cwd(), ".smoke")
mkdirSync(shots, { recursive: true })

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(config.port), "--strictPort"], { stdio: "pipe" })
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

interface Result {
  readonly route: string
  readonly problems: ReadonlyArray<string>
}

const check = async (page: Page, route: string, watch: string | undefined): Promise<Result> => {
  const problems: Array<string> = []
  const onConsole = (message: ConsoleMessage): void => {
    if (failing(message)) problems.push(`console ${message.type()}: ${message.text().slice(0, 200)}`)
  }
  const onError = (error: Error): void => {
    problems.push(`uncaught: ${error.message.slice(0, 200)}`)
  }
  page.on("console", onConsole)
  page.on("pageerror", onError)
  const response = await page.goto(base + route, { waitUntil: "commit" })
  if (response === null || response.status() !== 200) problems.push(`status ${response?.status()}`)
  if (watch !== undefined) {
    const samples = await sampleFrames(page, watch, 5000)
    const moved = new Set(samples).size > 1
    const last = samples.slice(-15)
    if (!moved) problems.push(`"${watch}" never moved (${samples.length} frames sampled)`)
    else if (new Set(last).size !== 1) problems.push(`"${watch}" hadn't settled after 5 s`)
  }
  await page.waitForLoadState("networkidle")
  await page.screenshot({ path: join(shots, `${route.replaceAll("/", "_") || "_"}.png`), fullPage: true })
  page.off("console", onConsole)
  page.off("pageerror", onError)
  return { route, problems }
}

await ready()
const browser = await chromium.launch()
const results: Array<Result> = []
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  results.push(await check(await context.newPage(), "/", undefined))
  for (const example of EXAMPLES) results.push(await check(await context.newPage(), routeOf(example), example.watch))
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
