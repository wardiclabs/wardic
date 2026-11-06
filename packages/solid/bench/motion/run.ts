/// <reference types="node" />
/**
 * `bun run bench:motion [--reps 11] [--rounds 4] [--n 1000]` (#615): Wardic against Motion for React,
 * the comparison "Why Wardic" quotes (`site/src/content/why.mdx`, #519).
 *
 * 1. **Motion's side** installs from `react/` (framer-motion and React, pinned, with their own
 *    lockfile) on the first run, apart from the workspace, whose install never takes them.
 * 2. **The pages** build (`build.ts`): Wardic on Solid 1 and on Solid 2, Motion on React, each with a
 *    plain page of the same elements and no animation library.
 * 3. **Each rep** opens every page in Chromium (GC exposed, cross-origin isolated, a fresh page each),
 *    their order rotating by rep, and runs `rounds` rounds of N elements: a mount, a Retarget while
 *    running, one at rest, an unmount (`timing.ts`). The first round is the page's first mount
 *    (cold); the median of the rest is warm.
 * 4. **It prints** the docs' table, each task with the two frames after it (an unmount with one), the
 *    median across reps, with the measurement line the docs give under it; then every metric of every
 *    page with its p25–p75; and it saves them as JSON in `dist/`.
 *
 * Timing wants a quiet machine: on the bench server, `wardic-quiet` first. It isn't run in CI.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { cpus, release, totalmem } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "playwright"
import { buildPages } from "./build.ts"

const D = import.meta.dirname
const REPO = join(D, "..", "..", "..", "..")

/** A flag's number, else `fallback`. */
const flag = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return Number(process.argv[i + 1])
}
const reps = flag("reps", 11)
const rounds = flag("rounds", 4)
const n = flag("n", 1000)

const PAGES = [
  { name: "solid-plain", script: "wardic.js", kind: "plain" },
  { name: "wardic", script: "wardic.js", kind: "wardic" },
  { name: "solid2-plain", script: "wardic-v2.js", kind: "plain" },
  { name: "wardic-v2", script: "wardic-v2.js", kind: "wardic" },
  { name: "react-plain", script: "motion.js", kind: "plain" },
  { name: "motion", script: "motion.js", kind: "motion" },
] as const
const METRICS = ["mount", "mountGap", "mountFrame", "mountFrame2", "flight", "retarget", "retargetGap", "retargetFrame", "retargetFrame2", "restRetarget", "restRetargetGap", "restRetargetFrame", "restRetargetFrame2", "unmount", "unmountGap", "unmountFrame"] as const
type Round = Record<(typeof METRICS)[number], number>

/** `command args` in `cwd`, its output. */
const sh = (command: string, args: ReadonlyArray<string>, cwd: string): string => execFileSync(command, args, { cwd, encoding: "utf8" }).trim()

// 1. Motion's side, once.
if (!existsSync(join(D, "react", "node_modules", "framer-motion"))) {
  console.log("bench:motion: installing Motion's side (react/)")
  sh("bun", ["install", "--frozen-lockfile"], join(D, "react"))
}
const motionVersion = (JSON.parse(readFileSync(join(D, "react", "node_modules", "framer-motion", "package.json"), "utf8")) as { readonly version: string }).version

// 2. The pages.
mkdirSync(join(D, "dist"), { recursive: true })
await buildPages()

// 3. The reps.
/** A fresh cross-origin isolated page running `js`, served from a routed origin. */
const open = async (browser: Browser, js: string, url: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors: Array<string> = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.route("http://localhost:4188/**", (route) => {
    if (new URL(route.request().url()).pathname === "/probe.js") {
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: js, headers: { "Cross-Origin-Resource-Policy": "same-origin" } })
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>bench:motion</title><body></body>", headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } })
  })
  await page.goto(url)
  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("not cross-origin isolated")
  await page.addScriptTag({ url: "http://localhost:4188/probe.js" })
  return { page, errors }
}

/** The `q` quantile of `xs`, interpolated. */
const quantile = (xs: ReadonlyArray<number>, q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (i - lo)
}

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] })
const chromiumVersion = browser.version()
const scripts = Object.fromEntries(PAGES.map((p) => [p.script, readFileSync(join(D, "dist", p.script), "utf8")]))
console.log(`Chromium ${chromiumVersion}, N = ${n}, ${rounds} rounds a page, ${reps} reps`)
const warm: Record<string, Array<Round>> = Object.fromEntries(PAGES.map((p) => [p.name, []]))
const cold: Record<string, Array<Round>> = Object.fromEntries(PAGES.map((p) => [p.name, []]))
for (let rep = 0; rep < reps; rep++) {
  const order = PAGES.map((_, i) => PAGES[(i + rep) % PAGES.length]!)
  for (const p of order) {
    const { page, errors } = await open(browser, scripts[p.script]!, `http://localhost:4188/?n=${n}&kind=${p.kind}`)
    const out: ReadonlyArray<Round> = await page.evaluate((k) => (globalThis as unknown as { __probe: { run: (rounds: number) => Promise<ReadonlyArray<Round>> } }).__probe.run(k), rounds)
    await page.close()
    if (errors.length > 0) throw new Error(`${p.name}: ${errors.join("; ")}`)
    cold[p.name]!.push(out[0]!)
    warm[p.name]!.push(Object.fromEntries(METRICS.map((m) => [m, quantile(out.slice(1).map((r) => r[m]), 0.5)])) as Round)
  }
  process.stderr.write(`rep ${rep + 1}/${reps}\r`)
}
await browser.close()

// 4. What it measured, and where.
const commit = sh("git", ["rev-parse", "--short", "HEAD"], REPO)
const dirty = sh("git", ["status", "--porcelain", "--", "packages"], REPO) !== ""
const os = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(readFileSync("/etc/os-release", "utf8"))?.[1] ?? "an unknown OS"
const machine = `${cpus()[0]?.model.trim() ?? "an unknown CPU"} (${cpus().length} threads) with ${Math.round(totalmem() / 2 ** 30)} GiB, on ${os} with Linux ${release().split("-")[0]}`
const date = new Date().toISOString().slice(0, 10)

/** A task's median across reps: each rep's task with the frames after it. */
const task = (set: Record<string, Array<Round>>, page: string, keys: ReadonlyArray<keyof Round>, digits: number): string =>
  quantile(set[page]!.map((r) => keys.reduce((sum, k) => sum + r[k], 0)), 0.5).toFixed(digits)
const ROWS: ReadonlyArray<readonly [label: string, set: Record<string, Array<Round>>, keys: ReadonlyArray<keyof Round>, digits: number]> = [
  ["Mount", warm, ["mount", "mountFrame", "mountFrame2"], 1],
  ["A page's first mount", cold, ["mount", "mountFrame", "mountFrame2"], 1],
  ["Retarget while running", warm, ["retarget", "retargetFrame", "retargetFrame2"], 1],
  ["Retarget at rest", warm, ["restRetarget", "restRetargetFrame", "restRetargetFrame2"], 1],
  ["Unmount", warm, ["unmount", "unmountFrame"], 1],
  ["A frame while animating", warm, ["flight"], 2],
]
const motionMinor = motionVersion.split(".").slice(0, 2).join(".")
console.log(`\nWhy Wardic's table (site/src/content/why.mdx):\n`)
console.log(`| ${n.toLocaleString("en")} elements, ms | Wardic, Solid 1 | Wardic, Solid 2 | Motion ${motionMinor} |`)
console.log("| --- | --- | --- | --- |")
for (const [label, set, keys, digits] of ROWS) console.log(`| ${label} | ${["wardic", "wardic-v2", "motion"].map((p) => task(set, p, keys, digits)).join(" | ")} |`)
const dirtyNote = ["", " with uncommitted changes to the packages"][Number(dirty)]
console.log(
  `\nMeasured on ${date}, Wardic's \`${commit}\`${dirtyNote} against Motion for React ${motionVersion} (\`framer-motion\`), in Chromium ${chromiumVersion}, on ${machine}: ${n.toLocaleString("en")} elements, each task timed with the two frames after it (an unmount with one), the median of ${reps} repetitions. A page's first mount is its first round.`,
)

for (const [label, set] of [["warm (the median of rounds 2+)", warm], ["cold (round 1)", cold]] as const) {
  console.log(`\n${label}: ms, the median across reps [p25 – p75]`)
  console.log("metric".padEnd(19) + PAGES.map((p) => p.name.padEnd(22)).join(""))
  for (const m of METRICS) {
    const cells = PAGES.map((p) => {
      const xs = set[p.name]!.map((r) => r[m])
      return `${quantile(xs, 0.5).toFixed(2)} [${quantile(xs, 0.25).toFixed(1)}–${quantile(xs, 0.75).toFixed(1)}]`.padEnd(22)
    })
    console.log(m.padEnd(19) + cells.join(""))
  }
}
const file = join(D, "dist", `results-${date}-${commit}.json`)
writeFileSync(file, JSON.stringify({ date, commit, dirty, motion: motionVersion, chromium: chromiumVersion, machine, n, rounds, reps, warm, cold }, null, 1))
console.log(`\nsaved ${file}`)
