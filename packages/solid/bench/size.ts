/// <reference types="node" />
/**
 * `bun run size [--base <ref>] [--head <ref>]` (#511, decision Q10): what an app ships for Wardic.
 *
 * - **The apps:** each binding's plain Solid app, one Complete element (`wardic.div` under a
 *   `WardicProvider`), and the same inside `<AnimatePresence>`; one Slim element (`w.div`) alone, the
 *   Slim element's base, and with each Feature (#511). And a multi-route app (#548): a shell giving
 *   `domAnimation`, a plain page, a page that drags and one that lays out, each an entry as
 *   SolidStart's routes are, measured as what the plain page loads, so a Feature that reaches a page
 *   that never uses it fails the gate. An app the base can't build, its API new, is reported as new and not gated.
 * - **Each side is built as an app ships it** (`sides.ts`): a Vite app build, production mode,
 *   minified, tree-shaken, for the browsers an app ships to by default (`APP_TARGET`, #525); Solid 1
 *   through vite-plugin-solid, Solid 2 through the repo's `solid2({ dev: false })`. Not Vite's lib
 *   mode, as `bench:solid`'s pages are: for an ES library Vite keeps the whitespace, for bundlers
 *   downstream, and the Slim element's app read 122.5 KB gzipped where an app ships 103.9 (#518).
 * - **Reported:** each app's minified, gzip (level 9) and brotli bytes, head against base, and the
 *   head's minified bytes split by package through its source map.
 * - **Gate:** an app fails when its gzip grows more than 1% over the base's, and the Slim element's
 *   base apps when they pass their budgets (`BUDGETS`). Sizes are deterministic, so no reps and no
 *   quiet host: it runs in seconds. Exits 1 when an app fails.
 *
 * Run it for any change to a package's `src` (`docs/agents/effect-first.md`'s *Checks*).
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { build } from "vite"
import solid from "vite-plugin-solid"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { solid2 } from "../vite.solid2.ts"
import { APP_TARGET, commitOf, depsOf, PACKAGES, REPO, sideResolver, sourcesInto } from "./sides.ts"

/** An app fails when its gzip passes this ratio of the base's. */
const GATE = 1.01

/**
 * The Slim element's base apps' budgets (#511, decision 10), in gzipped KB: an app fails past its own,
 * whatever its base, so changes each under the gate can't add up. Each is the app's size as it ships,
 * with 0.5 KB of room, and each #518 PR lowers them to its own result (#518, Q8): 103.9 and 132.3 when
 * the apps were first built as they ship, where lib mode had read 122.5 and 158.6.
 */
const BUDGETS: Readonly<Record<string, number>> = { "s1-slim": 104.4, "s2-slim": 132.8 }

const OUT = join(REPO, ".tmp/size-gate")

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1 || at + 1 >= process.argv.length) return fallback
  return process.argv[at + 1]!
}

interface App {
  readonly name: string
  readonly v2: boolean
  readonly source: string
  /**
   * A multi-route app's pages (#548), each its own file and its own entry, as SolidStart's routes are,
   * which `source` loads with `import()`. Its size is what its first page loads: `source`, that page,
   * and every chunk they import statically, so a Feature only another page uses shows when it reaches
   * them.
   */
  readonly pages?: ReadonlyArray<string>
}

const plain = (render: string): string => `import { render } from "${render}"
render(() => <div style={{ opacity: 1 }}>hi</div>, document.body)
`

const complete = (render: string, entry: string, presence: boolean): string => {
  let element = `<wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>hi</wardic.div>`
  let imports = "WardicProvider, wardic"
  if (presence) {
    element = `<AnimatePresence><Show when={shown()}><wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>hi</wardic.div></Show></AnimatePresence>`
    imports = "AnimatePresence, WardicProvider, wardic"
  }
  return `import { createSignal, Show } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { ${imports} } from "${entry}"
const [shown] = createSignal(true)
render(() => <WardicProvider env={DomLive}>{shown() && ${element}}</WardicProvider>, document.body)
void Show
`
}

/**
 * A Slim element's app (#511): one `w.div` that fades in under a `WardicProvider` with `features`, a
 * list of the Feature imports it names (none: the Slim element's base app).
 */
const slim = (render: string, entry: string, features: ReadonlyArray<string>): string => {
  const imports = ["WardicProvider", "w", ...features].join(", ")
  return `import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { ${imports} } from "${entry}"
render(() => <WardicProvider env={DomLive} features={[${features.join(", ")}]}><w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>hi</w.div></WardicProvider>, document.body)
`
}

/**
 * A multi-route app (#548): a shell with a hover under a provider giving `domAnimation`, and three pages
 * loaded with `import()`: a plain one, one that drags (`LazyWardic features={[drag]}`) and one that
 * lays out (`features={[layout]}`). Measured, the plain page: what a page that never drags or lays out
 * downloads.
 */
const routes = (render: string, entry: string, name: string): App => ({
  name,
  v2: entry.endsWith("v2"),
  source: `import { lazy, Show } from "solid-js"
import { render } from "${render}"
import { DomLive } from "@wardic/dom"
import { domAnimation, w, WardicProvider } from "${entry}"
const Plain = lazy(() => import("./${name}-plain.tsx"))
const Drags = lazy(() => import("./${name}-drags.tsx"))
const Moves = lazy(() => import("./${name}-moves.tsx"))
render(() => <WardicProvider env={DomLive} features={[domAnimation]}><w.button whileHover={{ scale: 1.1 }}>menu</w.button><Show when={location.hash === "#drag"} fallback={<Show when={location.hash === "#layout"} fallback={<Plain />}><Moves /></Show>}><Drags /></Show></WardicProvider>, document.body)
`,
  pages: [
    `import { w } from "${entry}"
export default function Plain() { return <w.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>hi</w.div> }
`,
    `import { drag, LazyWardic, w } from "${entry}"
export default function Drags() { return <LazyWardic features={[drag]}><w.div drag="x">drag me</w.div></LazyWardic> }
`,
    `import { layout, LazyWardic, w } from "${entry}"
export default function Moves() { return <LazyWardic features={[layout]}><w.div layout>moves</w.div></LazyWardic> }
`,
  ],
})

const APPS: ReadonlyArray<App> = [
  { name: "s1-plain", v2: false, source: plain("solid-js/web") },
  { name: "s1-complete", v2: false, source: complete("solid-js/web", "@wardic/solid", false) },
  { name: "s1-presence", v2: false, source: complete("solid-js/web", "@wardic/solid", true) },
  { name: "s1-slim", v2: false, source: slim("solid-js/web", "@wardic/solid", []) },
  { name: "s1-colors", v2: false, source: slim("solid-js/web", "@wardic/solid", ["colors"]) },
  { name: "s1-layout", v2: false, source: slim("solid-js/web", "@wardic/solid", ["layout"]) },
  { name: "s1-hover", v2: false, source: slim("solid-js/web", "@wardic/solid", ["hover"]) },
  { name: "s1-drag", v2: false, source: slim("solid-js/web", "@wardic/solid", ["drag"]) },
  { name: "s1-dom-animation", v2: false, source: slim("solid-js/web", "@wardic/solid", ["domAnimation"]) },
  { name: "s1-dom-max", v2: false, source: slim("solid-js/web", "@wardic/solid", ["domMax"]) },
  routes("solid-js/web", "@wardic/solid", "s1-routes"),
  { name: "s2-plain", v2: true, source: plain("@solidjs/web") },
  { name: "s2-complete", v2: true, source: complete("@solidjs/web", "@wardic/solid/unstable/v2", false) },
  { name: "s2-presence", v2: true, source: complete("@solidjs/web", "@wardic/solid/unstable/v2", true) },
  { name: "s2-slim", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", []) },
  { name: "s2-colors", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["colors"]) },
  { name: "s2-layout", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["layout"]) },
  { name: "s2-hover", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["hover"]) },
  { name: "s2-drag", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["drag"]) },
  { name: "s2-dom-animation", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["domAnimation"]) },
  { name: "s2-dom-max", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["domMax"]) },
  routes("@solidjs/web", "@wardic/solid/unstable/v2", "s2-routes"),
]

/** What a source map's sources are counted under. */
const GROUPS = ["core", "dom", "solid", "effect", "solid-js", "culori", "other"] as const
type Group = (typeof GROUPS)[number]

const groupOf = (source: string): Group => {
  const own = /packages\/(core|dom|solid)\/src\//.exec(source)
  if (own !== null) return own[1] as Group
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?effect\//.test(source)) return "effect"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?(solid-js|solid-js-2|@solidjs)\//.test(source)) return "solid-js"
  if (/node_modules\/(\.bun\/[^/]+\/node_modules\/)?culori\//.test(source)) return "culori"
  return "other"
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** One source-map segment's fields, from its base64 VLQs. */
const fieldsOf = (segment: string): Array<number> => {
  const fields: Array<number> = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = B64.indexOf(ch)
    value += (digit & 31) << shift
    if ((digit & 32) !== 0) {
      shift += 5
      continue
    }
    if ((value & 1) === 1) fields.push(-(value >>> 1))
    if ((value & 1) === 0) fields.push(value >>> 1)
    value = 0
    shift = 0
  }
  return fields
}

/** A bundle's bytes by group: each generated column range counted under the source its segment maps to. */
const bytesByGroup = (js: string, map: { readonly sources: ReadonlyArray<string>; readonly mappings: string }): Record<Group, number> => {
  const bytes = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>
  const lines = js.split("\n")
  let source = 0
  map.mappings.split(";").forEach((line, row) => {
    const text = lines[row] ?? ""
    let column = 0
    const segments = line.split(",").filter((s) => s.length > 0).map((s) => {
      const fields = fieldsOf(s)
      column += fields[0]!
      if (fields.length > 1) source += fields[1]!
      return { column, source, mapped: fields.length > 1 }
    })
    segments.forEach((segment, i) => {
      const end = UndefinedOr.match(segments[i + 1], { onUndefined: () => text.length, onDefined: (next) => next.column })
      let group: Group = "other"
      if (segment.mapped) group = groupOf(map.sources[segment.source] ?? "")
      bytes[group] += Buffer.byteLength(text.slice(segment.column, end))
    })
  })
  return bytes
}

interface Size {
  readonly min: number
  readonly gz: number
  readonly br: number
  readonly groups: Record<Group, number>
}

/** One output chunk as `appSizeOf` reads it. */
interface Chunk {
  readonly type: "chunk" | "asset"
  readonly fileName: string
  readonly isEntry?: boolean
  readonly facadeModuleId?: string | null
  readonly imports?: ReadonlyArray<string>
  readonly code?: string
  readonly map?: { readonly sources: ReadonlyArray<string>; readonly mappings: string } | null
}

/**
 * An app's size, built as it ships: a Vite app build of its entry, and of each page beside it as
 * SolidStart builds a client's routes (`preserveEntrySignatures: "exports-only"`, #548). Measured as
 * what its first page loads: the app's chunk, its first page's when it has pages, and every chunk
 * either imports statically, each gzipped on its own as a page fetches them. `undefined` when the
 * base can't build it.
 */
const appSizeOf = async (root: string, deps: string, app: App, entry: string, side: string): Promise<Size | undefined> => {
  const pages = (app.pages ?? []).map((source, i) => {
    const file = join(root, "apps", `${app.name}-${["plain", "drags", "moves"][i]}.tsx`)
    writeFileSync(file, source)
    return file
  })
  const built = await build({
    configFile: false,
    logLevel: "error",
    mode: "production",
    root,
    plugins: [sideResolver(root, deps), Bool.match(app.v2, { onTrue: () => solid2({ dev: false }), onFalse: () => solid() })],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist", app.name),
      minify: true,
      target: [...APP_TARGET],
      sourcemap: true,
      write: false,
      rollupOptions: { input: [entry, ...pages], preserveEntrySignatures: "exports-only" },
    },
  }).then(
    (output) => output,
    (error: unknown) => {
      if (side === "head") throw error
      return undefined
    },
  )
  if (Predicate.isUndefined(built)) return undefined
  const chunks = ([built].flat() as ReadonlyArray<{ readonly output: ReadonlyArray<Chunk> }>).flatMap((o) => o.output).filter((c) => c.type === "chunk")
  const byName = new Map(chunks.map((c) => [c.fileName, c]))
  const entryOf = (file: string): Chunk => chunks.find((c) => c.isEntry === true && c.facadeModuleId === file)!
  // What the first page loads: the app's and that page's chunks, and their static imports.
  const loaded = new Set<string>()
  const visit = (chunk: Chunk): void => {
    if (loaded.has(chunk.fileName)) return
    loaded.add(chunk.fileName)
    for (const imported of chunk.imports ?? []) visit(byName.get(imported)!)
  }
  visit(entryOf(entry))
  Arr.forEach(Arr.take(pages, 1), (page) => visit(entryOf(page)))
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>
  let min = 0
  let gz = 0
  let br = 0
  for (const file of loaded) {
    const chunk = byName.get(file)!
    const js = Buffer.from(chunk.code!)
    min += js.length
    gz += gzipSync(js, { level: 9 }).length
    br += brotliCompressSync(js).length
    if (chunk.map) {
      const per = bytesByGroup(chunk.code!, chunk.map)
      for (const g of GROUPS) groups[g] += per[g]
    }
  }
  return { min, gz, br, groups }
}

/** Build every app on one side: its sources from `commit` (the working tree when undefined). */
const sizesOf = async (side: string, commit: string | undefined, deps: string): Promise<ReadonlyMap<string, Size>> => {
  const root = join(OUT, side)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, "apps"), { recursive: true })
  // With each package's manifest, so its `sideEffects: false` shakes the bundle as an app's install would.
  sourcesInto(root, commit, true)
  // vite-plugin-solid's Babel reads the JSX import source from a package's own node_modules.
  if (!existsSync(join(root, "node_modules"))) symlinkSync(join(deps, "packages/solid/node_modules"), join(root, "node_modules"))
  const sizes = new Map<string, Size>()
  for (const app of APPS) {
    const entry = join(root, "apps", `${app.name}.tsx`)
    writeFileSync(entry, app.source)
    // An app the base can't build is one the head adds (its API is new): reported, not gated.
    const size = await appSizeOf(root, deps, app, entry, side)
    if (Predicate.isNotUndefined(size)) sizes.set(app.name, size)
  }
  return sizes
}

const base = arg("base", "main")
const headRef = arg("head", "")
const baseCommit = commitOf(base)
const headCommit = Bool.match(headRef.length > 0, { onTrue: (): string | undefined => commitOf(headRef), onFalse: constUndefined })
const dirty =
  execSync(`git status --porcelain -- ${PACKAGES.map((pkg) => `packages/${pkg}/src`).join(" ")}`, { cwd: REPO }).toString().trim().length > 0
const headLabel = UndefinedOr.match(headCommit, {
  onUndefined: () => Bool.match(dirty, { onTrue: () => "the working tree (modified)", onFalse: () => "the working tree" }),
  onDefined: (commit) => `${headRef} (${commit.slice(0, 7)})`,
})
console.log(`size: base ${base} (${baseCommit.slice(0, 7)}) against ${headLabel}`)

const baseSizes = await sizesOf("base", baseCommit, depsOf(baseCommit))
const headSizes = await sizesOf("head", headCommit, UndefinedOr.match(headCommit, { onUndefined: () => REPO, onDefined: depsOf }))

const kb = (bytes: number): string => (bytes / 1024).toFixed(1)
const pad = (text: string, width: number): string => text.padStart(width)
const change = (head: number, base: number): string => {
  const percent = ((head / base - 1) * 100).toFixed(1)
  return Bool.match(head >= base, { onTrue: () => `+${percent}%`, onFalse: () => `${percent}%` })
}

let failed = false
console.log("\nKB; gzip at level 9, brotli at its default; gated on gzip, head against base (+1%)")
console.log(`${"app".padEnd(14)}${pad("min", 9)}${pad("gzip", 15)}${pad("change", 9)}${pad("brotli", 15)}   gate`)
for (const app of APPS) {
  const h = headSizes.get(app.name)!
  const b = baseSizes.get(app.name)
  if (b === undefined) {
    console.log(`${app.name.padEnd(14)}${pad(kb(h.min), 9)}${pad(`new → ${kb(h.gz)}`, 15)}${pad("", 9)}${pad(`new → ${kb(h.br)}`, 15)}   new`)
    continue
  }
  const fails = h.gz > b.gz * GATE
  if (fails) failed = true
  console.log(
    `${app.name.padEnd(14)}${pad(kb(h.min), 9)}${pad(`${kb(b.gz)} → ${kb(h.gz)}`, 15)}${pad(change(h.gz, b.gz), 9)}${pad(`${kb(b.br)} → ${kb(h.br)}`, 15)}   ${
      Bool.match(fails, { onTrue: () => "FAIL", onFalse: () => "ok" })
    }`,
  )
}

console.log("\nbudgets: gzip KB, the head at most")
for (const [name, budget] of Object.entries(BUDGETS)) {
  const h = headSizes.get(name)!
  const over = h.gz > budget * 1024
  if (over) failed = true
  console.log(`${name.padEnd(14)}${pad(kb(h.gz), 9)} of ${budget}   ${Bool.match(over, { onTrue: () => "FAIL", onFalse: () => "ok" })}`)
}

console.log("\nthe head's minified KB by package (change from the base)")
console.log(`${"app".padEnd(14)}${GROUPS.map((g) => pad(g, 15)).join("")}`)
for (const app of APPS) {
  const h = headSizes.get(app.name)!
  const b = UndefinedOr.match(baseSizes.get(app.name), { onUndefined: () => h, onDefined: (given) => given })
  console.log(
    `${app.name.padEnd(14)}${GROUPS.map((g) => {
      const delta = h.groups[g] - b.groups[g]
      const shown = Bool.match(Math.abs(delta) < 51, { onTrue: () => "", onFalse: () => ` (${Bool.match(delta > 0, { onTrue: () => "+", onFalse: () => "" })}${kb(delta)})` })
      return pad(`${kb(h.groups[g])}${shown}`, 15)
    }).join("")}`,
  )
}
process.exit(Bool.match(failed, { onTrue: () => 1, onFalse: () => 0 }))
