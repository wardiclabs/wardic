/// <reference types="node" />
/**
 * `bun run size [--base <ref>] [--head <ref>]` (#511, decision Q10): what an app ships for Wardic.
 *
 * - **The apps:** each binding's plain Solid app, one Complete element (`wardic.div` under a
 *   `WardicProvider`), and the same inside `<AnimatePresence>`; one Slim element (`w.div`) alone, the
 *   Slim element's base, and with each Feature (#511). An app the base can't build, its API new, is
 *   reported as new and not gated.
 * - **Each side is built as an app ships it,** as `bench:solid` builds its pages (`sides.ts`): Vite,
 *   production mode, minified, tree-shaken; Solid 1 through vite-plugin-solid, Solid 2 through the
 *   repo's `solid2({ dev: false })`.
 * - **Reported:** each app's minified, gzip (level 9) and brotli bytes, head against base, and the
 *   head's minified bytes split by package through its source map.
 * - **Gate:** an app fails when its gzip grows more than 1% over the base's. Sizes are deterministic,
 *   so no reps and no quiet host: it runs in seconds. Exits 1 when an app fails.
 *
 * Run it for any change to a package's `src` (`docs/agents/effect-first.md`'s *Checks*).
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { build } from "vite"
import solid from "vite-plugin-solid"
import * as Bool from "effect/Boolean"
import { constUndefined } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { solid2 } from "../vite.solid2.ts"
import { commitOf, depsOf, PACKAGES, REPO, sideResolver, sourcesInto } from "./sides.ts"

/** An app fails when its gzip passes this ratio of the base's. */
const GATE = 1.01

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

const APPS: ReadonlyArray<App> = [
  { name: "s1-plain", v2: false, source: plain("solid-js/web") },
  { name: "s1-complete", v2: false, source: complete("solid-js/web", "@wardic/solid", false) },
  { name: "s1-presence", v2: false, source: complete("solid-js/web", "@wardic/solid", true) },
  { name: "s1-slim", v2: false, source: slim("solid-js/web", "@wardic/solid", []) },
  { name: "s1-colors", v2: false, source: slim("solid-js/web", "@wardic/solid", ["colors"]) },
  { name: "s1-layout", v2: false, source: slim("solid-js/web", "@wardic/solid", ["layout"]) },
  { name: "s2-plain", v2: true, source: plain("@solidjs/web") },
  { name: "s2-complete", v2: true, source: complete("@solidjs/web", "@wardic/solid/unstable/v2", false) },
  { name: "s2-presence", v2: true, source: complete("@solidjs/web", "@wardic/solid/unstable/v2", true) },
  { name: "s2-slim", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", []) },
  { name: "s2-colors", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["colors"]) },
  { name: "s2-layout", v2: true, source: slim("@solidjs/web", "@wardic/solid/unstable/v2", ["layout"]) },
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
    const built = await build({
      configFile: false,
      logLevel: "error",
      mode: "production",
      root,
      plugins: [sideResolver(root, deps), Bool.match(app.v2, { onTrue: () => solid2({ dev: false }), onFalse: () => solid() })],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        outDir: join(root, "dist"),
        emptyOutDir: false,
        minify: true,
        sourcemap: true,
        lib: { entry, formats: ["es"], fileName: () => `${app.name}.js` },
      },
    }).then(
      () => true,
      (error: unknown) => {
        if (side === "head") throw error
        return false
      },
    )
    if (!built) continue
    const js = readFileSync(join(root, "dist", `${app.name}.js`))
    const map = JSON.parse(readFileSync(join(root, "dist", `${app.name}.js.map`), "utf8"))
    sizes.set(app.name, {
      min: js.length,
      gz: gzipSync(js, { level: 9 }).length,
      br: brotliCompressSync(js).length,
      groups: bytesByGroup(js.toString("utf8"), map),
    })
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
