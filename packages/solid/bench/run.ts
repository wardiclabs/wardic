/// <reference types="node" />
/**
 * `bun run bench:solid [--base <ref>] [--head <ref>] [--reps 11] [--n 1000] [--rounds 4] [--alloc-reps 3]`
 *
 * The binding's start-cost bench (#87, ADR-0040, decision 6): `--head`'s core, dom and solid
 * (default: the working tree) against `--base`'s (default: `main`), at N `wardic.div`s in
 * production Chromium, on `page.tsx`. It times a task's synchronous JS: a mount, a mid-flight
 * Retarget, an at-rest Retarget and an unmount. `bench:core` times the frames in between.
 *
 * - **Each side is built as an app ships it:** Vite and vite-plugin-solid, production mode,
 *   minified, from that side's `packages/{core,dom,solid}/src`. A bare import resolves as the
 *   importing package would, in that side's dependencies (`bench:core`'s rule: a commit whose
 *   `bun.lock` differs is checked out and installed at `.tmp/bench-core/deps/<commit>`).
 * - **Paired reps.** Each rep runs base and head back to back, each on a fresh cross-origin isolated
 *   page (`performance.now()` at 5 µs), in alternating order. A page runs `--rounds` rounds: the
 *   first is reported as cold, the median of the rest as warm.
 * - **Noise control.** The `plain` page, N plain `div`s on the same signal, is the same code on
 *   both sides. If its median ratio is off by more than ±5%, the run is too noisy to judge.
 * - **Time gate,** warm only: a task fails when its median ratio passes +5% and its 25th
 *   percentile is above 0%, so at least three pairs in four ran slower (`bench:core`'s gate). Cold
 *   is reported, not gated.
 * - **A full GC before each timed task** (ADR-0040, *Amendment (#69)*): Chromium runs with
 *   `--expose-gc`, and the page collects before it starts a task's clock, so a task times its own JS.
 *   Without it a task's time was bimodal, with a scavenge inside it or not, and a side's share of
 *   scavenges moved with where its allocation left the young generation, not with its cost.
 * - **Bytes gate:** `--alloc-reps` paired pages per side run the same rounds under V8's sampling
 *   heap profiler, objects freed by either GC counted: what a side allocates per element per round,
 *   its tasks and the frames between them together. It fails as a task does (+5% median, 25th
 *   percentile above 0), so what the GC per task leaves out of the times is still held.
 *
 * Runs on the bench server, after `wardic-quiet`, not in CI. Exits 0 when every task passes, 1
 * when one fails, and 2 when the run is too noisy.
 *
 * `--live` (#130, ADR-0043) runs `--head` alone, with no base: N elements following a Live value
 * each frame (`?kind=live`) against N plain divs whose style binds the same signal (`?kind=live-plain`),
 * paired per rep. It reports the mount, the set task and the frame after it (see `page.tsx`), and the
 * unmount, Wardic's against plain Solid's, ungated: a base before Live values can't run the page.
 *
 * `--v2` (#209, ADR-0045) runs `--head` alone too: the Solid 2 binding's page (`page-v2.tsx`, the
 * same N `wardic.div`s, built with Solid 2's compile) against the Solid 1 binding's, paired per rep.
 * It reports each task and the first frame after the mount, where every element's Starting-style
 * switch goes through the binding's `batch`, ungated.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Page } from "playwright"
import { build, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import * as Option from "effect/Option"
import { solid2 } from "../vite.solid2.ts"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import type { LiveRound, Round } from "./page.tsx"

const GATE = 1.05
const NOISE = 0.05
/** The heap profiler's mean sampling interval, in bytes: a page's rounds take about 170,000 samples. */
const ALLOC_INTERVAL = 4096
const PACKAGES = ["core", "dom", "solid"] as const

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(BENCH, "../../..")
const OUT = join(REPO, ".tmp/bench-solid")

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

const base = arg("base", "main")
const headRef = arg("head", "")
const reps = Number(arg("reps", "11"))
const n = Number(arg("n", "1000"))
const rounds = Number(arg("rounds", "4"))
const allocReps = Number(arg("alloc-reps", "3"))
const liveMode = process.argv.includes("--live")
const v2Mode = process.argv.includes("--v2")

type Side = "base" | "head" | "v2"
type Kind = "wardic" | "plain" | "live" | "live-plain"
const TASKS = ["mount", "retarget", "restRetarget", "unmount"] as const

const commitOf = (ref: string): string =>
  execSync(`git rev-parse --verify ${JSON.stringify(`${ref}^{commit}`)}`, { cwd: REPO }).toString().trim()

const installedLock = readFileSync(join(REPO, "bun.lock"), "utf8")

/** Where a commit's dependencies come from: the repo's own install, or `bench:core`'s checkout of it. */
const depsOf = (commit: string): string => {
  const lock = execSync(`git show ${commit}:bun.lock`, { cwd: REPO, maxBuffer: 1 << 26 }).toString()
  if (lock === installedLock) return REPO
  const tree = join(REPO, ".tmp/bench-core/deps", commit)
  if (!existsSync(tree)) {
    execSync(`git worktree add --detach ${JSON.stringify(tree)} ${commit}`, { cwd: REPO, stdio: "ignore" })
  }
  if (!existsSync(join(tree, "node_modules"))) {
    console.log(`bench:solid: ${commit.slice(0, 7)} has its own bun.lock, installing it at ${tree}`)
    execSync("bun install --frozen-lockfile", { cwd: tree, stdio: "ignore" })
  }
  return tree
}

/** Put a side's three packages' `src` at `.tmp/bench-solid/<side>/packages`: from a commit, or the working tree. */
const fill = (side: Side, commit: string | undefined): string => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  if (commit === undefined) {
    for (const pkg of PACKAGES) cpSync(join(REPO, "packages", pkg, "src"), join(root, "packages", pkg, "src"), { recursive: true })
  } else {
    execSync(`git archive ${commit} ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")} | tar -x -C ${JSON.stringify(root)}`, { cwd: REPO })
  }
  cpSync(join(BENCH, "page.tsx"), join(root, "page.tsx"))
  cpSync(join(BENCH, "page-v2.tsx"), join(root, "page-v2.tsx"))
  return root
}

/** A `@wardic/*` subpath that's a folder, not a module: its index. */
const SUBPATHS: Readonly<Record<string, string>> = { "unstable/v2": "unstable/v2/index.ts" }

/**
 * Resolve `@wardic/*` to the side's sources, and every other bare import as the importing package
 * would in `deps` (the page as solid): one copy of solid-js and effect per side.
 */
const sideResolver = (root: string, deps: string): Plugin => ({
  name: "bench-solid-resolve",
  enforce: "pre",
  async resolveId(source, importer, options) {
    const wardic = /^@wardic\/(core|dom|solid)(?:\/(.+))?$/.exec(source)
    if (wardic !== null) {
      const [, pkg, sub] = wardic
      return join(
        root,
        "packages",
        pkg!,
        "src",
        UndefinedOr.match(sub, {
          onUndefined: () => "index.ts",
          onDefined: (name) => Option.getOrElse(Option.fromUndefinedOr(SUBPATHS[name]), () => `${name}.ts`),
        }),
      )
    }
    if (importer === undefined || !importer.startsWith(root)) return null
    if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null
    const pkg = /\/packages\/(core|dom|solid)\/src\//.exec(importer)?.[1] ?? "solid"
    return this.resolve(source, join(deps, "packages", pkg, "src/index.ts"), { ...options, skipSelf: true })
  },
})

const bundle = async (side: Side, commit: string | undefined, deps: string): Promise<string> => {
  const root = fill(side, commit)
  // vite-plugin-solid's Babel reads the JSX import source from a package's own node_modules.
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(deps, "packages/solid/node_modules"), join(root, "node_modules"))
  // The Solid 2 page builds with Solid 2's compile, without its dev checks, as an app ships it.
  const v2 = side === "v2"
  await build({
    configFile: false,
    logLevel: "warn",
    mode: "production",
    root,
    plugins: [sideResolver(root, deps), Bool.match(v2, { onTrue: () => solid2({ dev: false }), onFalse: () => solid() })],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      minify: true,
      lib: {
        entry: join(root, Bool.match(v2, { onTrue: () => "page-v2.tsx", onFalse: () => "page.tsx" })),
        formats: ["iife"],
        name: "benchSolid",
        fileName: () => "page.js",
      },
    },
  })
  return readFileSync(join(root, "dist/page.js"), "utf8")
}

const quantile = (xs: ReadonlyArray<number>, p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!
const median = (xs: ReadonlyArray<number>): number => quantile(xs, 0.5)
/** `text` when `cond` holds, else nothing: a report line's optional part. */
const when = (cond: boolean, text: string): string => Bool.match(cond, { onTrue: () => text, onFalse: () => "" })
const percent = (ratio: number): string => `${when(ratio >= 1, "+")}${((ratio - 1) * 100).toFixed(1)}%`

const baseCommit = commitOf(base)
const headCommit = Bool.match(headRef.length > 0, { onTrue: (): string | undefined => commitOf(headRef), onFalse: constUndefined })
const baseDeps = depsOf(baseCommit)
const headDeps = UndefinedOr.match(headCommit, { onUndefined: () => REPO, onDefined: depsOf })
const dirty =
  execSync(`git status --porcelain -- ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")}`, { cwd: REPO }).toString().trim().length > 0
const headLabel = UndefinedOr.match(headCommit, {
  onUndefined: () => `the working tree${when(dirty, " (modified)")}`,
  onDefined: (commit) => `${headRef} (${commit.slice(0, 7)})`,
})
const headScript = await bundle("head", headCommit, headDeps)
// `--live` and `--v2` run the head alone: their pages can't run on a base before them.
const baseScript = await Bool.match(Bool.or(liveMode, v2Mode), { onTrue: () => Promise.resolve(headScript), onFalse: () => bundle("base", baseCommit, baseDeps) })
const v2Script = await Bool.match(v2Mode, { onTrue: () => bundle("v2", headCommit, headDeps), onFalse: () => Promise.resolve("") })
const scripts: Record<Side, string> = { base: baseScript, head: headScript, v2: v2Script }

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] })
/** A page of `side`'s build for `kind`, its script loaded, and the errors it throws. */
const openPage = async (side: Side, kind: Kind): Promise<{ readonly page: Page; readonly errors: Array<string> }> => {
  const page = await browser.newPage()
  const errors: Array<string> = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.route("http://localhost:4174/**", (route) => {
    if (new URL(route.request().url()).pathname === "/page.js") {
      // culori's identifiers aren't ASCII: the script is UTF-8.
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: scripts[side] })
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>bench:solid</title><body></body>",
      headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    })
  })
  await page.goto(`http://localhost:4174/?n=${n}&kind=${kind}`)
  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("bench:solid: page not cross-origin isolated")
  await page.addScriptTag({ url: "http://localhost:4174/page.js" })
  return { page, errors }
}

/** The page's `rounds` rounds. */
const runRounds = (page: Page): Promise<ReadonlyArray<Round>> =>
  page.evaluate((k) => (globalThis as unknown as { __wardicBenchSolid: (k: number) => Promise<ReadonlyArray<Round>> }).__wardicBenchSolid(k), rounds)

/** One page of `side`'s build: `rounds` rounds of `kind`. */
const runPage = async (side: Side, kind: Kind): Promise<ReadonlyArray<Round>> => {
  const { page, errors } = await openPage(side, kind)
  const out = await runRounds(page)
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} ${kind}: ${errors.join("; ")}`)
  return out
}

/** A heap profile's node: what was allocated in its function, and its callees. */
interface HeapNode {
  readonly selfSize: number
  readonly children: ReadonlyArray<HeapNode>
}
const bytesOf = (node: HeapNode): number => node.children.reduce((sum, child) => sum + bytesOf(child), node.selfSize)

/** What one `wardic` page of `side`'s build allocates over its rounds, in bytes per element per round. */
const allocatedPage = async (side: Side): Promise<number> => {
  const { page, errors } = await openPage(side, "wardic")
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: ALLOC_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  })
  await runRounds(page)
  const { profile } = await cdp.send("HeapProfiler.stopSampling")
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} allocation: ${errors.join("; ")}`)
  return bytesOf(profile.head as HeapNode) / (rounds * n)
}

if (liveMode) {
  // Head alone: Wardic's Live values against plain Solid binding the same signal, paired per rep.
  console.log(`bench:solid --live: ${headLabel}, Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`)
  const LIVE_TASKS = ["mount", "set", "frame", "unmount"] as const
  const pagesOf: Record<"live" | "live-plain", Array<ReadonlyArray<LiveRound>>> = { live: [], "live-plain": [] }
  for (let r = 0; r < reps; r++) {
    const order: ReadonlyArray<"live" | "live-plain"> = Bool.match(r % 2 === 0, {
      onTrue: (): ReadonlyArray<"live" | "live-plain"> => ["live", "live-plain"],
      onFalse: (): ReadonlyArray<"live" | "live-plain"> => ["live-plain", "live"],
    })
    for (const kind of order) pagesOf[kind].push((await runPage("head", kind)) as unknown as ReadonlyArray<LiveRound>)
    process.stderr.write(`rep ${r + 1}/${reps}\r`)
  }
  await browser.close()
  const warmOf = (page: ReadonlyArray<LiveRound>, task: (typeof LIVE_TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
  console.log(`warm (ms, median across reps; wardic / plain paired per rep: median [p25 – p75])`)
  console.log(`  ${"task".padEnd(10)}${"plain".padEnd(10)}${"wardic".padEnd(10)}ratio`)
  for (const task of LIVE_TASKS) {
    const ratios = pagesOf.live.map((page, r) => warmOf(page, task) / warmOf(pagesOf["live-plain"][r]!, task))
    console.log(
      `  ${task.padEnd(10)}${median(pagesOf["live-plain"].map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${median(pagesOf.live.map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`,
    )
  }
  process.exit(0)
}

if (v2Mode) {
  // Head alone: the Solid 2 binding's page against the Solid 1 binding's, paired per rep.
  console.log(`bench:solid --v2: ${headLabel}, Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`)
  const V2_TASKS = ["mount", "firstFrame", "retarget", "restRetarget", "unmount"] as const
  const pagesOf: Record<"head" | "v2", Array<ReadonlyArray<Round>>> = { head: [], v2: [] }
  for (let r = 0; r < reps; r++) {
    const order: ReadonlyArray<"head" | "v2"> = Bool.match(r % 2 === 0, {
      onTrue: (): ReadonlyArray<"head" | "v2"> => ["head", "v2"],
      onFalse: (): ReadonlyArray<"head" | "v2"> => ["v2", "head"],
    })
    for (const side of order) pagesOf[side].push(await runPage(side, "wardic"))
    process.stderr.write(`rep ${r + 1}/${reps}\r`)
  }
  await browser.close()
  const warmOf = (page: ReadonlyArray<Round>, task: (typeof V2_TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
  console.log(`warm (ms, median across reps; Solid 2 / Solid 1 paired per rep: median [p25 – p75])`)
  console.log(`  ${"task".padEnd(14)}${"solid 1".padEnd(10)}${"solid 2".padEnd(10)}ratio`)
  for (const task of V2_TASKS) {
    const ratios = pagesOf.v2.map((page, r) => warmOf(page, task) / warmOf(pagesOf.head[r]!, task))
    console.log(
      `  ${task.padEnd(14)}${median(pagesOf.head.map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${median(pagesOf.v2.map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`,
    )
  }
  process.exit(0)
}

console.log(`bench:solid: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)
if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
console.log(`Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps, ${allocReps} for bytes\n`)

/** Rep `r`'s order: base first on even reps, head first on odd ones. */
const orderOf = (r: number): ReadonlyArray<"base" | "head"> => {
  if (r % 2 === 0) return ["base", "head"]
  return ["head", "base"]
}
const runs: Record<"wardic" | "plain", Record<"base" | "head", Array<ReadonlyArray<Round>>>> = { wardic: { base: [], head: [] }, plain: { base: [], head: [] } }
for (let r = 0; r < reps; r++) {
  const order = orderOf(r)
  for (const kind of ["wardic", "plain"] as const) for (const side of order) runs[kind][side].push(await runPage(side, kind))
  process.stderr.write(`rep ${r + 1}/${reps}\r`)
}
const allocated: Record<"base" | "head", Array<number>> = { base: [], head: [] }
for (let r = 0; r < allocReps; r++) {
  const order = orderOf(r)
  for (const side of order) allocated[side].push(await allocatedPage(side))
  process.stderr.write(`bytes ${r + 1}/${allocReps}\r`)
}
await browser.close()

const warm = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
const cold = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => page[0]![task]
const total = (page: ReadonlyArray<Round>): number => TASKS.reduce((sum, task) => sum + warm(page, task), 0)

const controlRatios = runs.plain.head.map((page, r) => total(page) / total(runs.plain.base[r]!))
const control = median(controlRatios)
const noisy = Math.abs(control - 1) > NOISE
console.log(`control (plain divs, all four tasks, warm): ${percent(control)} [${percent(quantile(controlRatios, 0.25))} – ${percent(quantile(controlRatios, 0.75))}]${when(noisy, "  too noisy: rerun on a quiet host")}\n`)

let failed = false
for (const [label, pick, gated] of [["warm", warm, true], ["cold", cold, false]] as const) {
  console.log(`${label} (ms, median across reps; head / base paired per rep: median [p25 – p75])${when(!gated, ", not gated")}`)
  console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  for (const task of TASKS) {
    const ratios = runs.wardic.head.map((page, r) => pick(page, task) / pick(runs.wardic.base[r]!, task))
    const fails = gated && quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
    failed ||= fails
    console.log(
      `  ${task.padEnd(14)}${median(runs.wardic.base.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${median(runs.wardic.head.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${when(fails, "  FAIL")}`,
    )
  }
  console.log("")
}

const allocRatios = allocated.head.map((bytes, r) => bytes / allocated.base[r]!)
const allocFails = quantile(allocRatios, 0.5) > GATE && quantile(allocRatios, 0.25) > 1
failed ||= allocFails
console.log("allocated (KB per element per round, tasks and frames; head / base paired per rep: median [p25 – p75])")
console.log(`  ${"".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
console.log(
  `  ${"bytes".padEnd(14)}${(median(allocated.base) / 1024).toFixed(1).padEnd(10)}${(median(allocated.head) / 1024).toFixed(1).padEnd(10)}` +
    `${percent(quantile(allocRatios, 0.5))} [${percent(quantile(allocRatios, 0.25))} – ${percent(quantile(allocRatios, 0.75))}]${when(allocFails, "  FAIL")}\n`,
)

if (noisy) process.exit(2)
process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
