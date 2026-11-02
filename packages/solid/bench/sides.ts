/// <reference types="node" />
/**
 * A side of a comparison, built as an app ships it: a commit's (or the working tree's)
 * `packages/{core,dom,solid}/src`, its bare imports resolved in that commit's dependencies.
 * `bench:solid` (`run.ts`) and `bun run size` (`size.ts`, #511) build their base and head this way.
 */
import { execSync } from "node:child_process"
import { cpSync, existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import * as Option from "effect/Option"
import * as UndefinedOr from "effect/UndefinedOr"

/** The packages a side builds from. */
export const PACKAGES = ["core", "dom", "solid"] as const

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

/**
 * Put the three packages' `src` under `root/packages`: from `commit`, or the working tree when it's
 * undefined. With `manifests`, each package's `package.json` too, so a bundler reads its
 * `sideEffects` as an app's would (`size.ts`); `bench:solid` builds its pages without them.
 */
export const sourcesInto = (root: string, commit: string | undefined, manifests = false): void => {
  const paths = PACKAGES.flatMap((pkg) => {
    if (manifests) return [`packages/${pkg}/src`, `packages/${pkg}/package.json`]
    return [`packages/${pkg}/src`]
  })
  if (commit === undefined) {
    for (const path of paths) cpSync(join(REPO, path), join(root, path), { recursive: true })
    return
  }
  execSync(`git archive ${commit} ${paths.join(" ")} | tar -x -C ${JSON.stringify(root)}`, { cwd: REPO })
}

/** A `@wardic/*` subpath that's a folder, not a module: its index. */
const SUBPATHS: Readonly<Record<string, string>> = { "unstable/v2": "unstable/v2/index.ts" }

/** Whether a side's package declares its modules free of side effects, read from the manifest `sourcesInto` copied. */
const sideEffectsOf = (root: string, pkg: string): boolean => {
  const manifest = join(root, "packages", pkg, "package.json")
  if (!existsSync(manifest)) return true
  return JSON.parse(readFileSync(manifest, "utf8")).sideEffects !== false
}

/**
 * Resolve `@wardic/*` to the side's sources, and every other bare import as the importing package
 * would in `deps` (the page as solid): one copy of solid-js and effect per side. A `@wardic/*`
 * module keeps its package's `sideEffects` when the side has its manifest, as Vite's own resolver
 * would give an installed package's (`size.ts`, #511); without one, Rollup's default, side effects.
 */
export const sideResolver = (root: string, deps: string): Plugin => ({
  name: "bench-solid-resolve",
  enforce: "pre",
  async resolveId(source, importer, options) {
    const wardic = /^@wardic\/(core|dom|solid)(?:\/(.+))?$/.exec(source)
    if (wardic !== null) {
      const [, pkg, sub] = wardic
      const id = join(
        root,
        "packages",
        pkg!,
        "src",
        UndefinedOr.match(sub, {
          onUndefined: () => "index.ts",
          onDefined: (name) => Option.getOrElse(Option.fromUndefinedOr(SUBPATHS[name]), () => `${name}.ts`),
        }),
      )
      return { id, moduleSideEffects: sideEffectsOf(root, pkg!) }
    }
    if (importer === undefined || !importer.startsWith(root)) return null
    if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null
    const pkg = /\/packages\/(core|dom|solid)\/src\//.exec(importer)?.[1] ?? "solid"
    return this.resolve(source, join(deps, "packages", pkg, "src/index.ts"), { ...options, skipSelf: true })
  },
})
