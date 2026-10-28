/**
 * `bun run skills`: copies the agent skills Wardic's libraries ship into `.claude/skills/`, from the
 * versions installed here, so an agent working in this repo reads the guidance for the versions in
 * use. Rerun it after bumping `solid-js-2` (Solid 2, installed under that alias in packages/solid),
 * `@solidjs/web`, `@solidjs/diagnostics` or `effect`; never edit the copies.
 *
 * - **Solid 2** ships skills in its packages: `solid-js`' `skills/` (the 2.0 primer, its cheatsheet,
 *   the reactivity diagnostics), `@solidjs/web`'s (server components) and `@solidjs/diagnostics`'
 *   (agent loops, on its `captureArtifact`). Each is copied as it is.
 * - **Effect 4** ships no skill: its agent guide is the package's `AGENTS.md`, copied as the `effect-4`
 *   skill under front matter of our own.
 *
 * The skills it copied last are listed in `.claude/skills/.library-skills.json`, and only those are
 * replaced, so a skill of the repo's own beside them is left alone.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const OUT = join(ROOT, ".claude/skills")
const MANIFEST = join(OUT, ".library-skills.json")

/** Where packages/solid's dependencies are installed: Solid 2 lives there as `solid-js-2`. */
const SOLID = join(ROOT, "packages/solid/node_modules")

/** A package's directory and version, read from where it's installed. */
const installed = (dir: string): { readonly dir: string; readonly version: string } => {
  if (!existsSync(join(dir, "package.json"))) throw new Error(`skills: ${dir} isn't installed; run bun install first`)
  return { dir, version: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version as string }
}

/** What each copy says about where it came from, after its front matter. */
const provenance = (from: string): string =>
  `<!-- Copied from ${from} by scripts/sync-agent-skills.ts: run \`bun run skills\` after a bump, and don't edit this copy. -->\n`

/** `text` with `note` after its front matter. */
const withNote = (text: string, note: string): string => {
  const end = text.indexOf("\n---", 3)
  if (!text.startsWith("---") || end === -1) return note + text
  const cut = text.indexOf("\n", end + 1) + 1
  return `${text.slice(0, cut)}\n${note}${text.slice(cut)}`
}

const copied: Array<{ readonly skill: string; readonly from: string }> = []

/** Each skill in `pkg`'s `skills/`, copied whole, its SKILL.md noted. */
const copySkills = (name: string, dir: string): void => {
  const pkg = installed(dir)
  const skills = join(pkg.dir, "skills")
  for (const skill of readdirSync(skills, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue
    const to = join(OUT, skill.name)
    cpSync(join(skills, skill.name), to, { recursive: true })
    const from = `${name}@${pkg.version}`
    const file = join(to, "SKILL.md")
    writeFileSync(file, withNote(readFileSync(file, "utf8"), provenance(from)))
    copied.push({ skill: skill.name, from })
  }
}

/** Effect's `AGENTS.md`, as the `effect-4` skill. */
const copyEffect = (): void => {
  const pkg = installed(join(SOLID, "effect"))
  const from = `effect@${pkg.version}`
  const front = [
    "---",
    "name: effect-4",
    "description: >-",
    `  The Effect 4 library's own guide for agents (${from}'s AGENTS.md): Effect.gen and Effect.fn, schemas,`,
    "  services as Context.Service, errors, resources and Scope, streams, schedules, observability, testing",
    "  with @effect/vitest, runtime type guards. Use when writing or reviewing Effect code in this repo; it",
    "  describes Effect 4, where older Effect guidance (Effect 3's Context.Tag, Effect.Service, and Either,",
    "  now Result) no longer applies. Wardic's own rules on top are docs/agents/effect-first.md.",
    "---",
    "",
  ].join("\n")
  const to = join(OUT, "effect-4")
  mkdirSync(to, { recursive: true })
  writeFileSync(join(to, "SKILL.md"), front + "\n" + provenance(from) + "\n" + readFileSync(join(pkg.dir, "AGENTS.md"), "utf8"))
  copied.push({ skill: "effect-4", from })
}

mkdirSync(OUT, { recursive: true })
// The skills copied last time go first, so one a library dropped doesn't linger.
if (existsSync(MANIFEST)) {
  for (const { skill } of JSON.parse(readFileSync(MANIFEST, "utf8")) as ReadonlyArray<{ readonly skill: string }>) {
    rmSync(join(OUT, skill), { recursive: true, force: true })
  }
}
copySkills("solid-js", join(SOLID, "solid-js-2"))
copySkills("@solidjs/web", join(SOLID, "@solidjs/web"))
copySkills("@solidjs/diagnostics", join(SOLID, "@solidjs/diagnostics"))
copyEffect()
writeFileSync(MANIFEST, `${JSON.stringify(copied, null, 2)}\n`)
for (const { skill, from } of copied) console.log(`skills: ${skill} from ${from}`)
