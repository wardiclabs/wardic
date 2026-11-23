/**
 * The frame benches' driver, `bench:core`'s and `bench:three`'s: `run(bench)` takes `--base <ref>`,
 * `--head <ref>`, `--reps 11`, `--engines` and `--n 1000` from the command line.
 *
 * A bench's frame code from `--head` (default: the working tree) against `--base`'s (default: `main`),
 * both through its harness, at N elements, in Bun, Node and Chromium (a bench's own default engines).
 * Each side is the bench's packages' `src` and `package.json` at its ref, its `@wardic/*` imports its
 * own (#883's PR 5b: `bench:three` is core's, object's and three's; since #885's PR 6, dom's and solid's
 * too, for its Solid hooks' workloads).
 *
 * - **Paired reps.** Each rep runs base and head back to back, in fresh processes or pages, in
 *   alternating order. The gate reads each workload's per-rep head / base ratios.
 * - **Noise control.** A workload that runs the same code on both sides: core's `ticksOnly`, three's
 *   `three/matrices`. If its median ratio is off by more than ±3%, the engine's run is too noisy to
 *   judge, and its reps run once more (#545). An engine still noisy then makes the run exit 2.
 * - **Time gate.** A workload fails when its median ratio passes +5% and its 25th percentile is
 *   above 0%, so at least three pairs in four ran slower. Run against itself (`02ecce7`), a
 *   single Chromium pair swings ±17% and a workload's median ±7%, so the median alone would
 *   fail code that changed nothing.
 * - **Allocation gate.** Node's bytes per frame fail at +5%. On unchanged code they don't move.
 *   They count what a GC frees inside the measured window too (`one.mjs`), so a scavenge there
 *   doesn't hide allocation.
 * - **A rerun before failing** (#545). An engine with a failing workload runs its reps again, and a
 *   workload fails only when it fails both runs. Run against itself at 21 reps, Bun's loop
 *   workloads spread about ten points between their quartiles, and after a change elsewhere in
 *   core JavaScriptCore moved them −10% to +39% with the frame code unchanged (#542).
 * - **The loop's two tiniest workloads run ten times N** (`scale`, #545): `chase/loop` and
 *   `springValues/loop`, under 0.1 ms a frame at N, spread 25–29 points on Bun and Chromium. A
 *   workload the two sides timed at different counts (a base on its own older harness) is
 *   reported, not gated.
 * - `start` (construction) is reported, not gated.
 * - **A workload one side lacks** is reported, not gated (`rows.ts`, #74):
 *   - a Frame loop workload only head has (`springValues/loop`, against a base from before
 *     ADR-0027): head's ms against the base's figure for the same Primitive as one fiber per
 *     element, a comparison of the two models rather than of the two cores;
 *   - any other workload only head has: "new, not gated";
 *   - a workload only the base has: "dropped, not gated".
 * - **Each side on its own dependencies.** A commit whose `bun.lock` differs from the working
 *   tree's is checked out and installed at `.tmp/<bench>/deps/<commit>`, and bundled with
 *   that checkout's harness and `node_modules`, so a dependency upgrade (#64's Effect bump)
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
import { confirmed, rowsOf, runsOf } from "./rows.ts"

const GATE = 1.05
const NOISE = 0.03
const BYTES_GATE = 1.05

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(BENCH, "../../..")

/** A frame bench the driver runs: its name, its packages, its harness and its noise control. */
export interface Bench {
  /** Its script's name, in its messages: `bench:core`. */
  readonly name: string
  /** Its work folder under `.tmp/`: `bench-core`. */
  readonly folder: string
  /** The packages each side is made of, in `packages/`: their `src` and `package.json`. The last one's `index.ts` is registered. */
  readonly packages: ReadonlyArray<string>
  /** Its harness, from the repo's root: what registers `__wardicBench`, given the last package's module. */
  readonly harness: string
  /**
   * More of a side's modules its harness is given, by name, each a path in the side's `packages/`:
   * `{ stage: "three/src/solid.ts" }`. A side without one gives none, and its workloads report as new.
   */
  readonly modules?: Readonly<Record<string, string>>
  /** Readies a side's copy, at `root`, before Bun bundles it: three's Solid 2 compile of `@wardic/solid`'s `.tsx`. */
  readonly prepare?: (root: string) => void
  /**
   * More of `bun build`'s arguments for each side: three's `--production`, since Bun's bundler resolves
   * the `development` export condition unless told it's building for production.
   */
  readonly build?: ReadonlyArray<string>
  /** The workload that runs the same code on both sides. */
  readonly noise: string
  /** Its engines when `--engines` gives none. */
  readonly engines: string
  /** What N counts, after the number, in its heading. */
  readonly counts: string
}

type Side = "base" | "head"
type Results = Record<string, WorkloadResult>

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

/** Runs `bench`, head against base: exits 0 when every workload passes, 1 when one fails, 2 when too noisy. */
export const run = async (bench: Bench): Promise<never> => {
  const OUT = join(REPO, ".tmp", bench.folder)
  const base = arg("base", "main")
  const headRef = arg("head", "")
  const reps = Number(arg("reps", "11"))
  const engines = arg("engines", bench.engines).split(",")
  const options: Options = { n: Number(arg("n", "1000")), warm: 5, frames: 30, rounds: 3 }
  const main = bench.packages[bench.packages.length - 1]!

  /**
   * Put a side's packages at `.tmp/<bench>/<side>`, each its `src` and `package.json` and its
   * `node_modules`' links, copied as links: relative, so a package's `@wardic/*` are the side's own,
   * and its other dependencies `deps`' (the repo's, or a commit's own checkout's). Then bundle them with
   * the harness.
   */
  const bundle = (side: Side, fill: (root: string) => void, deps: string): string => {
    const root = join(OUT, side)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })
    fill(root)
    symlinkSync(join(deps, "node_modules"), join(root, "node_modules"))
    for (const name of bench.packages) {
      const modules = join(root, "packages", name, "node_modules")
      cpSync(join(deps, "packages", name, "node_modules"), modules, { recursive: true, verbatimSymlinks: true })
      // A package's imports of itself (`@wardic/three/internal/dev`): the side's own.
      mkdirSync(join(modules, "@wardic"), { recursive: true })
      if (!existsSync(join(modules, "@wardic", name))) symlinkSync(join("..", ".."), join(modules, "@wardic", name))
    }
    if (bench.prepare !== undefined) bench.prepare(root)
    const given = Object.entries(bench.modules ?? {}).filter(([, path]) => existsSync(join(root, "packages", path)))
    const entry = join(root, "entry.ts")
    writeFileSync(
      entry,
      [
        `import * as subject from "./packages/${main}/src/index.ts"`,
        ...given.map(([name, path]) => `import * as ${name} from ${JSON.stringify(`./packages/${path}`)}`),
        `import { register } from ${JSON.stringify(join(deps, bench.harness))}`,
        `register(subject, { ${given.map(([name]) => name).join(", ")} })`,
        ``,
      ].join("\n"),
    )
    const out = join(root, "bundle.js")
    const build = spawnSync("bun", ["build", entry, "--outfile", out, "--format=iife", "--minify", "--target=browser", "--conditions=@wardic/source", ...(bench.build ?? [])])
    if (build.status !== 0) throw new Error(`${bench.name}: building ${side} failed\n${build.stderr}`)
    return out
  }

  const commitOf = (ref: string): string =>
    execSync(`git rev-parse --verify ${JSON.stringify(`${ref}^{commit}`)}`, { cwd: REPO }).toString().trim()

  /** The paths of a side's packages a commit or the working tree gives: each one's `src` and `package.json`. */
  const sources = bench.packages.flatMap((name) => [`packages/${name}/src`, `packages/${name}/package.json`])

  /** Fill a side from a commit. */
  const fromCommit = (commit: string) => (root: string) => {
    execSync(`git archive ${commit} ${sources.join(" ")} | tar -x -C ${JSON.stringify(root)}`, { cwd: REPO })
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
      console.log(`${bench.name}: ${commit.slice(0, 7)} has its own bun.lock, installing it at ${tree}`)
      execSync("bun install --frozen-lockfile", { cwd: tree, stdio: "ignore" })
    }
    if (!existsSync(join(tree, bench.harness))) {
      throw new Error(`${bench.name}: ${commit.slice(0, 7)} has its own bun.lock but no bench harness`)
    }
    return tree
  }

  const commit = commitOf(base)
  const baseDeps = depsOf(commit)
  const headCommit = headRef.length > 0
  let head = `the working tree`
  let fillHead = (root: string) => {
    for (const path of sources) cpSync(join(REPO, path), join(root, path), { recursive: true })
  }
  let headDeps = REPO
  if (headCommit) {
    const resolved = commitOf(headRef)
    head = `${headRef} (${resolved.slice(0, 7)})`
    fillHead = fromCommit(resolved)
    headDeps = depsOf(resolved)
  }
  const bundles: Record<Side, string> = {
    base: bundle("base", fromCommit(commit), baseDeps),
    head: bundle("head", fillHead, headDeps),
  }

  const runProcess = (runtime: "bun" | "node", side: Side): Results => {
    const flags: Array<string> = []
    if (runtime === "node") flags.push("--expose-gc", "--max-semi-space-size=256")
    const run = spawnSync(runtime, [...flags, join(BENCH, "one.mjs"), bundles[side], JSON.stringify(options)], {
      maxBuffer: 1 << 24,
    })
    if (run.status !== 0) throw new Error(`${bench.name}: ${runtime} ${side} failed\n${run.stderr}`)
    return JSON.parse(run.stdout.toString()) as Results
  }

  /** A cross-origin isolated page on localhost (a secure context), for `performance.now()`'s 5 µs timer. */
  const runChromium = async (browser: Awaited<ReturnType<typeof chromium.launch>>, side: Side): Promise<Results> => {
    const page = await browser.newPage()
    await page.route("http://localhost:4173/", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>${bench.name}</title>`,
        headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
      }),
    )
    await page.goto("http://localhost:4173/")
    const isolated = await page.evaluate(() => (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated)
    if (!isolated) throw new Error(`${bench.name}: page not cross-origin isolated`)
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
      `  ${workload.padEnd(24)}${median("base", fibers, "frameMs").toFixed(2).padEnd(10)}${median("head", workload, "frameMs").toFixed(2).padEnd(10)}` +
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
      `  ${workload.padEnd(24)}${ms.base.padEnd(10)}${ms.head.padEnd(10)}${"".padEnd(28)}` +
        `${`${start.base} → ${start.head}`.padEnd(18)}${mb.padEnd(16)}${gate}`,
    )
  }

  let failed = false
  let noisy = false
  const dirty = execSync(`git status --porcelain -- ${sources.join(" ")}`, { cwd: REPO }).toString().trim().length > 0
  if (!headCommit && dirty) head = "the working tree (modified)"
  console.log(`${bench.name}: base ${base} (${commit.slice(0, 7)}) against ${head}`)
  if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
  if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
  console.log(
    `${options.n} ${bench.counts}, ${options.frames} frames × ${options.rounds - 1} rounds per run, ${reps} paired reps\n`,
  )

  /** Every rep of `engine`, base and head paired, and its version. */
  const runEngine = async (engine: string): Promise<{ readonly runs: Record<Side, Array<Results>>; readonly version: string }> => {
    const runs: Record<Side, Array<Results>> = { base: [], head: [] }
    if (engine === "chromium") {
      const browser = await chromium.launch()
      for (let r = 0; r < reps; r++) for (const side of orderOf(r)) runs[side].push(await runChromium(browser, side))
      const version = browser.version()
      await browser.close()
      return { runs, version }
    }
    for (let r = 0; r < reps; r++) for (const side of orderOf(r)) runs[side].push(runProcess(engine as "bun" | "node", side))
    return { runs, version: spawnSync(engine, ["--version"]).stdout.toString().trim() }
  }

  /** One run's table, printed under `title`: whether its noise control was off, and the workloads that failed. */
  const report = (
    title: string,
    runs: Record<Side, Array<Results>>,
  ): { readonly noisy: boolean; readonly failing: ReadonlySet<string> } => {
    const failing = new Set<string>()
    const ratioOf = (workload: string) =>
      runs.head.map((head, r) => head[workload]!.frameMs / runs.base[r]![workload]!.frameMs)
    const floor = quantile(ratioOf(bench.noise), 0.5)
    const engineNoisy = Math.abs(floor - 1) > NOISE

    let heading = title
    if (engineNoisy) heading += `: TOO NOISY (${bench.noise} ${percent(floor)}), rerun`
    console.log(heading)
    console.log(
      `  ${"workload".padEnd(24)}${"base ms".padEnd(10)}${"head ms".padEnd(10)}${"head/base [p25–p75]".padEnd(28)}${"start ms".padEnd(18)}${"MB/frame".padEnd(16)}gate`,
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
      // Timed at different run counts (#545: a base on its own harness from before), so not compared.
      const baseRuns = runsOf(runs.base[0]![workload]!, options.n)
      const headRuns = runsOf(runs.head[0]![workload]!, options.n)
      const comparable = baseRuns === headRuns
      const fails = comparable && workload !== bench.noise && (slower || allocates)
      if (fails) failing.add(workload)
      let gate = "ok"
      if (workload === bench.noise) gate = "noise control"
      else if (!comparable) gate = `${baseRuns} → ${headRuns} runs, not gated`
      else if (slower && allocates) gate = `FAIL: time and bytes`
      else if (slower) gate = `FAIL: time (> ${percent(GATE)}, p25 > 0%)`
      else if (allocates) gate = `FAIL: bytes (${percent(bytesRatio)})`
      let mb = ""
      if (!Number.isNaN(median("base", "bytesPerFrame"))) {
        mb = `${(median("base", "bytesPerFrame") / 1e6).toFixed(2)} → ${(median("head", "bytesPerFrame") / 1e6).toFixed(2)}`
      }
      console.log(
        `  ${workload.padEnd(24)}${median("base", "frameMs").toFixed(2).padEnd(10)}${median("head", "frameMs").toFixed(2).padEnd(10)}` +
          `${`${percent(ratio)} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`.padEnd(28)}` +
          `${`${median("base", "startMs").toFixed(1)} → ${median("head", "startMs").toFixed(1)}`.padEnd(18)}${mb.padEnd(16)}${gate}`,
      )
    }
    console.log("")
    return { noisy: engineNoisy, failing }
  }

  for (const engine of engines) {
    let first = await runEngine(engine)
    let judged = report(`${engine} ${first.version}`, first.runs)
    // A noisy engine runs once more (#545), and that run is judged as its first.
    if (judged.noisy) {
      console.log(`${engine}: too noisy; running its ${reps} reps again\n`)
      first = await runEngine(engine)
      judged = report(`${engine} ${first.version}, rerun`, first.runs)
    }
    noisy ||= judged.noisy
    if (judged.noisy || judged.failing.size === 0) continue
    // A rerun before failing (#545): run against itself, Bun's loop workloads spread about ten points
    // at their quartiles, so a single run fails code that changed nothing. A workload fails when it
    // fails both runs.
    console.log(`${engine}: ${[...judged.failing].join(", ")} failed; running its ${reps} reps again\n`)
    const again = await runEngine(engine)
    const rerun = report(`${engine} ${again.version}, rerun`, again.runs)
    noisy ||= rerun.noisy
    const fails = confirmed(judged.failing, rerun.failing)
    const passed = [...judged.failing].filter((workload) => !fails.includes(workload))
    if (passed.length > 0) console.log(`${engine}: passed on its rerun: ${passed.join(", ")}`)
    if (fails.length > 0) console.log(`${engine}: FAIL in both runs: ${fails.join(", ")}`)
    console.log("")
    failed ||= fails.length > 0 && !rerun.noisy
  }

  if (noisy) process.exit(2)
  if (failed) process.exit(1)
  process.exit(0)
}
