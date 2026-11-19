/// <reference types="node" />
/**
 * A side of a comparison, built as an app ships it: a commit's (or the working tree's)
 * `packages/{core,dom,solid,foldkit}/src`, its bare imports resolved in that commit's dependencies.
 * `bench:solid` (`run.ts`), `bench:foldkit` (`packages/foldkit/bench/run.ts`, #795) and `bun run size`
 * (`size.ts`, #511) build their base and head this way.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin, PluginOption } from "vite"
import solid from "vite-plugin-solid"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"
import { solid1 } from "../vite.solid1.ts"
import { solid2 } from "../vite.solid2.ts"

/** The packages a side builds from: a commit from before one of them (#795's `foldkit`) builds from the ones it has. */
export const PACKAGES = ["core", "dom", "solid", "foldkit"] as const
export type Package = (typeof PACKAGES)[number]

/**
 * The browsers a side is built for: what an app ships to by default, Vite 8's
 * `baseline-widely-available` (#525). Class fields stay native there. Vite 6's default (`modules`,
 * es2020), which built the sides before, rewrote each into an `Object.defineProperty` call, a cost
 * apps on Vite 7 and later don't pay, Wardic's own storefronts (Vite 8, `esnext`) among them.
 */
export const APP_TARGET: ReadonlyArray<string> = ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"]

/** The repo's root. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

/** `ref`'s commit. */
export const commitOf = (ref: string): string =>
  execSync(`git rev-parse --verify ${JSON.stringify(`${ref}^{commit}`)}`, { cwd: REPO }).toString().trim()

const installedLock = readFileSync(join(REPO, "bun.lock"), "utf8")

/** Where a commit's dependencies come from: the repo's own install, or `bench:core`'s checkout of it. */
export const depsOf = (commit: string): string => {
  const lock = execSync(`git show ${commit}:bun.lock`, { cwd: REPO, maxBuffer: 1 << 26 }).toString()
  if (lock === installedLock) return REPO
  const tree = join(REPO, ".tmp/bench-core/deps", commit)
  if (!existsSync(tree)) {
    execSync(`git worktree add --detach ${JSON.stringify(tree)} ${commit}`, { cwd: REPO, stdio: "ignore" })
  }
  if (!existsSync(join(tree, "node_modules"))) {
    console.log(`bench: ${commit.slice(0, 7)} has its own bun.lock, installing it at ${tree}`)
    execSync("bun install --frozen-lockfile", { cwd: tree, stdio: "ignore" })
  }
  return tree
}

/** Whether `commit` (the working tree when undefined) has `path`. */
export const commitHas = (commit: string | undefined, path: string): boolean =>
  UndefinedOr.match(commit, {
    onUndefined: () => existsSync(join(REPO, path)),
    onDefined: (c) => {
      try {
        execSync(`git cat-file -e ${c}:${path}`, { cwd: REPO, stdio: "ignore" })
        return true
      } catch {
        return false
      }
    },
  })

/**
 * Put the packages' `src` under `root/packages`: from `commit`, or the working tree when it's
 * undefined; a package the side doesn't have yet is left out. With `manifests`, each package's
 * `package.json` too, so a bundler reads its `sideEffects` as an app's would (`size.ts`); the benches
 * build their pages without them.
 */
export const sourcesInto = (root: string, commit: string | undefined, manifests = false): void => {
  const paths = PACKAGES.filter((pkg) => commitHas(commit, `packages/${pkg}/src`)).flatMap((pkg) => {
    if (manifests) return [`packages/${pkg}/src`, `packages/${pkg}/package.json`]
    return [`packages/${pkg}/src`]
  })
  if (commit === undefined) {
    for (const path of paths) cpSync(join(REPO, path), join(root, path), { recursive: true })
    return
  }
  execSync(`git archive ${commit} ${paths.join(" ")} | tar -x -C ${JSON.stringify(root)}`, { cwd: REPO })
}

/** A `@wardic/*` subpath that's a folder, not a module: its index, without its extension. */
const SUBPATHS: Readonly<Record<string, string>> = { "unstable/v2": "unstable/v2/index", v1: "v1/index" }

/**
 * `@wardic/foldkit`'s subpath whose module a production browser build gets from its `exports`'
 * conditions, not by its name (#795): `internal/dev` is `dev.production` (`DEV` false). `internal/server`
 * needs no entry: its name is the browser's module, `server` (`IS_SERVER` false).
 */
const FOLDKIT_SUBPATHS: Readonly<Record<string, string>> = { "internal/dev": "internal/dev.production" }

/** A package's module for `sub`, its root's for none: the module itself, or a folder's index. */
const subpathModuleOf = (sub: string | undefined, pkg?: Package): string =>
  UndefinedOr.match(sub, {
    onUndefined: () => "index",
    onDefined: (name) =>
      Option.getOrElse(Option.fromUndefinedOr(Bool.match(pkg === "foldkit", { onTrue: () => FOLDKIT_SUBPATHS[name], onFalse: () => SUBPATHS[name] })), () => name),
  })

/**
 * Where a side from before #566 (no `src/v1`) had each binding the pages and apps name as after it: Solid 2's
 * root at `unstable/v2`, Solid 1's `v1` at the root.
 */
const BEFORE_SWAP: Readonly<Record<string, string>> = { index: "unstable/v2/index", "v1/index": "index" }

/** `@wardic/solid`'s module for `sub` on a side, the binding it names as after #566 on a side from before it too. */
const solidModuleOf = (root: string, sub: string | undefined): string => {
  const module = subpathModuleOf(sub)
  if (existsSync(join(root, "packages/solid/src/v1"))) return module
  return Option.getOrElse(Option.fromUndefinedOr(BEFORE_SWAP[module]), () => module)
}

/** A page's or an app's build plugins for its binding: Solid 2's compile, or Solid 1's resolution and vite-plugin-solid's compile. */
export const bindingPluginsOf = (v2: boolean): PluginOption =>
  Bool.match(v2, { onTrue: () => solid2({ dev: false }), onFalse: () => [solid1(), solid()] })

/** The bindings an app is built on (#795): the two Solid ones, and Foldkit's. */
export type Binding = "solid1" | "solid2" | "foldkit"

/** What an app's build takes from its binding: its compile plugins, the package whose dependencies resolve its own bare imports, and its entry's extension. */
export interface BindingBuild {
  readonly plugins: () => PluginOption
  readonly importing: Package
  readonly ext: "ts" | "tsx"
}

/** Each binding's build (#795): the Solid compiles, or none, since a Foldkit app is plain TypeScript Vite builds as it is. */
export const BINDINGS: Readonly<Record<Binding, BindingBuild>> = {
  solid1: { plugins: () => bindingPluginsOf(false), importing: "solid", ext: "tsx" },
  solid2: { plugins: () => bindingPluginsOf(true), importing: "solid", ext: "tsx" },
  foldkit: { plugins: () => [], importing: "foldkit", ext: "ts" },
}

/**
 * A side's module `stem`: `.tsx` when the side has it, else `.ts`. `@wardic/solid`'s entries are `index.tsx`,
 * as they re-export components, and a base before that rename has `index.ts`.
 */
const moduleOf = (stem: string): string => Bool.match(existsSync(`${stem}.tsx`), { onTrue: () => `${stem}.tsx`, onFalse: () => `${stem}.ts` })

/** Whether a side's package declares its modules free of side effects, read from the manifest `sourcesInto` copied. */
const sideEffectsOf = (root: string, pkg: string): boolean => {
  const manifest = join(root, "packages", pkg, "package.json")
  if (!existsSync(manifest)) return true
  return JSON.parse(readFileSync(manifest, "utf8")).sideEffects !== false
}

/**
 * Resolve `@wardic/*` to the side's sources, and every other bare import as the importing package
 * would in `deps` (the page's or the app's own as `importing`'s, solid's by default; foldkit's for a
 * Foldkit page, #795): one copy of solid-js, foldkit and effect per side. A `@wardic/*` module keeps
 * its package's `sideEffects` when the side has its manifest, as Vite's own resolver would give an
 * installed package's (`size.ts`, #511); without one, Rollup's default, side effects.
 */
export const sideResolver = (root: string, deps: string, importing: Package = "solid"): Plugin => ({
  name: "bench-solid-resolve",
  enforce: "pre",
  async resolveId(source, importer, options) {
    const wardic = /^@wardic\/(core|dom|solid|foldkit)(?:\/(.+))?$/.exec(source)
    if (wardic !== null) {
      const pkg = wardic[1] as Package
      const sub = wardic[2]
      const id = moduleOf(join(
        root,
        "packages",
        pkg,
        "src",
        Bool.match(pkg === "solid", { onTrue: () => solidModuleOf(root, sub), onFalse: () => subpathModuleOf(sub, pkg) }),
      ))
      return { id, moduleSideEffects: sideEffectsOf(root, pkg) }
    }
    if (importer === undefined || !importer.startsWith(root)) return null
    if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null
    const pkg = /\/packages\/(core|dom|solid|foldkit)\/src\//.exec(importer)?.[1] ?? importing
    return this.resolve(source, join(deps, "packages", pkg, "src/index.ts"), { ...options, skipSelf: true })
  },
})
