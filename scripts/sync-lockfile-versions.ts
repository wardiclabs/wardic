/**
 * `bun run version-packages`'s second half (#559): each workspace's version in `bun.lock` set to its
 * `package.json`'s, after `changeset version` has moved them. Bun keeps the version a workspace had
 * when the lockfile was written, and doesn't count a stale one as a change (`--frozen-lockfile`
 * passes); but `bun pm pack` writes a `workspace:*` dependency as the version the lockfile has, so
 * `@wardic/dom@1.0.0-rc.1` would name `@wardic/core@0.1.0-alpha.0`.
 *
 *   bun scripts/sync-lockfile-versions.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const LOCKFILE = join(ROOT, "bun.lock")

let lock = readFileSync(LOCKFILE, "utf8")
// Each workspace's entry: its path, then its name and version on the lines after it.
const entries = [...lock.matchAll(/^ {4}"([^"]*)": \{\n {6}"name": "([^"]+)",\n {6}"version": "([^"]+)"/gm)]
for (const [entry, path, name, locked] of entries) {
  const manifest = join(ROOT, path!, "package.json")
  if (!existsSync(manifest)) continue
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { readonly version?: string }
  if (version === undefined || version === locked) continue
  lock = lock.replace(entry, entry.replace(`"version": "${locked}"`, `"version": "${version}"`))
  console.log(`bun.lock: ${name} ${locked} → ${version}`)
}
writeFileSync(LOCKFILE, lock)
