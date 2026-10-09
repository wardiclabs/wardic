/**
 * `bun run bench:core [--base <ref>] [--head <ref>] [--reps 11] [--engines bun,node,chromium] [--n 1000]`
 *
 * Core's frame bench (#63, ADR-0025): `--head`'s core (default: the working tree) against
 * `--base`'s (default: `main`), both through `harness.ts`, at N elements, in Bun, Node and
 * Chromium.
 *
 * - **Paired reps.** Each rep runs base and head back to back, in fresh processes or pages, in
 *   alternating order. The gate reads each workload's per-rep head / base ratios.
 * - **Noise control.** `ticksOnly` runs the same code in both cores. If its median ratio is off
 *   by more than ±3%, the run is too noisy to judge, and it's rerun.
 * - **Time gate.** A workload fails when its median ratio passes +5% and its 25th percentile is
 *   above 0%, so at least three pairs in four ran slower. Run against itself (`02ecce7`), a
 *   single Chromium pair swings ±17% and a workload's median ±7%, so the median alone would
 *   fail code that changed nothing.
 * - **Allocation gate.** Node's bytes per frame fail at +5%. On unchanged code they don't move.
 *   They count what a GC frees inside the measured window too (`one.mjs`), so a scavenge there
 *   doesn't hide allocation.
 * - `start` (construction) is reported, not gated.
 * - **A workload one side lacks** is reported, not gated (`rows.ts`, #74):
 *   - a Frame loop workload only head has (`springValues/loop`, against a base from before
 *     ADR-0027): head's ms against the base's figure for the same Primitive as one fiber per
 *     element, a comparison of the two models rather than of the two cores;
 *   - any other workload only head has: "new, not gated";
 *   - a workload only the base has: "dropped, not gated".
 * - **Each side on its own dependencies.** A commit whose `bun.lock` differs from the working
 *   tree's is checked out and installed at `.tmp/bench-core/deps/<commit>`, and bundled with
 *   that checkout's `harness.ts` and `node_modules`, so a dependency upgrade (#64's Effect bump)
 *   is measured across, not on the working tree's versions on both sides. There, `ticksOnly`
 *   runs the same core on two Effects, so its ratio is the upgrade's own cost plus noise.
 *
 * Exits 0 when every workload passes, 1 when one fails, and 2 when the run is too noisy.
 */
import { execSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import type { Options, WorkloadResult } from "./harness.ts"
import { rowsOf } from "./rows.ts"

const GATE = 1.05
const NOISE = 0.03
const BYTES_GATE = 1.05

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(BENCH, "../../..")
const OUT = join(REPO, ".tmp/bench-core")

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

const base = arg("base", "main")
const headRef = arg("head", "")
const reps = Number(arg("reps", "11"))
const engines = arg("engines", "bun,node,chromium").split(",")
const options: Options = { n: Number(arg("n", "1000")), warm: 5, frames: 30, rounds: 3 }

type Side = "base" | "head"
type Results = Record<string, WorkloadResult>

/**
 * Put a core's `src` at `.tmp/bench-core/<side>`, and bundle it with the harness and the
 * `node_modules` of `deps`: the repo, or a commit's own checkout.
 */
const bundle = (side: Side, fill: (src: string) => void, deps: string): string => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  const core = join(root, "packages/core")
  mkdirSync(core, { recursive: true })
  fill(join(core, "src"))
  symlinkSync(join(deps, "packages/core/node_modules"), join(core, "node_modules"))
  const entry = join(root, "entry.ts")
  writeFileSync(
    entry,
    [
      `import * as core from "./packages/core/src/index.ts"`,
      `import { register } from ${JSON.stringify(join(deps, "packages/core/bench/harness.ts"))}`,
      `register(core)`,
      ``,
    ].join("\n"),
  )
  const out = join(root, "bundle.js")
  const build = spawnSync("bun", ["build", entry, "--outfile", out, "--format=iife", "--minify", "--target=browser"])
  if (build.status !== 0) throw new Error(`bench:core: building ${side} failed\n${build.stderr}`)
  return out
}

const commitOf = (ref: string): string =>
  execSync(`git rev-parse --verify ${JSON.stringify(`${ref}^{commit}`)}`, { cwd: REPO }).toString().trim()

/** Fill a side's `src` from a commit. */
const fromCommit = (side: Side, commit: string) => (src: string) => {
  mkdirSync(dirname(src), { recursive: true })
  execSync(`git archive ${commit} packages/core/src | tar -x -C ${JSON.stringify(join(OUT, side))}`, { cwd: REPO })
}

const installedLock = readFileSync(join(REPO, "bun.lock"), "utf8")

/**
 * Where a commit's dependencies come from: the repo's own install when its `bun.lock` matches
 * the working tree's, or else a checkout of the commit at `.tmp/bench-core/deps/<commit>`,
 * installed from its lockfile (once; later runs reuse it).
 */
const depsOf = (commit: string): string => {
  const lock = execSync(`git show ${commit}:bun.lock`, { cwd: REPO, maxBuffer: 1 << 26 }).toString()
  if (lock === installedLock) return REPO
  const tree = join(OUT, "deps", commit)
  if (!existsSync(tree)) {
    execSync(`git worktree add --detach ${JSON.stringify(tree)} ${commit}`, { cwd: REPO, stdio: "ignore" })
  }
  if (!existsSync(join(tree, "node_modules"))) {
    console.log(`bench:core: ${commit.slice(0, 7)} has its own bun.lock, installing it at ${tree}`)
    execSync("bun install --frozen-lockfile", { cwd: tree, stdio: "ignore" })
  }
  if (!existsSync(join(tree, "packages/core/bench/harness.ts"))) {
    throw new Error(`bench:core: ${commit.slice(0, 7)} has its own bun.lock but no bench harness`)
  }
  return tree
}

const commit = commitOf(base)
const baseDeps = depsOf(commit)
const headCommit = headRef.length > 0
let head = `the working tree`
let fillHead = (src: string) => cpSync(join(REPO, "packages/core/src"), src, { recursive: true })
let headDeps = REPO
if (headCommit) {
  const resolved = commitOf(headRef)
  head = `${headRef} (${resolved.slice(0, 7)})`
  fillHead = fromCommit("head", resolved)
  headDeps = depsOf(resolved)
}
const bundles: Record<Side, string> = {
  base: bundle("base", fromCommit("base", commit), baseDeps),
  head: bundle("head", fillHead, headDeps),
}

const runProcess = (runtime: "bun" | "node", side: Side): Results => {
  const flags: Array<string> = []
  if (runtime === "node") flags.push("--expose-gc", "--max-semi-space-size=256")
  const run = spawnSync(runtime, [...flags, join(BENCH, "one.mjs"), bundles[side], JSON.stringify(options)], {
    maxBuffer: 1 << 24,
  })
  if (run.status !== 0) throw new Error(`bench:core: ${runtime} ${side} failed\n${run.stderr}`)
  return JSON.parse(run.stdout.toString()) as Results
}

/** A cross-origin isolated page on localhost (a secure context), for `performance.now()`'s 5 µs timer. */
const runChromium = async (browser: Awaited<ReturnType<typeof chromium.launch>>, side: Side): Promise<Results> => {
  const page = await browser.newPage()
  await page.route("http://localhost:4173/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>bench:core</title>",
      headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    }),
  )
  await page.goto("http://localhost:4173/")
  const isolated = await page.evaluate(() => (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated)
  if (!isolated) throw new Error("bench:core: page not cross-origin isolated")
  await page.addScriptTag({ content: readFileSync(bundles[side], "utf8") })
  const results = await page.evaluate(
    (o) => (globalThis as unknown as { __wardicBench: (o: Options) => Promise<Results> }).__wardicBench(o),
    options,
  )
  await page.close()
  return results
}

const quantile = (xs: ReadonlyArray<number>, p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!

const percent = (ratio: number): string => {
  const change = `${((ratio - 1) * 100).toFixed(1)}%`
  if (ratio < 1) return change
  return `+${change}`
}

/** Base first on even reps, head first on odd ones. */
const orderOf = (rep: number): ReadonlyArray<Side> => {
  if (rep % 2 === 0) return ["base", "head"]
  return ["head", "base"]
}

/**
 * A Frame loop workload only head runs (`springValues/loop`): head's ms and start, against the
 * base's same Primitive as one fiber per element (`fibers`, `springValues`), paired per rep. Not
 * gated.
 */
const reportOnly = (runs: Record<Side, Array<Results>>, workload: string, fibers: string): void => {
  const median = (side: Side, name: string, field: keyof WorkloadResult) =>
    quantile(runs[side].map((results) => Number(results[name]![field])), 0.5)
  const ratios = runs.head.map((head, r) => head[workload]!.frameMs / runs.base[r]![fibers]!.frameMs)
  let mb = ""
  if (!Number.isNaN(median("head", workload, "bytesPerFrame"))) {
    mb = `${(median("base", fibers, "bytesPerFrame") / 1e6).toFixed(2)} → ${(median("head", workload, "bytesPerFrame") / 1e6).toFixed(2)}`
  }
  console.log(
    `  ${workload.padEnd(22)}${median("base", fibers, "frameMs").toFixed(2).padEnd(10)}${median("head", workload, "frameMs").toFixed(2).padEnd(10)}` +
      `${`${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`.padEnd(28)}` +
      `${`${median("base", fibers, "startMs").toFixed(1)} → ${median("head", workload, "startMs").toFixed(1)}`.padEnd(18)}${mb.padEnd(16)}` +
      `report only: against base's ${fibers}`,
  )
}

const NONE = "—"

/** A workload only `side` runs (new on head, or dropped from it): that side's figures, no ratio, no gate. */
const oneSided = (runs: Record<Side, Array<Results>>, workload: string, side: Side, gate: string): void => {
  const median = (field: keyof WorkloadResult) =>
    quantile(runs[side].map((results) => Number(results[workload]![field])), 0.5)
  const ms: Record<Side, string> = { base: NONE, head: NONE }
  const start: Record<Side, string> = { base: NONE, head: NONE }
  const bytes: Record<Side, string> = { base: NONE, head: NONE }
  ms[side] = median("frameMs").toFixed(2)
  start[side] = median("startMs").toFixed(1)
  let mb = ""
  if (!Number.isNaN(median("bytesPerFrame"))) {
    bytes[side] = (median("bytesPerFrame") / 1e6).toFixed(2)
    mb = `${bytes.base} → ${bytes.head}`
  }
  console.log(
    `  ${workload.padEnd(22)}${ms.base.padEnd(10)}${ms.head.padEnd(10)}${"".padEnd(28)}` +
      `${`${start.base} → ${start.head}`.padEnd(18)}${mb.padEnd(16)}${gate}`,
  )
}

let failed = false
let noisy = false
const dirty = execSync("git status --porcelain -- packages/core/src", { cwd: REPO }).toString().trim().length > 0
if (!headCommit && dirty) head = "the working tree (modified)"
console.log(`bench:core: base ${base} (${commit.slice(0, 7)}) against ${head}`)
if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
console.log(`${options.n} elements, ${options.frames} frames × ${options.rounds - 1} rounds per run, ${reps} paired reps\n`)

for (const engine of engines) {
  const runs: Record<Side, Array<Results>> = { base: [], head: [] }
  let version: string
  if (engine === "chromium") {
    const browser = await chromium.launch()
    for (let r = 0; r < reps; r++) for (const side of orderOf(r)) runs[side].push(await runChromium(browser, side))
    version = browser.version()
    await browser.close()
  } else {
    for (let r = 0; r < reps; r++) for (const side of orderOf(r)) runs[side].push(runProcess(engine as "bun" | "node", side))
    version = spawnSync(engine, ["--version"]).stdout.toString().trim()
  }

  const ratioOf = (workload: string) =>
    runs.head.map((head, r) => head[workload]!.frameMs / runs.base[r]![workload]!.frameMs)
  const floor = quantile(ratioOf("ticksOnly"), 0.5)
  const engineNoisy = Math.abs(floor - 1) > NOISE
  noisy ||= engineNoisy

  let title = `${engine} ${version}`
  if (engineNoisy) title += `: TOO NOISY (ticksOnly ${percent(floor)}), rerun`
  console.log(title)
  console.log(
    `  ${"workload".padEnd(22)}${"base ms".padEnd(10)}${"head ms".padEnd(10)}${"head/base [p25–p75]".padEnd(28)}${"start ms".padEnd(18)}${"MB/frame".padEnd(16)}gate`,
  )
  for (const row of rowsOf(Object.keys(runs.base[0]!), Object.keys(runs.head[0]!))) {
    if (row.kind === "loop") {
      reportOnly(runs, row.workload, row.fibers)
      continue
    }
    if (row.kind === "new") {
      oneSided(runs, row.workload, "head", "new, not gated")
      continue
    }
    if (row.kind === "dropped") {
      oneSided(runs, row.workload, "base", "dropped, not gated")
      continue
    }
    const workload = row.workload
    const median = (side: Side, field: keyof WorkloadResult) =>
      quantile(runs[side].map((results) => Number(results[workload]![field])), 0.5)
    const ratios = ratioOf(workload)
    const ratio = quantile(ratios, 0.5)
    const slower = ratio > GATE && quantile(ratios, 0.25) > 1
    const bytesRatio = median("head", "bytesPerFrame") / median("base", "bytesPerFrame")
    const allocates = bytesRatio > BYTES_GATE
    const fails = workload !== "ticksOnly" && (slower || allocates)
    failed ||= fails && !engineNoisy
    let gate = "ok"
    if (workload === "ticksOnly") gate = "noise control"
    else if (slower && allocates) gate = `FAIL: time and bytes`
    else if (slower) gate = `FAIL: time (> ${percent(GATE)}, p25 > 0%)`
    else if (allocates) gate = `FAIL: bytes (${percent(bytesRatio)})`
    let mb = ""
    if (!Number.isNaN(median("base", "bytesPerFrame"))) {
      mb = `${(median("base", "bytesPerFrame") / 1e6).toFixed(2)} → ${(median("head", "bytesPerFrame") / 1e6).toFixed(2)}`
    }
    console.log(
      `  ${workload.padEnd(22)}${median("base", "frameMs").toFixed(2).padEnd(10)}${median("head", "frameMs").toFixed(2).padEnd(10)}` +
        `${`${percent(ratio)} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`.padEnd(28)}` +
        `${`${median("base", "startMs").toFixed(1)} → ${median("head", "startMs").toFixed(1)}`.padEnd(18)}${mb.padEnd(16)}${gate}`,
    )
  }
  console.log("")
}

if (noisy) process.exit(2)
if (failed) process.exit(1)
