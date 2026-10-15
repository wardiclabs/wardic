/// <reference types="node" />
/**
 * `bun run bench:solid [--base <ref>] [--head <ref>] [--reps 11] [--n 1000] [--rounds 4]`
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
 *
 * Runs on the bench server, after `wardic-quiet`, not in CI. Exits 0 when every task passes, 1
 * when one fails, and 2 when the run is too noisy.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { build, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import type { Round } from "./page.tsx"

const GATE = 1.05
const NOISE = 0.05
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

type Side = "base" | "head"
type Kind = "wardic" | "plain"
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
  return root
}

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
      return join(root, "packages", pkg!, "src", sub === undefined ? "index.ts" : `${sub}.ts`)
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
  await build({
    configFile: false,
    logLevel: "warn",
    mode: "production",
    root,
    plugins: [sideResolver(root, deps), solid()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      minify: true,
      lib: { entry: join(root, "page.tsx"), formats: ["iife"], name: "benchSolid", fileName: () => "page.js" },
    },
  })
  return readFileSync(join(root, "dist/page.js"), "utf8")
}

const quantile = (xs: ReadonlyArray<number>, p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!
const median = (xs: ReadonlyArray<number>): number => quantile(xs, 0.5)
const percent = (ratio: number): string => `${ratio < 1 ? "" : "+"}${((ratio - 1) * 100).toFixed(1)}%`

const baseCommit = commitOf(base)
const headCommit = headRef.length > 0 ? commitOf(headRef) : undefined
const baseDeps = depsOf(baseCommit)
const headDeps = headCommit === undefined ? REPO : depsOf(headCommit)
const dirty =
  execSync(`git status --porcelain -- ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")}`, { cwd: REPO }).toString().trim().length > 0
const headLabel = headCommit === undefined ? `the working tree${dirty ? " (modified)" : ""}` : `${headRef} (${headCommit.slice(0, 7)})`
const scripts: Record<Side, string> = {
  base: await bundle("base", baseCommit, baseDeps),
  head: await bundle("head", headCommit, headDeps),
}

const browser = await chromium.launch()
/** One page of `side`'s build: `rounds` rounds of `kind`. */
const runPage = async (side: Side, kind: Kind): Promise<ReadonlyArray<Round>> => {
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
  const out = await page.evaluate((k) => (globalThis as unknown as { __wardicBenchSolid: (k: number) => Promise<ReadonlyArray<Round>> }).__wardicBenchSolid(k), rounds)
  await page.close()
  if (errors.length > 0) throw new Error(`bench:solid: ${side} ${kind}: ${errors.join("; ")}`)
  return out
}

console.log(`bench:solid: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)
if (baseDeps !== REPO) console.log(`base runs on its own dependencies (${baseDeps})`)
if (headDeps !== REPO) console.log(`head runs on its own dependencies (${headDeps})`)
console.log(`Chromium ${browser.version()}, ${n} elements, ${rounds} rounds per page, ${reps} paired reps\n`)

const runs: Record<Kind, Record<Side, Array<ReadonlyArray<Round>>>> = { wardic: { base: [], head: [] }, plain: { base: [], head: [] } }
for (let r = 0; r < reps; r++) {
  const order: ReadonlyArray<Side> = r % 2 === 0 ? ["base", "head"] : ["head", "base"]
  for (const kind of ["wardic", "plain"] as const) for (const side of order) runs[kind][side].push(await runPage(side, kind))
  process.stderr.write(`rep ${r + 1}/${reps}\r`)
}
await browser.close()

const warm = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => median(page.slice(1).map((round) => round[task]))
const cold = (page: ReadonlyArray<Round>, task: (typeof TASKS)[number]): number => page[0]![task]
const total = (page: ReadonlyArray<Round>): number => TASKS.reduce((sum, task) => sum + warm(page, task), 0)

const controlRatios = runs.plain.head.map((page, r) => total(page) / total(runs.plain.base[r]!))
const control = median(controlRatios)
const noisy = Math.abs(control - 1) > NOISE
console.log(`control (plain divs, all four tasks, warm): ${percent(control)} [${percent(quantile(controlRatios, 0.25))} – ${percent(quantile(controlRatios, 0.75))}]${noisy ? "  too noisy: rerun on a quiet host" : ""}\n`)

let failed = false
for (const [label, pick, gated] of [["warm", warm, true], ["cold", cold, false]] as const) {
  console.log(`${label} (ms, median across reps; head / base paired per rep: median [p25 – p75])${gated ? "" : ", not gated"}`)
  console.log(`  ${"task".padEnd(14)}${"base".padEnd(10)}${"head".padEnd(10)}change`)
  for (const task of TASKS) {
    const ratios = runs.wardic.head.map((page, r) => pick(page, task) / pick(runs.wardic.base[r]!, task))
    const fails = gated && quantile(ratios, 0.5) > GATE && quantile(ratios, 0.25) > 1
    failed ||= fails
    console.log(
      `  ${task.padEnd(14)}${median(runs.wardic.base.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${median(runs.wardic.head.map((page) => pick(page, task))).toFixed(1).padEnd(10)}` +
        `${percent(quantile(ratios, 0.5))} [${percent(quantile(ratios, 0.25))} – ${percent(quantile(ratios, 0.75))}]${fails ? "  FAIL" : ""}`,
    )
  }
  console.log("")
}

if (noisy) process.exit(2)
process.exit(failed ? 1 : 0)
