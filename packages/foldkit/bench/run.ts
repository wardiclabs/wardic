/// <reference types="node" />
/**
 * `bun run bench:foldkit [--base <ref>] [--head <ref>] [--reps 11] [--n 1000] [--rounds 4] [--alloc-reps 3]`
 *
 * The Foldkit binding's start-cost bench (#795, ADR-0071 decision 38 and its *Amendment (#795)*, Q11,
 * Q12, Q27): `--head`'s core, dom and foldkit (default: the working tree) against `--base`'s (default:
 * `main`), at N `w.div`s in production Chromium, on `page.ts`. Each task is a Message's render and
 * patch, with the elements' Mounts: a mount, a mid-flight Retarget, an at-rest Retarget, a render that
 * changes nothing of Wardic's, and an unmount; the frame after the mount is reported, not gated.
 *
 * `bench:solid`'s rules, through `packages/solid/bench/paired.ts`:
 * - **Each side is built as an app ships it:** Vite, production mode, minified, for the browsers an app
 *   ships to by default, from that side's `packages/{core,dom,solid,foldkit}/src`, its bare imports
 *   resolved as `@wardic/foldkit` would in that side's dependencies (`foldkit` and `effect` among them).
 * - **Paired reps,** base and head back to back on fresh cross-origin isolated pages, in alternating
 *   order; `--rounds` rounds a page, the first cold, the median of the rest warm.
 * - **Noise control:** the `plain` page, `CONTROL_SCALE` × N `h.div`s binding the same Model, Foldkit
 *   without Wardic, the same code on both sides: off by more than ±5% and the run is too noisy to judge.
 * - **The floor** (#849, ADR-0071 *Refined at #849's grill*, Q6): the `mount` page, N of `plain`'s divs
 *   each with a trivial `OnMount`, Foldkit's own Mount under a `w.div`'s. Reported with each task's share,
 *   a `w.div` page's task over its rep's floor, and not gated. #849's target: the unmount's share no more
 *   than Solid 1's whole unmount of N (`bench:solid`).
 * - **Time gate,** warm only: a task fails when its median ratio passes +5% with its 25th percentile
 *   above 0. **Bytes gate:** `--alloc-reps` paired pages per side under V8's sampling heap profiler, what
 *   a side allocates per element per round, failing as a task does.
 *
 * Runs on the bench server, after `wardic-quiet`, not in CI. Exits 0 when every task passes, 1 when one
 * fails, and 2 when the run is too noisy.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "playwright"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { arg, buildPage, CONTROL_SCALE, failsGate, launch, median, NOISE, openPage as openBenchPage, orderOf, runRounds as runBenchRounds, sampled, spread, when } from "../../solid/bench/paired.ts"
import { commitHas, commitOf, depsOf, PACKAGES, REPO, sideResolver, sourcesInto } from "../../solid/bench/sides.ts"
import type { Round } from "./page.ts"

const BENCH = dirname(fileURLToPath(import.meta.url))
const OUT = join(REPO, ".tmp/bench-foldkit")

const base = arg("base", "main")
const headRef = arg("head", "")
const reps = Number(arg("reps", "11"))
const n = Number(arg("n", "1000"))
const rounds = Number(arg("rounds", "4"))
const allocReps = Number(arg("alloc-reps", "3"))

type Side = "base" | "head"
type Kind = "wardic" | "plain" | "mount"
/** The tasks gated, warm: `firstFrame` is reported. */
const TASKS = ["mount", "retarget", "restRetarget", "render", "unmount"] as const

/** Put a side's packages' `src` at `.tmp/bench-foldkit/<side>/packages`, from a commit or the working tree, with the page beside them. */
const fill = (side: Side, commit: string | undefined): string => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  sourcesInto(root, commit)
  cpSync(join(BENCH, "page.ts"), join(root, "page.ts"))
  return root
}

const bundle = async (side: Side, commit: string | undefined, deps: string): Promise<string> => {
  const root = fill(side, commit)
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(deps, "packages/foldkit/node_modules"), join(root, "node_modules"))
  return buildPage({ root, entry: "page.ts", plugins: [sideResolver(root, deps, "foldkit")], name: "benchFoldkit" })
}

const baseCommit = commitOf(base)
// A base from before the binding (#561) has no page to build: said here, not as an unresolved import later.
if (Bool.not(commitHas(baseCommit, "packages/foldkit/src"))) throw new Error(`bench:foldkit: ${base} (${baseCommit.slice(0, 7)}) has no packages/foldkit/src: a base from before @wardic/foldkit`)
const headCommit = Bool.match(headRef.length > 0, { onTrue: (): string | undefined => commitOf(headRef), onFalse: constUndefined })
const baseDeps = depsOf(baseCommit)
const headDeps = UndefinedOr.match(headCommit, { onUndefined: () => REPO, onDefined: depsOf })
const dirty =
  execSync(`git status --porcelain -- ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")}`, { cwd: REPO }).toString().trim().length > 0
const headLabel = UndefinedOr.match(headCommit, {
  onUndefined: () => `the working tree${when(dirty, " (modified)")}`,
  onDefined: (commit) => `${headRef} (${commit.slice(0, 7)})`,
})
const scripts: Record<Side, string> = {
  head: await bundle("head", headCommit, headDeps),
  base: await bundle("base", baseCommit, baseDeps),
}

const browser = await launch()
/** A page of `side`'s build for `kind`: its script loaded, and the errors it throws. */
const openPage = (side: Side, kind: Kind): Promise<{ readonly page: Page; readonly errors: Array<string> }> => {
  const elements = Bool.match(kind === "plain", { onTrue: () => n * CONTROL_SCALE, onFalse: () => n })
  return openBenchPage(browser, "bench:foldkit", scripts[side], `n=${elements}&kind=${kind}`)
}
const runRounds = (page: Page): Promise<ReadonlyArray<Round>> => runBenchRounds<Round>(page, rounds, "__wardicBenchFoldkit")

/** One page of `side`'s build: `rounds` rounds of `kind`. */
const runPage = async (side: Side, kind: Kind): Promise<ReadonlyArray<Round>> => {
  const { page, errors } = await openPage(side, kind)
  const out = await runRounds(page)
  await page.close()
  if (errors.length > 0) throw new Error(`bench:foldkit: ${side} ${kind}: ${errors.join("; ")}`)
  return out
}

/** What one `wardic` page of `side`'s build allocates over its rounds, in bytes per element per round. */
const allocatedPage = async (side: Side): Promise<number> => {
  const { page, errors } = await openPage(side, "wardic")
  const { bytes } = await sampled(page, () => runRounds(page))
  await page.close()
  if (errors.length > 0) throw new Error(`bench:foldkit: ${side} allocation: ${errors.join("; ")}`)
  return bytes / (rounds * n)
}

console.log(`bench:foldkit: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)
if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
console.log(`Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps, ${allocReps} for bytes\n`)

const emptySides = (): Record<Side, Array<ReadonlyArray<Round>>> => ({ base: [], head: [] })
const runs: Record<Kind, Record<Side, Array<ReadonlyArray<Round>>>> = { wardic: emptySides(), plain: emptySides(), mount: emptySides() }
for (let r = 0; r < reps; r++) {
  const order = orderOf(r)
  for (const side of order) runs.wardic[side].push(await runPage(side, "wardic"))
  for (const side of order) runs.plain[side].push(await runPage(side, "plain"))
  for (const side of order) runs.mount[side].push(await runPage(side, "mount"))
  process.stderr.write(`rep ${r + 1}/${reps}\r`)
}
const allocated: Record<Side, Array<number>> = { base: [], head: [] }
for (let r = 0; r < allocReps; r++) {
  for (const side of orderOf(r)) allocated[side].push(await allocatedPage(side))
  process.stderr.write(`bytes ${r + 1}/${allocReps}\r`)
}
await browser.close()

const warm = (page: ReadonlyArray<Round>, task: keyof Round): number => median(page.slice(1).map((round) => round[task]))
const cold = (page: ReadonlyArray<Round>, task: keyof Round): number => page[0]![task]
const total = (page: ReadonlyArray<Round>): number => TASKS.reduce((sum, task) => sum + warm(page, task), 0)

const controlRatios = runs.plain.head.map((page, r) => total(page) / total(runs.plain.base[r]!))
const control = median(controlRatios)
const noisy = Math.abs(control - 1) > NOISE
console.log(`control (${n * CONTROL_SCALE} plain divs on Foldkit, the five tasks, warm): ${spread(controlRatios)}${when(noisy, "  too noisy: rerun on a quiet host")}\n`)

let failed = false
const pages = runs.wardic
for (const [label, pick, gated] of [["warm", warm, true], ["cold", cold, false]] as const) {
  console.log(`${label} (ms, median across reps; head / base paired per rep: median [p25 – p75])${when(!gated, ", not gated")}`)
  console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  for (const task of [...TASKS, "firstFrame"] as const) {
    const ratios = pages.head.map((page, r) => pick(page, task) / pick(pages.base[r]!, task))
    const fails = Bool.and(gated, Bool.and(task !== "firstFrame", failsGate(ratios)))
    failed ||= fails
    console.log(
      `  ${task.padEnd(14)}${median(pages.base.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${median(pages.head.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${spread(ratios)}${when(fails, "  FAIL")}${when(Bool.and(gated, task === "firstFrame"), "  not gated")}`,
    )
  }
  console.log("")
}
// The plain page's own numbers: Foldkit's render and patch of plain divs, the baseline the Wardic page is read against. The
// page runs at CONTROL_SCALE × N, so its tasks can be timed (#318); per N elements, its numbers divide by that.
console.log(`plain (ms per ${n} elements, warm, median across reps; from ${n * CONTROL_SCALE} h.divs binding the Model, Foldkit alone; firstFrame as measured)`)
console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}head`)
for (const task of [...TASKS, "firstFrame"] as const) {
  const per = Bool.match(task === "firstFrame", { onTrue: () => 1, onFalse: () => CONTROL_SCALE })
  console.log(`  ${task.padEnd(14)}${(median(runs.plain.base.map((page) => warm(page, task))) / per).toFixed(2).padEnd(10)}${(median(runs.plain.head.map((page) => warm(page, task))) / per).toFixed(2)}`)
}
// The floor (#849): Foldkit's own Mount under N plain divs, and what a `w.div` page's task costs over its rep's floor.
const shareOf = (side: Side, task: keyof Round): number => median(runs.wardic[side].map((page, r) => warm(page, task) - warm(runs.mount[side][r]!, task)))
console.log(`\nmount floor (ms per ${n} elements, warm, median across reps; ${n} h.divs each with a trivial OnMount, Foldkit's own Mount; not gated)`)
console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}${"w.div over it: base".padEnd(22)}head`)
for (const task of [...TASKS, "firstFrame"] as const) {
  console.log(
    `  ${task.padEnd(14)}${median(runs.mount.base.map((page) => warm(page, task))).toFixed(2).padEnd(10)}` +
      `${median(runs.mount.head.map((page) => warm(page, task))).toFixed(2).padEnd(10)}` +
      `${shareOf("base", task).toFixed(2).padEnd(22)}${shareOf("head", task).toFixed(2)}`,
  )
}
console.log(`  #849's target: the unmount's share no more than Solid 1's whole unmount of ${n} (bench:solid's)`)
const allocRatios = allocated.head.map((b, r) => b / allocated.base[r]!)
const allocFails = failsGate(allocRatios)
failed ||= allocFails
console.log("\nallocated (KB per element per round, tasks and frames; head / base paired per rep: median [p25 – p75])")
console.log(`  ${"".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
console.log(`  ${"bytes".padEnd(14)}${(median(allocated.base) / 1024).toFixed(1).padEnd(10)}${(median(allocated.head) / 1024).toFixed(1).padEnd(10)}${spread(allocRatios)}${when(allocFails, "  FAIL")}`)

if (noisy) process.exit(2)
process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
