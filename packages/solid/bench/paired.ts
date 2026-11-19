/// <reference types="node" />
/**
 * What the paired-rep benches share (#795, ADR-0071 *Amendment (#795)*): `bench:solid` (`run.ts`) and
 * `bench:foldkit` (`packages/foldkit/bench/run.ts`) each build a page per side as an app ships it, open it
 * in production Chromium with the GC exposed, run its rounds base and head back to back in alternating
 * order (paired reps), and gate each task's warm median against the base by one rule (ADR-0040, decision
 * 6; its *Amendment (#69)* for the bytes). This module holds what doesn't depend on a page's kinds: the
 * arguments, the stats and the gate, a side's page build, a page's opening and its rounds, its heap
 * sampling, and the heap it holds.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Browser, type CDPSession, chromium, type Page } from "playwright"
import { build, type PluginOption } from "vite"
import * as Bool from "effect/Boolean"
import { APP_TARGET } from "./sides.ts"

/** A task fails when its median ratio passes this, with its 25th percentile above 0 (ADR-0040, decision 6). */
export const GATE = 1.05
/** The noise control's median ratio may be off by this much; past it, the run is too noisy to judge. */
export const NOISE = 0.05
/** The control page's elements, against the Wardic pages' N: enough that its tasks can be timed (#318). */
export const CONTROL_SCALE = 10
/** The heap profiler's mean sampling interval, in bytes: a page's rounds take about 170,000 samples. */
export const ALLOC_INTERVAL = 4096

/** `--name value` from the arguments, or `fallback`. */
export const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

export const quantile = (xs: ReadonlyArray<number>, p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!
export const median = (xs: ReadonlyArray<number>): number => quantile(xs, 0.5)
/** `text` when `cond` holds, else nothing: a report line's optional part. */
export const when = (cond: boolean, text: string): string => Bool.match(cond, { onTrue: () => text, onFalse: () => "" })
export const percent = (ratio: number): string => `${when(ratio >= 1, "+")}${((ratio - 1) * 100).toFixed(1)}%`
/** Ratios' median and quartiles, as the tables print them. */
export const spread = (ratios: ReadonlyArray<number>): string => `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]`
/** Whether ratios fail the gate: a median past +5%, its 25th percentile above 0%. */
export const failsGate = (ratios: ReadonlyArray<number>): boolean => Bool.and(quantile(ratios, 0.5) > GATE, quantile(ratios, 0.25) > 1)

/** Rep `r`'s order: base first on even reps, head first on odd ones. */
export const orderOf = (r: number): ReadonlyArray<"base" | "head"> => {
  if (r % 2 === 0) return ["base", "head"]
  return ["head", "base"]
}

/** A side's page build: its `root`, the page `entry` in it, the `plugins` that resolve and compile it, and the IIFE's `name`. */
export interface PageBuild {
  readonly root: string
  readonly entry: string
  readonly plugins: ReadonlyArray<PluginOption>
  readonly name: string
}

/** A side's page, built as an app ships it: Vite, production mode, minified, for the browsers an app ships to by default (`APP_TARGET`, #525), as one script. */
export const buildPage = async ({ root, entry, plugins, name }: PageBuild): Promise<string> => {
  await build({
    configFile: false,
    logLevel: "warn",
    mode: "production",
    root,
    plugins: [...plugins],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      minify: true,
      target: [...APP_TARGET],
      lib: {
        entry: join(root, entry),
        formats: ["iife"],
        name,
        fileName: () => "page.js",
      },
    },
  })
  return readFileSync(join(root, "dist/page.js"), "utf8")
}

/** Production Chromium with the GC exposed: a page collects before each timed task (ADR-0040, *Amendment (#69)*). */
export const launch = (): Promise<Browser> => chromium.launch({ args: ["--js-flags=--expose-gc"] })

/** A page opened for a bench, and the errors it throws. */
export interface Opened {
  readonly page: Page
  readonly errors: Array<string>
}

/**
 * A fresh cross-origin isolated page (`performance.now()` at 5 µs) for `bench`, at `query`, with `script`
 * served as its `/page.js` and loaded: the page's own parameters are in the query.
 */
export const openPage = async (browser: Browser, bench: string, script: string, query: string): Promise<Opened> => {
  const page = await browser.newPage()
  const errors: Array<string> = []
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.route("http://localhost:4174/**", (route) => {
    if (new URL(route.request().url()).pathname === "/page.js") {
      // culori's identifiers aren't ASCII: the script is UTF-8.
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: script })
    }
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${bench}</title><body></body>`,
      headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    })
  })
  await page.goto(`http://localhost:4174/?${query}`)
  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error(`${bench}: page not cross-origin isolated`)
  await page.addScriptTag({ url: "http://localhost:4174/page.js" })
  return { page, errors }
}

/** The page's `rounds` rounds, through the function its script exposes on `globalThis` as `entry`. */
export const runRounds = <R>(page: Page, rounds: number, entry: string): Promise<ReadonlyArray<R>> =>
  page.evaluate(
    ([k, name]) => (globalThis as unknown as Record<string, (k: number) => Promise<ReadonlyArray<unknown>>>)[name]!(k),
    [rounds, entry] as const,
  ) as Promise<ReadonlyArray<R>>

/** A heap profile's node: what was allocated in its function, and its callees. */
interface HeapNode {
  readonly selfSize: number
  readonly children: ReadonlyArray<HeapNode>
}
const bytesOf = (node: HeapNode): number => node.children.reduce((sum, child) => sum + bytesOf(child), node.selfSize)

/** What `run` allocates on `page`, in bytes: V8's sampling heap profiler, objects freed by either GC counted. */
export const sampled = async (page: Page, run: () => Promise<unknown>): Promise<number> => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: ALLOC_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  })
  await run()
  const { profile } = await cdp.send("HeapProfiler.stopSampling")
  return bytesOf(profile.head as HeapNode)
}

/** The heap the page's JS holds after two full GCs, in bytes. */
export const heldBy = async (cdp: CDPSession): Promise<number> => {
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  return (await cdp.send("Runtime.getHeapUsage")).usedSize
}
