/// <reference types="node" />
/**
 * `bun run bench:solid [--base <ref>] [--head <ref>] [--binding 1|2] [--reps 11] [--n 1000] [--rounds 4] [--alloc-reps 3] [--retained-reps 3]`
 *
 * The bindings' start-cost bench (#87, ADR-0040, decision 6): `--head`'s core, dom and solid
 * (default: the working tree) against `--base`'s (default: `main`), at N `wardic.div`s in
 * production Chromium, on `page.tsx` (the Solid 1 binding) and `page-v2.tsx` (the Solid 2 binding,
 * `@wardic/solid/unstable/v2`, #259). It times a task's synchronous JS: a mount, a mid-flight
 * Retarget, an at-rest Retarget and an unmount. `bench:core` times the frames in between.
 *
 * - **Both bindings are gated,** each head against its base, by the same rules (#259, ADR-0045).
 *   The Solid 2 page is skipped when the base or the head has no Solid 2 binding. `--binding 1` or
 *   `--binding 2` runs one; the noise control runs either way.
 *
 * - **Each side is built as an app ships it:** Vite and vite-plugin-solid, production mode,
 *   minified, for the browsers an app ships to by default (`APP_TARGET`, #525), from that side's
 *   `packages/{core,dom,solid}/src`. A bare import resolves as the importing package would, in that
 *   side's dependencies (`bench:core`'s rule: a commit whose `bun.lock` differs is checked out and
 *   installed at `.tmp/bench-core/deps/<commit>`).
 * - **Paired reps.** Each rep runs base and head back to back, each on a fresh cross-origin isolated
 *   page (`performance.now()` at 5 µs), in alternating order. A page runs `--rounds` rounds: the
 *   first is reported as cold, the median of the rest as warm.
 * - **Noise control.** The `plain` page, `CONTROL_SCALE` × N plain `div`s on the same signal, is the
 *   same code on both sides. If its median ratio is off by more than ±5%, the run is too noisy to
 *   judge. At N its tasks were 0.4–1.1 ms, and one slow warm round of three moved a page's total by
 *   15–20%, so the control flapped on a quiet host (#318); at 10 × N they're about 22 ms in total.
 * - **Time gate,** warm only: a task fails when its median ratio passes +5% and its 25th
 *   percentile is above 0%, so at least three pairs in four ran slower (`bench:core`'s gate). Cold
 *   is reported, not gated.
 * - **A full GC before each timed task** (ADR-0040, *Amendment (#69)*): Chromium runs with
 *   `--expose-gc`, and the page collects before it starts a task's clock, so a task times its own JS.
 *   Without it a task's time was bimodal, with a scavenge inside it or not, and a side's share of
 *   scavenges moved with where its allocation left the young generation, not with its cost.
 * - **Bytes gate:** `--alloc-reps` paired pages per side and binding run the same rounds under V8's sampling
 *   heap profiler, objects freed by either GC counted: what a side allocates per element per round,
 *   its tasks and the frames between them together. It fails as a task does (+5% median, 25th
 *   percentile above 0), so what the GC per task leaves out of the times is still held.
 * - **Retained gate** (#318): `--retained-reps` paired pages per side, binding and kind, each mounted,
 *   settled at rest and unmounted three times. The kinds:
 *   - `retained`: N `wardic.div`s with `whileHover` and `whileTap` (their hover and press recognizers
 *     started at mount);
 *   - `retained-reorder` (#379): N `Reorder.Item`s in one `Reorder.Group`, each a draggable layout
 *     node with its drag track and its keyboard, blur and press input.
 *   The heap is read after two full GCs (CDP's `HeapProfiler.collectGarbage`, then
 *   `Runtime.getHeapUsage`) before each mount, at rest, and after the unmount. What a side keeps per
 *   element, the median of its cycles, fails as a task does. What an unmount leaves is about 0, and a
 *   ratio of two zeros is noise, so it's gated against a ceiling instead (#418): the head's median
 *   cycle fails above 1 KB per element, a leak already on the base included. Solid 2's Reorder items
 *   left 8.7 KB each for two days, reported and unread.
 *
 * - **Layout gate** (#385): the `layout` page, #383's tree of 1,331 `layout` wards, per side and
 *   binding with the others, paired. Per scene (page, list, item, scaled; see `page.tsx`), the
 *   `animateLayout` call (its Measure pass) and its frames' median fail as a task does, and so does
 *   what the scenes allocate per frame, from `--alloc-reps` pages under the heap profiler, sampled
 *   after the tree has mounted. How many frames each scene took is reported. The own-size scene
 *   (#504) sets an item's width for its own legs to draw instead of calling `animateLayout`, and its
 *   frames count the ResizeObserver's deliveries and the passes they run.
 *
 * Runs on the bench server, after `wardic-quiet`, not in CI. Exits 0 when every task passes, 1
 * when one fails, and 2 when the run is too noisy.
 *
 * `--live` (#130, ADR-0043) runs `--head` alone, with no base: N elements following a Live value
 * each frame (`?kind=live`) against N plain divs whose style binds the same signal (`?kind=live-plain`),
 * paired per rep. It reports the mount, the set task and the frame after it (see `page.tsx`), and the
 * unmount, Wardic's against plain Solid's, ungated: a base before Live values can't run the page.
 *
 * `--features` (#460 Q3) adds the feature pages, each the `wardic` page's elements and rounds with one
 * feature on (`page.tsx`): Keyframes (#429, #457), Measured pairs (`height: "auto"`, #430) and
 * `transitionEnd` (#428) on both bindings, and on Solid 2 `tapped()` (#427) with its reference page of
 * plain wards. Each is timed and its bytes read as the `wardic` page's, head against base, gated as
 * a task is when the base has the feature (the commit it arrived in, `FEATURES`); against an earlier
 * base the head runs alone, reported, not gated. Each also reports its cost to the elements using
 * it: the head's page against its reference page, paired per rep, not gated. **A change to one of
 * these features, or to the path they share with every element, runs `--features`** (docs/agents/effect-first.md).
 *
 * `--batch` (#665) runs `--head` alone too: N elements moved as one `createBatch` (`?kind=batch`) against
 * the same moves through `createAnimate`, a call per element (`?kind=batch-animate`), paired per rep. Each
 * change is timed as a task and each frame's rAF callbacks summed while they fly. It fails when the
 * Batch's change costs more than 1/20 of the per-element one, or its frame more than 0.6× (#665's Q16;
 * the probe measured 1/120 and 0.42×). Run it at `--n 1000` and `--n 3000`. A third page, the same Batch
 * with `whileHover` and `whileTap` (`?kind=batch-gestures`, #665's PR 5), is gated against the plain one's
 * mount, change and frame by the per-element bench's rule (+5%, its p25 above 1).
 *
 * `--batch-frames` runs the Batch's frames head against base, paired per rep, with the plain-div noise
 * control, on three pages (see `page.tsx`): every member moving (`?kind=batch`), a stagger across half a
 * second holding most of them waiting (`?kind=batch-stagger`), and a change from code paused partway, every
 * member still (`?kind=batch-paused`). Each page's change task and frame fail as the per-element bench's
 * tasks do (+5%, its p25 above 1); the frames a member doesn't move in are where a write it doesn't need
 * shows. The base needs `createBatch` (#665). Run it at `--n 1000` and `--n 3000`.
 *
 * `--reorder-batch` (#712, ADR-0072 decision 11) runs `--head` alone too: N items reordered by a drag in a
 * `Reorder.BatchGroup` (`?kind=reorder-batch`) against a `Reorder.Group` of `Reorder.Item`s with its `axis`
 * given (`?kind=reorder-group`), at the same places, in a column and in a grid of 40 columns, paired per
 * rep. The page drives the drag: a pointer event at the start of each frame, as Chromium delivers a real
 * pointer's, the item held moved five places in 30 moves. It fails when the Batch group's mount, to its
 * first paint (its task and microtasks, then its first frame, no idle wait between), costs more than 0.3× the group's, or its frame while dragging (the mean of the moves'
 * frames, from their first rAF callback to just after their paint) more than 0.75×. Run it at `--n 1000`
 * and `--n 5000`. The longest frame is reported, not gated.
 *
 * `--v2` (#209, ADR-0045) runs `--head` alone too: the Solid 2 binding's page (`page-v2.tsx`, the
 * same N `wardic.div`s, built with Solid 2's compile) against the Solid 1 binding's, paired per rep.
 * It reports each task and the first frame after the mount, where every element's Starting-style
 * switch goes through the binding's `batch`, ungated.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CDPSession, chromium, type Page } from "playwright"
import { build } from "vite"
import solid from "vite-plugin-solid"
import * as Arr from "effect/Array"
import { solid2 } from "../vite.solid2.ts"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import type { BatchRound, LayoutRound, LiveRound, ReorderRound, Round, Scene } from "./page.tsx"
import { APP_TARGET, commitOf, depsOf, PACKAGES, REPO, sideResolver, sourcesInto } from "./sides.ts"

const GATE = 1.05
const NOISE = 0.05
/** The control page's elements, against the Wardic pages' N: enough that its tasks can be timed (#318). */
const CONTROL_SCALE = 10
/** The heap profiler's mean sampling interval, in bytes: a page's rounds take about 170,000 samples. */
const ALLOC_INTERVAL = 4096

const BENCH = dirname(fileURLToPath(import.meta.url))
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
const retainedReps = Number(arg("retained-reps", "3"))
const liveMode = process.argv.includes("--live")
const batchMode = process.argv.includes("--batch")
const batchFramesMode = process.argv.includes("--batch-frames")
const reorderBatchMode = process.argv.includes("--reorder-batch")
const v2Mode = process.argv.includes("--v2")
const featuresMode = process.argv.includes("--features")
const bindingArg = arg("binding", "both")
if (Bool.not(["1", "2", "both"].includes(bindingArg))) throw new Error(`bench:solid: --binding is 1, 2 or both, not ${bindingArg}`)

/** A build: a side's Solid 1 page (`base`, `head`) or its Solid 2 page (`v2Base`, `v2Head`). */
type Side = "base" | "head" | "v2Base" | "v2Head"
const isV2 = (side: Side): boolean => Bool.or(side === "v2Base", side === "v2Head")
/** The retained gate's pages (#318, #379). */
const RETAINED_KINDS = ["retained", "retained-reorder"] as const
type RetainedKind = (typeof RETAINED_KINDS)[number]
/** `--features`' pages (#460 Q3): `ward` is `tapped`'s reference page. */
const FEATURE_KINDS = ["keyframes", "auto", "transition-end", "ward", "tapped"] as const
type FeatureKind = (typeof FEATURE_KINDS)[number]
type Kind =
  | "wardic"
  | "plain"
  | "live"
  | "live-plain"
  | "layout"
  | "batch"
  | "batch-gestures"
  | "batch-animate"
  | "batch-stagger"
  | "batch-paused"
  | "reorder-batch"
  | "reorder-group"
  | RetainedKind
  | FeatureKind
/** The layout page's scenes, in `page.tsx`'s order (#385): the page isn't imported for its values. */
const SCENES: ReadonlyArray<Scene> = ["page", "list", "item", "scaled", "own-size"]
const SCENE_TASKS = ["measure", "frame"] as const
const TASKS = ["mount", "retarget", "restRetarget", "unmount"] as const



/** The Solid 2 binding's folder, which a commit before #209 doesn't have: its entry is `index.ts` or, since its rename, `index.tsx`. */
const V2_ENTRY = "packages/solid/src/unstable/v2"
/** Whether `commit` (the working tree when undefined) has the Solid 2 binding. */
const hasV2 = (commit: string | undefined): boolean =>
  UndefinedOr.match(commit, {
    onUndefined: () => existsSync(join(REPO, V2_ENTRY)),
    onDefined: (c) => {
      try {
        execSync(`git cat-file -e ${c}:${V2_ENTRY}`, { cwd: REPO, stdio: "ignore" })
        return true
      } catch {
        return false
      }
    },
  })

/** Whether `commit` (the working tree when undefined) has what `since` brought: it is `since`, or after it. */
const hasSince = (since: string | undefined, commit: string | undefined): boolean => {
  if (Bool.or(since === undefined, commit === undefined)) return true
  try {
    execSync(`git merge-base --is-ancestor ${since} ${commit}`, { cwd: REPO, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}


/** Put a side's three packages' `src` at `.tmp/bench-solid/<side>/packages`: from a commit, or the working tree. */
const fill = (side: Side, commit: string | undefined): string => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  sourcesInto(root, commit)
  cpSync(join(BENCH, "page.tsx"), join(root, "page.tsx"))
  cpSync(join(BENCH, "page-v2.tsx"), join(root, "page-v2.tsx"))
  return root
}



const bundle = async (side: Side, commit: string | undefined, deps: string): Promise<string> => {
  const root = fill(side, commit)
  // vite-plugin-solid's Babel reads the JSX import source from a package's own node_modules.
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(deps, "packages/solid/node_modules"), join(root, "node_modules"))
  // The Solid 2 page builds with Solid 2's compile, without its dev checks, as an app ships it.
  const v2 = isV2(side)
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
      target: [...APP_TARGET],
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
// `--live`, `--batch`, `--reorder-batch` and `--v2` run the head alone: their pages can't run on a base before them.
const headAlone = Bool.some([liveMode, batchMode, reorderBatchMode, v2Mode])
const runSolid1 = Bool.or(headAlone, bindingArg !== "2")
const wantSolid2 = Bool.and(Bool.not(Bool.some([liveMode, batchMode, batchFramesMode, reorderBatchMode])), Bool.or(v2Mode, bindingArg !== "1"))
// The Solid 2 page, head against base (#259), when both have the binding; `--v2`'s head alone.
const runSolid2 = Bool.and(wantSolid2, Bool.and(hasV2(headCommit), Bool.or(headAlone, hasV2(baseCommit))))
const headScript = await bundle("head", headCommit, headDeps)
const baseScript = await Bool.match(headAlone, { onTrue: () => Promise.resolve(headScript), onFalse: () => bundle("base", baseCommit, baseDeps) })
const v2HeadScript = await Bool.match(runSolid2, { onTrue: () => bundle("v2Head", headCommit, headDeps), onFalse: () => Promise.resolve("") })
const v2BaseScript = await Bool.match(Bool.and(runSolid2, Bool.not(headAlone)), {
  onTrue: () => bundle("v2Base", baseCommit, baseDeps),
  onFalse: () => Promise.resolve(""),
})
const scripts: Record<Side, string> = { base: baseScript, head: headScript, v2Base: v2BaseScript, v2Head: v2HeadScript }

const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] })
/** A page of `side`'s build for `kind`, with `query`'s further parameters, its script loaded, and the errors it throws. */
const openPage = async (side: Side, kind: Kind, query = ""): Promise<{ readonly page: Page; readonly errors: Array<string> }> => {
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
  const elements = Bool.match(kind === "plain", { onTrue: () => n * CONTROL_SCALE, onFalse: () => n })
  await page.goto(`http://localhost:4174/?n=${elements}&kind=${kind}${query}`)
  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("bench:solid: page not cross-origin isolated")
  await page.addScriptTag({ url: "http://localhost:4174/page.js" })
  return { page, errors }
}

/** The page's `rounds` rounds. */
const runRounds = (page: Page): Promise<ReadonlyArray<Round>> =>
  page.evaluate((k) => (globalThis as unknown as { __wardicBenchSolid: (k: number) => Promise<ReadonlyArray<Round>> }).__wardicBenchSolid(k), rounds)

/** One page of `side`'s build: `rounds` rounds of `kind`. */
const runPage = async (side: Side, kind: Kind, query = ""): Promise<ReadonlyArray<Round>> => {
  const { page, errors } = await openPage(side, kind, query)
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

/** What one `wardic` page, or a feature page, of `side`'s build allocates over its rounds, in bytes per element per round. */
const allocatedPage = async (side: Side, kind: "wardic" | FeatureKind = "wardic"): Promise<number> => {
  const { page, errors } = await openPage(side, kind)
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
  if (errors.length > 0) throw new Error(`bench:solid: ${side} ${kind} allocation: ${errors.join("; ")}`)
  return bytesOf(profile.head as HeapNode) / (rounds * n)
}

/** One `layout` page of `side`'s build (#385): its rounds. */
const layoutPage = async (side: Side): Promise<ReadonlyArray<LayoutRound>> => {
  const { page, errors } = await openPage(side, "layout")
  const out = (await runRounds(page)) as unknown as ReadonlyArray<LayoutRound>
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} layout: ${errors.join("; ")}`)
  return out
}

/**
 * What one `layout` page of `side`'s build allocates over its scenes (#385), in bytes per frame:
 * sampled from once the tree has mounted, the `animateLayout` calls and the frames together.
 */
const allocatedLayoutPage = async (side: Side): Promise<number> => {
  const { page, errors } = await openPage(side, "layout")
  await page.evaluate(() => (globalThis as unknown as { __wardicLayoutMount: () => Promise<void> }).__wardicLayoutMount())
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: ALLOC_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  })
  const out = (await runRounds(page)) as unknown as ReadonlyArray<LayoutRound>
  const { profile } = await cdp.send("HeapProfiler.stopSampling")
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} layout allocation: ${errors.join("; ")}`)
  const frames = out.reduce((sum, round) => SCENES.reduce((inner, scene) => inner + round[scene].frames, sum), 0)
  return bytesOf(profile.head as HeapNode) / frames
}

/** Mount and unmount cycles on each retained page: the median of them is the page's (#318). */
const RETAINED_CYCLES = 3

/** The most an unmount may leave per element, in bytes: every page leaves 0.1–0.3 KB (#418). */
const LEFT_CEILING = 1024

/** The heap the page's JS holds after two full GCs, in bytes. */
const heldBy = async (cdp: CDPSession): Promise<number> => {
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  return (await cdp.send("Runtime.getHeapUsage")).usedSize
}

/** What one retained page of `side`'s build keeps (#318, #379), in bytes per element. */
interface Retained {
  /** Mounted, at rest: its wards, their gestures and everything they hold. */
  readonly kept: number
  /** After the unmount, against before the mount. */
  readonly left: number
}

const retainedPage = async (side: Side, kind: RetainedKind): Promise<Retained> => {
  const { page, errors } = await openPage(side, kind)
  const cdp = await page.context().newCDPSession(page)
  const call = (name: "mount" | "unmount"): Promise<void> =>
    page.evaluate((m) => (globalThis as unknown as { __wardicRetained: Record<string, () => Promise<void>> }).__wardicRetained[m]!(), name)
  const cycles: Array<Retained> = []
  for (let c = 0; c < RETAINED_CYCLES; c++) {
    const before = await heldBy(cdp)
    await call("mount")
    const mounted = await heldBy(cdp)
    await call("unmount")
    const after = await heldBy(cdp)
    cycles.push({ kept: (mounted - before) / n, left: (after - before) / n })
  }
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} ${kind}: ${errors.join("; ")}`)
  return { kept: median(cycles.map((c) => c.kept)), left: median(cycles.map((c) => c.left)) }
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

if (batchMode) {
  // Head alone: one Batch against a call per element, paired per rep (#665).
  console.log(`bench:solid --batch: ${headLabel}, Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`)
  const BATCH_TASKS = ["retarget", "frame"] as const
  /** The most a Batch's task may cost, against the per-element page's: Q16's gates. */
  const BATCH_GATES: Readonly<Record<(typeof BATCH_TASKS)[number], number>> = { retarget: 1 / 20, frame: 0.6 }
  type BatchKind = "batch" | "batch-gestures" | "batch-animate"
  const pagesOf: Record<BatchKind, Array<ReadonlyArray<BatchRound>>> = { batch: [], "batch-gestures": [], "batch-animate": [] }
  for (let r = 0; r < reps; r++) {
    const order: ReadonlyArray<BatchKind> = Bool.match(r % 2 === 0, {
      onTrue: (): ReadonlyArray<BatchKind> => ["batch", "batch-gestures", "batch-animate"],
      onFalse: (): ReadonlyArray<BatchKind> => ["batch-animate", "batch-gestures", "batch"],
    })
    for (const kind of order) pagesOf[kind].push((await runPage("head", kind)) as unknown as ReadonlyArray<BatchRound>)
    process.stderr.write(`rep ${r + 1}/${reps}\r`)
  }
  await browser.close()
  const warmOf = (page: ReadonlyArray<BatchRound>, task: keyof BatchRound): number => median(page.slice(1).map((round) => round[task]))
  console.log(`warm (ms, median across reps; batch / per element paired per rep: median [p25 – p75])`)
  console.log(`  ${"task".padEnd(10)}${"each".padEnd(10)}${"batch".padEnd(10)}${"ratio".padEnd(34)}gate`)
  let failed = false
  for (const task of BATCH_TASKS) {
    const ratios = pagesOf.batch.map((page, r) => warmOf(page, task) / warmOf(pagesOf["batch-animate"][r]!, task))
    const ratio = quantile(ratios, 0.5)
    const passes = ratio <= BATCH_GATES[task]
    if (Bool.not(passes)) failed = true
    console.log(
      `  ${task.padEnd(10)}${median(pagesOf["batch-animate"].map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
        `${median(pagesOf.batch.map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
        `${`${ratio.toFixed(3)}× [${quantile(ratios, 0.25).toFixed(3)} – ${quantile(ratios, 0.75).toFixed(3)}]`.padEnd(34)}` +
        Bool.match(passes, { onTrue: () => `ok (≤ ${BATCH_GATES[task].toFixed(2)}×)`, onFalse: () => `FAIL (> ${BATCH_GATES[task].toFixed(2)}×)` }),
    )
  }
  // With gestures (#665's PR 5): against the plain Batch, paired per rep.
  console.log(`\nwith whileHover and whileTap (ms, median across reps; gestures / plain Batch paired per rep: median [p25 – p75])`)
  console.log(`  ${"task".padEnd(10)}${"plain".padEnd(10)}${"gestures".padEnd(10)}change`)
  for (const task of ["mount", "retarget", "frame"] as const) {
    const ratios = pagesOf["batch-gestures"].map((page, r) => warmOf(page, task) / warmOf(pagesOf.batch[r]!, task))
    const fails = quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
    if (fails) failed = true
    console.log(
      `  ${task.padEnd(10)}${median(pagesOf.batch.map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
        `${median(pagesOf["batch-gestures"].map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${when(fails, "  FAIL")}`,
    )
  }
  process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
}

if (reorderBatchMode) {
  // Head alone: a Batch Reorder group against `Reorder.Group`, in each layout, paired per rep (#712).
  console.log(`bench:solid --reorder-batch: ${headLabel}, Chromium ${browser.version()}, ${n} items, ${rounds} rounds per page, ${reps} paired reps\n`)
  /** The most the Batch group's task may cost, against `Reorder.Group`'s (ADR-0072 decision 11): its longest frame isn't gated. */
  const REORDER_GATES: Readonly<Record<keyof ReorderRound, number | undefined>> = { mount: 0.3, frame: 0.75, longest: undefined }
  type ReorderKind = "reorder-batch" | "reorder-group"
  const warmOf = (page: ReadonlyArray<ReorderRound>, task: keyof ReorderRound): number => median(page.slice(1).map((round) => round[task]))
  let failed = false
  for (const layout of ["column", "grid"] as const) {
    const pagesOf: Record<ReorderKind, Array<ReadonlyArray<ReorderRound>>> = { "reorder-batch": [], "reorder-group": [] }
    for (let r = 0; r < reps; r++) {
      const order: ReadonlyArray<ReorderKind> = Bool.match(r % 2 === 0, {
        onTrue: (): ReadonlyArray<ReorderKind> => ["reorder-batch", "reorder-group"],
        onFalse: (): ReadonlyArray<ReorderKind> => ["reorder-group", "reorder-batch"],
      })
      for (const kind of order) pagesOf[kind].push((await runPage("head", kind, `&layout=${layout}`)) as unknown as ReadonlyArray<ReorderRound>)
      process.stderr.write(`${layout} rep ${r + 1}/${reps}\r`)
    }
    console.log(`${layout} (ms, median across reps; Batch group / Reorder.Group paired per rep: median [p25 – p75])`)
    console.log(`  ${"task".padEnd(10)}${"group".padEnd(10)}${"batch".padEnd(10)}${"ratio".padEnd(34)}gate`)
    for (const task of ["mount", "frame", "longest"] as const) {
      const ratios = pagesOf["reorder-batch"].map((page, r) => warmOf(page, task) / warmOf(pagesOf["reorder-group"][r]!, task))
      const ratio = quantile(ratios, 0.5)
      const most = REORDER_GATES[task]
      const passes = UndefinedOr.match(most, { onUndefined: () => true, onDefined: (m) => ratio <= m })
      if (Bool.not(passes)) failed = true
      const gate = UndefinedOr.match(most, {
        onUndefined: () => "not gated",
        onDefined: (m) => Bool.match(passes, { onTrue: () => `ok (≤ ${m.toFixed(2)}×)`, onFalse: () => `FAIL (> ${m.toFixed(2)}×)` }),
      })
      console.log(
        `  ${task.padEnd(10)}${median(pagesOf["reorder-group"].map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
          `${median(pagesOf["reorder-batch"].map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
          `${`${ratio.toFixed(3)}× [${quantile(ratios, 0.25).toFixed(3)} – ${quantile(ratios, 0.75).toFixed(3)}]`.padEnd(34)}${gate}`,
      )
    }
    console.log("")
  }
  await browser.close()
  process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
}

if (v2Mode) {
  // Head alone: the Solid 2 binding's page against the Solid 1 binding's, paired per rep.
  console.log(`bench:solid --v2: ${headLabel}, Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`)
  const V2_TASKS = ["mount", "firstFrame", "retarget", "restRetarget", "unmount"] as const
  if (Bool.not(runSolid2)) throw new Error("bench:solid --v2: the head has no Solid 2 binding")
  const pagesOf: Record<"head" | "v2Head", Array<ReadonlyArray<Round>>> = { head: [], v2Head: [] }
  for (let r = 0; r < reps; r++) {
    const order: ReadonlyArray<"head" | "v2Head"> = Bool.match(r % 2 === 0, {
      onTrue: (): ReadonlyArray<"head" | "v2Head"> => ["head", "v2Head"],
      onFalse: (): ReadonlyArray<"head" | "v2Head"> => ["v2Head", "head"],
    })
    for (const side of order) pagesOf[side].push(await runPage(side, "wardic"))
    process.stderr.write(`rep ${r + 1}/${reps}\r`)
  }
  await browser.close()
  const warmOf = (page: ReadonlyArray<Round>, task: (typeof V2_TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
  console.log(`warm (ms, median across reps; Solid 2 / Solid 1 paired per rep: median [p25 – p75])`)
  console.log(`  ${"task".padEnd(14)}${"solid 1".padEnd(10)}${"solid 2".padEnd(10)}ratio`)
  for (const task of V2_TASKS) {
    const ratios = pagesOf.v2Head.map((page, r) => warmOf(page, task) / warmOf(pagesOf.head[r]!, task))
    console.log(
      `  ${task.padEnd(14)}${median(pagesOf.head.map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${median(pagesOf.v2Head.map((page) => warmOf(page, task))).toFixed(2).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`,
    )
  }
  process.exit(0)
}

if (batchFramesMode) {
  // Head against base: a Batch's frames while every member moves, while most wait out a stagger, and while a
  // change is paused, paired per rep, with the plain-div noise control.
  console.log(
    `bench:solid --batch-frames: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}, Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`,
  )
  const FRAME_KINDS = ["batch", "batch-stagger", "batch-paused"] as const
  type FrameKind = (typeof FRAME_KINDS)[number]
  const LABELS: Record<FrameKind, string> = { batch: "all moving", "batch-stagger": "staggered", "batch-paused": "paused" }
  const pagesOf: Record<FrameKind, Record<"base" | "head", Array<ReadonlyArray<BatchRound>>>> = {
    batch: { base: [], head: [] },
    "batch-stagger": { base: [], head: [] },
    "batch-paused": { base: [], head: [] },
  }
  const plain: Record<"base" | "head", Array<ReadonlyArray<Round>>> = { base: [], head: [] }
  for (let r = 0; r < reps; r++) {
    // Base first on even reps, head first on odd ones.
    const order: ReadonlyArray<"base" | "head"> = Bool.match(r % 2 === 0, {
      onTrue: (): ReadonlyArray<"base" | "head"> => ["base", "head"],
      onFalse: (): ReadonlyArray<"base" | "head"> => ["head", "base"],
    })
    for (const kind of FRAME_KINDS) for (const side of order) pagesOf[kind][side].push((await runPage(side, kind)) as unknown as ReadonlyArray<BatchRound>)
    for (const side of order) plain[side].push(await runPage(side, "plain"))
    process.stderr.write(`rep ${r + 1}/${reps}\r`)
  }
  await browser.close()
  const warmOf = (page: ReadonlyArray<BatchRound>, task: "retarget" | "frame"): number => median(page.slice(1).map((round) => round[task]))
  const plainTotal = (page: ReadonlyArray<Round>): number => TASKS.reduce((sum, task) => sum + median(page.slice(1).map((round) => round[task])), 0)
  const controlRatios = plain.head.map((page, r) => plainTotal(page) / plainTotal(plain.base[r]!))
  const control = median(controlRatios)
  const noisy = Math.abs(control - 1) > NOISE
  console.log(
    `control (${n * CONTROL_SCALE} plain divs, all four tasks, warm): ${percent(control)} [${percent(quantile(controlRatios, 0.25))} – ${percent(quantile(controlRatios, 0.75))}]${when(noisy, "  too noisy: rerun on a quiet host")}\n`,
  )
  console.log(`warm (ms, median across reps; head / base paired per rep: median [p25 – p75])`)
  console.log(`  ${"page".padEnd(12)}${"task".padEnd(10)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  let failed = false
  for (const kind of FRAME_KINDS) {
    for (const task of ["retarget", "frame"] as const) {
      const pages = pagesOf[kind]
      const ratios = pages.head.map((page, r) => warmOf(page, task) / warmOf(pages.base[r]!, task))
      const fails = quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
      failed ||= fails
      console.log(
        `  ${LABELS[kind].padEnd(12)}${task.padEnd(10)}${median(pages.base.map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
          `${median(pages.head.map((page) => warmOf(page, task))).toFixed(3).padEnd(10)}` +
          `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${when(fails, "  FAIL")}`,
      )
    }
  }
  if (noisy) process.exit(2)
  process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
}

console.log(`bench:solid: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)
if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
console.log(
  `Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps, ${allocReps} for bytes${when(featuresMode, ", with the feature pages")}`,
)
console.log(
  `bindings: ${Arr.join(
    Arr.filter([when(runSolid1, "Solid 1"), when(runSolid2, "Solid 2"), when(Bool.and(wantSolid2, Bool.not(runSolid2)), "(Solid 2 skipped: no binding on one side)")], (x) => x.length > 0),
    ", ",
  )}\n`,
)

/** Rep `r`'s order: base first on even reps, head first on odd ones. */
const orderOf = (r: number): ReadonlyArray<"base" | "head"> => {
  if (r % 2 === 0) return ["base", "head"]
  return ["head", "base"]
}
/** A binding's two builds: Solid 1's `base` and `head`, Solid 2's `v2Base` and `v2Head`. */
const SIDES = {
  solid1: { base: "base", head: "head" },
  solid2: { base: "v2Base", head: "v2Head" },
} as const satisfies Record<string, Record<"base" | "head", Side>>
type Binding = keyof typeof SIDES

/** A feature page (`--features`, #460 Q3). */
interface Feature {
  readonly kind: FeatureKind
  readonly label: string
  /** The commit it arrived in: against a base before it, the head runs alone, reported, not gated. */
  readonly since: string | undefined
  readonly bindings: ReadonlyArray<Binding>
  /** The head's page its cost is read against: the same elements without it. */
  readonly reference: "wardic" | "ward"
}
const FEATURES: ReadonlyArray<Feature> = [
  { kind: "keyframes", label: "Keyframes (#429)", since: "708bd5a", bindings: ["solid1", "solid2"], reference: "wardic" },
  { kind: "auto", label: "Measured pairs (#430)", since: "aa76e73", bindings: ["solid1", "solid2"], reference: "wardic" },
  { kind: "transition-end", label: "transitionEnd (#428)", since: "2a39b2f", bindings: ["solid1", "solid2"], reference: "wardic" },
  { kind: "ward", label: "wards", since: undefined, bindings: ["solid2"], reference: "wardic" },
  { kind: "tapped", label: "tapped() (#427)", since: "1c8159b", bindings: ["solid2"], reference: "ward" },
]
/** The feature pages a binding runs: none without `--features`, and none the head is before. */
const featuresOf = (binding: Binding): ReadonlyArray<Feature> =>
  Arr.filter(FEATURES, (f) => Bool.and(featuresMode, Bool.and(f.bindings.includes(binding), hasSince(f.since, headCommit))))
/** Whether a feature's pages are run head against base, and gated: the base has it. */
const baseHas = (f: Feature): boolean => hasSince(f.since, baseCommit)
/** A rep's order for a feature page: the head alone when the base is before it. */
const featureOrder = (f: Feature, order: ReadonlyArray<"base" | "head">): ReadonlyArray<"base" | "head"> =>
  Arr.filter(order, (side) => Bool.or(side === "head", baseHas(f)))

const bindings: ReadonlyArray<Binding> = Arr.filter(["solid1", "solid2"] as const, (b) => Bool.match(b === "solid1", { onTrue: () => runSolid1, onFalse: () => runSolid2 }))
const emptySides = (): Record<"base" | "head", Array<ReadonlyArray<Round>>> => ({ base: [], head: [] })
const runs: Record<Binding | "plain", Record<"base" | "head", Array<ReadonlyArray<Round>>>> = { solid1: emptySides(), solid2: emptySides(), plain: emptySides() }
const emptyLayout = (): Record<"base" | "head", Array<ReadonlyArray<LayoutRound>>> => ({ base: [], head: [] })
const layoutRuns: Record<Binding, Record<"base" | "head", Array<ReadonlyArray<LayoutRound>>>> = { solid1: emptyLayout(), solid2: emptyLayout() }
const emptyFeatures = <A>(): Record<FeatureKind, Record<"base" | "head", Array<A>>> => ({
  keyframes: { base: [], head: [] },
  auto: { base: [], head: [] },
  "transition-end": { base: [], head: [] },
  ward: { base: [], head: [] },
  tapped: { base: [], head: [] },
})
const featureRuns: Record<Binding, Record<FeatureKind, Record<"base" | "head", Array<ReadonlyArray<Round>>>>> = { solid1: emptyFeatures(), solid2: emptyFeatures() }
for (let r = 0; r < reps; r++) {
  const order = orderOf(r)
  for (const binding of bindings) for (const side of order) runs[binding][side].push(await runPage(SIDES[binding][side], "wardic"))
  for (const binding of bindings) {
    for (const f of featuresOf(binding)) for (const side of featureOrder(f, order)) featureRuns[binding][f.kind][side].push(await runPage(SIDES[binding][side], f.kind))
  }
  for (const binding of bindings) for (const side of order) layoutRuns[binding][side].push(await layoutPage(SIDES[binding][side]))
  // The noise control: plain divs on Solid 1's compile, whichever bindings run.
  for (const side of order) runs.plain[side].push(await runPage(side, "plain"))
  process.stderr.write(`rep ${r + 1}/${reps}\r`)
}
const allocated: Record<Binding, Record<"base" | "head", Array<number>>> = { solid1: { base: [], head: [] }, solid2: { base: [], head: [] } }
const layoutAllocated: Record<Binding, Record<"base" | "head", Array<number>>> = { solid1: { base: [], head: [] }, solid2: { base: [], head: [] } }
const featureAllocated: Record<Binding, Record<FeatureKind, Record<"base" | "head", Array<number>>>> = { solid1: emptyFeatures(), solid2: emptyFeatures() }
for (let r = 0; r < allocReps; r++) {
  const order = orderOf(r)
  for (const binding of bindings) for (const side of order) allocated[binding][side].push(await allocatedPage(SIDES[binding][side]))
  for (const binding of bindings) {
    for (const f of featuresOf(binding)) for (const side of featureOrder(f, order)) featureAllocated[binding][f.kind][side].push(await allocatedPage(SIDES[binding][side], f.kind))
  }
  for (const binding of bindings) for (const side of order) layoutAllocated[binding][side].push(await allocatedLayoutPage(SIDES[binding][side]))
  process.stderr.write(`bytes ${r + 1}/${allocReps}\r`)
}
const emptyRetained = (): Record<RetainedKind, Record<"base" | "head", Array<Retained>>> => ({
  retained: { base: [], head: [] },
  "retained-reorder": { base: [], head: [] },
})
const retained: Record<Binding, Record<RetainedKind, Record<"base" | "head", Array<Retained>>>> = { solid1: emptyRetained(), solid2: emptyRetained() }
for (let r = 0; r < retainedReps; r++) {
  const order = orderOf(r)
  for (const binding of bindings) {
    for (const kind of RETAINED_KINDS) for (const side of order) retained[binding][kind][side].push(await retainedPage(SIDES[binding][side], kind))
  }
  process.stderr.write(`retained ${r + 1}/${retainedReps}\r`)
}
await browser.close()

const warm = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
const cold = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => page[0]![task]
const total = (page: ReadonlyArray<Round>): number => TASKS.reduce((sum, task) => sum + warm(page, task), 0)

const controlRatios = runs.plain.head.map((page, r) => total(page) / total(runs.plain.base[r]!))
const control = median(controlRatios)
const noisy = Math.abs(control - 1) > NOISE
console.log(`control (${n * CONTROL_SCALE} plain divs, all four tasks, warm): ${percent(control)} [${percent(quantile(controlRatios, 0.25))} – ${percent(quantile(controlRatios, 0.75))}]${when(noisy, "  too noisy: rerun on a quiet host")}\n`)

/** The retained table's rows: a ward with `whileHover` and `whileTap`, and a Reorder item. */
const RETAINED_ROWS: ReadonlyArray<readonly [RetainedKind, string]> = [
  ["retained", "hover + press"],
  ["retained-reorder", "reorder item"],
]
const TITLES: Record<Binding, string> = { solid1: "Solid 1 (@wardic/solid)", solid2: "Solid 2 (@wardic/solid/unstable/v2)" }

/** Ratios' median and quartiles, as the tables print them. */
const spread = (ratios: ReadonlyArray<number>): string => `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`
/** Whether ratios fail the gate: a median past +5%, its 25th percentile above 0%. */
const failsGate = (ratios: ReadonlyArray<number>): boolean => Bool.and(quantile(ratios, 0.5) > GATE, quantile(ratios, 0.25) > 1)

/**
 * A binding's feature pages (`--features`): each warm task and its bytes, head against base when the
 * base has the feature (gated), and the head's page against its reference page (its cost, not gated).
 * Whether one failed.
 */
const featureReport = (binding: Binding): boolean => {
  const features = featuresOf(binding)
  if (features.length === 0) return false
  let fails = false
  console.log(
    "\nfeatures (--features; warm ms and KB per element per round, median across reps; head / base paired per rep: median [p25 – p75], " +
      "gated when the base has the feature; its cost: the head's page against its reference page, paired per rep, not gated)",
  )
  for (const f of features) {
    const pages = featureRuns[binding][f.kind]
    const bytes = featureAllocated[binding][f.kind]
    const refPages = Bool.match(f.reference === "wardic", { onTrue: () => runs[binding].head, onFalse: () => featureRuns[binding].ward.head })
    const refBytes = Bool.match(f.reference === "wardic", { onTrue: () => allocated[binding].head, onFalse: () => featureAllocated[binding].ward.head })
    const gated = baseHas(f)
    console.log(`  ${f.label}${when(Bool.not(gated), `: the base is before ${f.since}, the head alone, not gated`)}`)
    console.log(`    ${"".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}${"head / base".padEnd(30)}vs ${f.reference}`)
    const row = (label: string, base: string, head: string, ratios: ReadonlyArray<number>, cost: ReadonlyArray<number>): void => {
      const failing = Bool.and(gated, failsGate(ratios))
      fails ||= failing
      const change = Bool.match(gated, { onTrue: () => spread(ratios), onFalse: () => "—" })
      console.log(`    ${label.padEnd(14)}${base.padEnd(10)}${head.padEnd(10)}${change.padEnd(30)}${spread(cost)}${when(failing, "  FAIL")}`)
    }
    for (const task of TASKS) {
      const ratios = Bool.match(gated, { onTrue: () => pages.head.map((page, r) => warm(page, task) / warm(pages.base[r]!, task)), onFalse: (): Array<number> => [] })
      const base = Bool.match(gated, { onTrue: () => median(pages.base.map((page) => warm(page, task))).toFixed(1), onFalse: () => "—" })
      const cost = pages.head.map((page, r) => warm(page, task) / warm(refPages[r]!, task))
      row(task, base, median(pages.head.map((page) => warm(page, task))).toFixed(1), ratios, cost)
    }
    const byteRatios = Bool.match(gated, { onTrue: () => bytes.head.map((b, r) => b / bytes.base[r]!), onFalse: (): Array<number> => [] })
    const baseBytes = Bool.match(gated, { onTrue: () => (median(bytes.base) / 1024).toFixed(1), onFalse: () => "—" })
    row("bytes", baseBytes, (median(bytes.head) / 1024).toFixed(1), byteRatios, bytes.head.map((b, r) => b / refBytes[r]!))
  }
  return fails
}

let failed = false
for (const binding of bindings) {
  const pages = runs[binding]
  console.log(`== ${TITLES[binding]}\n`)
  for (const [label, pick, gated] of [["warm", warm, true], ["cold", cold, false]] as const) {
    console.log(`${label} (ms, median across reps; head / base paired per rep: median [p25 – p75])${when(!gated, ", not gated")}`)
    console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
    for (const task of TASKS) {
      const ratios = pages.head.map((page, r) => pick(page, task) / pick(pages.base[r]!, task))
      const fails = gated && quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
      failed ||= fails
      console.log(
        `  ${task.padEnd(14)}${median(pages.base.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
          `${median(pages.head.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
          `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${when(fails, "  FAIL")}`,
      )
    }
    console.log("")
  }
  const bytes = allocated[binding]
  const allocRatios = bytes.head.map((b, r) => b / bytes.base[r]!)
  const allocFails = quantile(allocRatios, 0.5) > GATE && quantile(allocRatios, 0.25) > 1
  failed ||= allocFails
  console.log("allocated (KB per element per round, tasks and frames; head / base paired per rep: median [p25 – p75])")
  console.log(`  ${"".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  console.log(
    `  ${"bytes".padEnd(14)}${(median(bytes.base) / 1024).toFixed(1).padEnd(10)}${(median(bytes.head) / 1024).toFixed(1).padEnd(10)}` +
      `${percent(quantile(allocRatios, 0.5))} [${percent(quantile(allocRatios, 0.25))} – ${percent(quantile(allocRatios, 0.75))}]${when(allocFails, "  FAIL")}\n`,
  )
  console.log("retained (KB per element at rest; head / base paired per rep: median [p25 – p75])")
  console.log(`  ${"".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  for (const [kind, label] of RETAINED_ROWS) {
    const held = retained[binding][kind]
    const keptRatios = held.head.map((h, r) => h.kept / held.base[r]!.kept)
    const keptFails = quantile(keptRatios, 0.5) > GATE && quantile(keptRatios, 0.25) > 1
    failed ||= keptFails
    console.log(
      `  ${label.padEnd(14)}${(median(held.base.map((h) => h.kept)) / 1024).toFixed(2).padEnd(10)}${(median(held.head.map((h) => h.kept)) / 1024).toFixed(2).padEnd(10)}` +
        `${percent(quantile(keptRatios, 0.5))} [${percent(quantile(keptRatios, 0.25))} – ${percent(quantile(keptRatios, 0.75))}]${when(keptFails, "  FAIL")}`,
    )
  }
  console.log(`\nleft after the unmount (KB per element, median across reps), gated: the head at most ${(LEFT_CEILING / 1024).toFixed(0)} KB`)
  for (const [kind, label] of RETAINED_ROWS) {
    const held = retained[binding][kind]
    const left = median(held.head.map((h) => h.left))
    const leftFails = left > LEFT_CEILING
    failed ||= leftFails
    console.log(`  ${label.padEnd(14)}${(median(held.base.map((h) => h.left)) / 1024).toFixed(2).padEnd(10)}${(left / 1024).toFixed(2)}${when(leftFails, "  FAIL")}`)
  }
  // The projection engine's page (#385): each scene's Measure pass and frames, warm, and the bytes per frame.
  const layout = layoutRuns[binding]
  const sceneWarm = (page: ReadonlyArray<LayoutRound>, scene: Scene, task: (typeof SCENE_TASKS)[number] | "frames"): number =>
    median(page.slice(1).map((round) => round[scene][task]))
  console.log("\nlayout (1,331 layout wards; ms, warm, median across reps; head / base paired per rep: median [p25 – p75])")
  console.log(`  ${"scene".padEnd(18)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  for (const scene of SCENES) {
    for (const task of SCENE_TASKS) {
      const ratios = layout.head.map((page, r) => sceneWarm(page, scene, task) / sceneWarm(layout.base[r]!, scene, task))
      const fails = quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
      failed ||= fails
      console.log(
        `  ${`${scene} ${task}`.padEnd(18)}${median(layout.base.map((page) => sceneWarm(page, scene, task))).toFixed(3).padEnd(10)}` +
          `${median(layout.head.map((page) => sceneWarm(page, scene, task))).toFixed(3).padEnd(10)}` +
          `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${when(fails, "  FAIL")}`,
      )
    }
  }
  const layoutBytes = layoutAllocated[binding]
  const layoutByteRatios = layoutBytes.head.map((b, r) => b / layoutBytes.base[r]!)
  const layoutBytesFail = quantile(layoutByteRatios, 0.5) > GATE && quantile(layoutByteRatios, 0.25) > 1
  failed ||= layoutBytesFail
  console.log(
    `  ${"KB per frame".padEnd(18)}${(median(layoutBytes.base) / 1024).toFixed(2).padEnd(10)}${(median(layoutBytes.head) / 1024).toFixed(2).padEnd(10)}` +
      `${percent(quantile(layoutByteRatios, 0.5))} [${percent(quantile(layoutByteRatios, 0.25))} – ${percent(quantile(layoutByteRatios, 0.75))}]${when(layoutBytesFail, "  FAIL")}`,
  )
  console.log(
    `  frames to land, not gated: ${SCENES.map((scene) => `${scene} ${median(layout.base.map((page) => sceneWarm(page, scene, "frames")))} / ${median(layout.head.map((page) => sceneWarm(page, scene, "frames")))}`).join(", ")}`,
  )
  // Not `||=`: the feature pages report whether or not a table above failed.
  failed = Bool.or(featureReport(binding), failed)
  console.log("")
}

if (noisy) process.exit(2)
process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
