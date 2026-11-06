/**
 * `bun run version-packages`'s second half (#559): after `changeset version` has moved the packages'
 * versions, the places that copy them follow.
 *
 * - **`bun.lock`:** each workspace's version. Bun keeps the version a workspace had when the lockfile
 *   was written, and doesn't count a stale one as a change (`--frozen-lockfile` passes); but
 *   `bun pm pack` writes a `workspace:*` dependency as the version the lockfile has, so
 *   `@wardic/dom@1.0.0-rc.1` would name `@wardic/core@0.1.0-alpha.0`.
 * - **`VERSION`:** the constant a package's `src/index.ts` exports (`@wardic/dom`, `@wardic/solid`,
 *   `@wardic/test`). Changesets doesn't touch source, so 1.0.0-rc.1 shipped `"0.1.0-alpha.0"`.
 *
 *   bun scripts/sync-versions.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const LOCKFILE = join(ROOT, "bun.lock")
const PACKAGES = ["core", "dom", "solid", "test"] as const

/** The `version` in `dir`'s `package.json`, if it has one. */
const versionIn = (dir: string): string | undefined => {
  const manifest = join(dir, "package.json")
  if (!existsSync(manifest)) return undefined
  return (JSON.parse(readFileSync(manifest, "utf8")) as { readonly version?: string }).version
}

let lock = readFileSync(LOCKFILE, "utf8")
// Each workspace's entry: its path, then its name and version on the lines after it.
const entries = [...lock.matchAll(/^ {4}"([^"]*)": \{\n {6}"name": "([^"]+)",\n {6}"version": "([^"]+)"/gm)]
for (const [entry, path, name, locked] of entries) {
  const version = versionIn(join(ROOT, path!))
  if (version === undefined || version === locked) continue
  lock = lock.replace(entry, entry.replace(`"version": "${locked}"`, `"version": "${version}"`))
  console.log(`bun.lock: ${name} ${locked} → ${version}`)
}
writeFileSync(LOCKFILE, lock)

for (const pkg of PACKAGES) {
  const dir = join(ROOT, "packages", pkg)
  const index = join(dir, "src", "index.ts")
  const source = readFileSync(index, "utf8")
  const constant = /^export const VERSION = "([^"]*)"$/m.exec(source)
  const version = versionIn(dir)
  if (constant === null || version === undefined || constant[1] === version) continue
  writeFileSync(index, source.replace(constant[0], `export const VERSION = "${version}"`))
  console.log(`@wardic/${pkg} VERSION: ${constant[1]} → ${version}`)
}
