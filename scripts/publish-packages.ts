/**
 * `bun run release` (#559): publishes the four packages, after `bun run build`, from the release
 * workflow once its "Version Packages" PR has merged.
 *
 * 1. Each package whose version npm doesn't have yet, in dependency order (`core`, then `dom` and
 *    `test`, then `solid`), so a package never names a version of another that isn't out. A version
 *    npm has is skipped, so a run that failed halfway can run again.
 * 2. Packed by Bun, which writes `workspace:*` dependencies as the version they point at (npm's own
 *    pack would leave them), as the tarball check (#554) packs them. Bun takes that version from
 *    `bun.lock`, which `bun run version-packages` keeps in step; a tarball whose `@wardic/*`
 *    dependencies name any other version than its own isn't published.
 * 3. Published with npm, which brings trusted publishing (OIDC) and provenance: on the `next` tag
 *    while Changesets is in pre mode (`1.0.0-rc.N`), else `latest`.
 * 4. Each one published is tagged `@wardic/<name>@<version>` in git and printed as `New tag: …`,
 *    which changesets/action reads to push the tag and make it a GitHub release.
 *
 *   bun scripts/publish-packages.ts [--dry-run]
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const PACKAGES = ["core", "dom", "test", "solid"] as const
const DRY_RUN = process.argv.includes("--dry-run")

/** `command args` in `cwd`, its output passed through; throws on a non-zero exit. */
const run = (command: string, args: ReadonlyArray<string>, cwd: string = ROOT): void => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`)
}

/** Whether npm has `name` at `version`: a package npm has never seen answers E404. */
const published = (name: string, version: string): boolean => {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { cwd: ROOT, encoding: "utf8" })
  if (result.status === 0) return result.stdout.trim() === version
  if (result.stderr.includes("E404")) return false
  throw new Error(`npm view ${name}@${version} failed:\n${result.stderr}`)
}

/** Changesets' pre mode, read from `.changeset/pre.json`: in it, releases go to `next`. */
const inPreMode = (): boolean => {
  const file = join(ROOT, ".changeset", "pre.json")
  if (!existsSync(file)) return false
  return (JSON.parse(readFileSync(file, "utf8")) as { readonly mode: string }).mode === "pre"
}

const TAG: Record<"true" | "false", string> = { true: "next", false: "latest" }
const tag = TAG[String(inPreMode()) as "true" | "false"]
const tarballs = mkdtempSync(join(tmpdir(), "wardic-publish-"))

for (const pkg of PACKAGES) {
  const dir = join(ROOT, "packages", pkg)
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { readonly name: string; readonly version: string }
  if (published(name, version)) {
    console.log(`${name}@${version} is on npm already: skipped`)
    continue
  }
  run("bun", ["pm", "pack", "--destination", tarballs, "--quiet"], dir)
  const tarball = readdirSync(tarballs).find((file) => file.startsWith(`wardic-${pkg}-${version}`))
  if (tarball === undefined) throw new Error(`bun pm pack wrote no tarball for ${name}@${version}`)
  // The four are one fixed group: each names the others at its own version.
  const packed = spawnSync("tar", ["-xzOf", join(tarballs, tarball), "package/package.json"], { encoding: "utf8" })
  const dependencies = (JSON.parse(packed.stdout) as { readonly dependencies?: Record<string, string> }).dependencies ?? {}
  const stale = Object.entries(dependencies).filter(([dependency, range]) => dependency.startsWith("@wardic/") && range !== version)
  if (stale.length > 0) throw new Error(`${name}@${version}'s tarball names ${stale.map(([d, r]) => `${d}@${r}`).join(", ")}: run bun run version-packages`)
  const flags = ["--access", "public", "--tag", tag, "--provenance"]
  if (DRY_RUN) {
    console.log(`would publish ${join(tarballs, tarball)} ${flags.join(" ")}`)
    continue
  }
  run("npm", ["publish", join(tarballs, tarball), ...flags])
  run("git", ["tag", `${name}@${version}`])
  console.log(`New tag: ${name}@${version}`)
}
