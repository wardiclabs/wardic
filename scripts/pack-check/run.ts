/**
 * `bun run pack:check [fixture …] [--no-build]` (#554): the four packages as npm will have them, checked
 * before anything is published.
 *
 * 1. `bun run build`, then each package packed with `bun pm pack`, which writes `workspace:*`
 *    dependencies as the version they point at (npm's own pack would leave them).
 * 2. `are-the-types-wrong` on each tarball (ESM only: the packages ship no CommonJS), and `publint`.
 * 3. Each fixture (`fixtures/`), copied outside the workspace, installs the tarballs with npm, the rest
 *    from the registry, and builds:
 *    - `solid1-vite`: Solid 1 on Vite, client-rendered, through the `solid` condition;
 *    - `solid1-start`: SolidStart with Solid 1, rendered on the server and hydrated;
 *    - `solid2-start`: Solid 2 in `@solidjs/vite-plugin`'s start mode, the same, on `/unstable/v2`;
 *    - `compiled`: Vite with no Solid plugin, so `@wardic/solid/v1` is its compiled browser build (#566);
 *    - `foldkit-vite`: Foldkit on Vite, client-rendered, on `@wardic/foldkit` (#791);
 *    - `foldkit-ssr`: Foldkit rendered on a server (Node, at build time, into the client build's page)
 *      and hydrated through the Handle's `hydrate`, its Appear animation playing from first paint (#794).
 * 4. Each served by `vite preview` and opened in Chromium: no error in the console (a hydration
 *    mismatch is one), `#enter` animates to its target (from the `opacity: 0` the server rendered,
 *    where it renders), its Appear animation running at load and handed to its ward where the server
 *    sampled one, and `#drag`, under a `LazyWardic` loading `drag`, drags once it arrives.
 * 5. Node imports each binding's server build from a fixture, as a server would without a bundler:
 *    Solid's `dist/server`, Foldkit's `node` condition.
 *
 * Exits 1 when a step fails. It installs from the registry, so it needs the network. Its work folder,
 * in the system's temp folder, goes at the end unless `--keep`.
 */
import { execFileSync, spawn } from "node:child_process"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"

const ROOT = join(import.meta.dirname, "..", "..")
const FIXTURES = join(import.meta.dirname, "fixtures")
const PACKAGES = ["core", "dom", "solid", "test", "foldkit"] as const

interface Fixture {
  readonly name: string
  /** The `@wardic/*` packages it installs. */
  readonly installs: ReadonlyArray<(typeof PACKAGES)[number]>
  /** Whether the server renders the page. */
  readonly ssr: boolean
  /** What Node imports from it, to load a binding's server build: the specifier, and what the resolved path carries. */
  readonly nodeImport?: { readonly spec: string; readonly dist: string } | undefined
  /** Whether it has `#drag`, a lazily loaded drag element: the Foldkit fixtures don't until slice 3 (#791). */
  readonly drag?: boolean | undefined
  /** Whether the server samples `#enter`'s Appear animation (ADR-0044): running at load, handed to its ward. */
  readonly appear?: boolean | undefined
}

const ALL: ReadonlyArray<Fixture> = [
  { name: "solid1-vite", installs: ["core", "dom", "solid"], ssr: false },
  { name: "solid1-start", installs: ["core", "dom", "solid", "test"], ssr: true, nodeImport: { spec: "@wardic/solid/v1", dist: "/dist/server/v1/" } },
  { name: "solid2-start", installs: ["core", "dom", "solid"], ssr: true, nodeImport: { spec: "@wardic/solid/unstable/v2", dist: "/dist/server/" } },
  { name: "compiled", installs: ["core", "dom", "solid"], ssr: false },
  // `@wardic/foldkit` on Vite, client-rendered (#791, Q12): private until 1.2, packed and installed all the same.
  { name: "foldkit-vite", installs: ["core", "dom", "foldkit"], ssr: false, drag: false },
  // `@wardic/foldkit` server-rendered and hydrated (#794, Q12): Node's import reads the package's `node` condition.
  { name: "foldkit-ssr", installs: ["core", "dom", "foldkit"], ssr: true, nodeImport: { spec: "@wardic/foldkit/internal/server", dist: "/dist/internal/server.node.js" }, drag: false, appear: true },
]

const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const fixtures = ALL.filter((f) => asked.length === 0 || asked.includes(f.name))
const results: Array<{ readonly step: string; readonly problem?: string | undefined }> = []

/** Runs a step, recording it: ok, or the problem it threw. */
const step = async (name: string, run: () => Promise<void> | void): Promise<boolean> => {
  try {
    await run()
    results.push({ step: name })
    console.log(`ok    ${name}`)
    return true
  } catch (error) {
    let problem = String(error).slice(0, 600)
    if (error instanceof Error) problem = error.message.slice(0, 600)
    results.push({ step: name, problem })
    console.log(`FAIL  ${name}\n      ${problem.replaceAll("\n", "\n      ")}`)
    return false
  }
}

const sh = (command: string, args: ReadonlyArray<string>, cwd: string): string =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "" } })

const work = mkdtempSync(join(tmpdir(), "wardic-pack-check-"))
const tarballs = join(work, "tarballs")
console.log(`pack:check in ${work}`)

if (!process.argv.includes("--no-build")) await step("build", () => void sh("bun", ["run", "build"], ROOT))

const tarballOf: Record<string, string> = {}
for (const pkg of PACKAGES) {
  await step(`pack @wardic/${pkg}`, () => {
    sh("bun", ["pm", "pack", "--destination", tarballs, "--quiet"], join(ROOT, "packages", pkg))
    const file = readdirSync(tarballs).find((name) => name.startsWith(`wardic-${pkg}-`))
    if (file === undefined) throw new Error("no tarball")
    tarballOf[pkg] = join(tarballs, file)
  })
  await step(`are-the-types-wrong @wardic/${pkg}`, () => void sh(join(ROOT, "node_modules", ".bin", "attw"), [tarballOf[pkg]!, "--profile", "esm-only", "--format", "ascii"], ROOT))
  await step(`publint @wardic/${pkg}`, () => {
    const out = sh(join(ROOT, "node_modules", ".bin", "publint"), [join(ROOT, "packages", pkg), "--pack", "bun", "--level", "warning"], ROOT)
    if (/Errors:|Warnings:/.test(out)) throw new Error(out)
  })
}

/** Waits until `url` answers, or `ms` pass. */
const answers = async (url: string, ms: number): Promise<void> => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false)
    if (ok) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${url} didn't answer in ${ms} ms`)
}

const browser = await chromium.launch()
let port = 4141
for (const fixture of fixtures) {
  const dir = join(work, fixture.name)
  const ready = await step(`${fixture.name}: install and build`, () => {
    cpSync(join(FIXTURES, fixture.name), dir, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    // The tarballs, for the fixture and for each package that depends on another.
    const local = Object.fromEntries(fixture.installs.map((pkg) => [`@wardic/${pkg}`, `file:${tarballOf[pkg]}`]))
    manifest.dependencies = { ...manifest.dependencies, ...local }
    manifest.overrides = local
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2))
    sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir)
    sh("npm", ["run", "build"], dir)
  })
  if (!ready) continue

  if (fixture.nodeImport !== undefined) {
    const { spec, dist } = fixture.nodeImport
    await step(`${fixture.name}: node imports ${spec}'s server build`, () => {
      const out = sh("node", ["--input-type=module", "-e", `const m = await import(${JSON.stringify(spec)}); console.log(import.meta.resolve(${JSON.stringify(spec)}), Object.keys(m).length)`], dir)
      if (!out.includes(dist)) throw new Error(`resolved elsewhere: ${out}`)
    })
  }

  const base = `http://127.0.0.1:${port}`
  const server = spawn(join(dir, "node_modules", ".bin", "vite"), ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: dir, stdio: "ignore", detached: true })
  port += 1
  try {
    await step(`${fixture.name}: serves`, () => answers(base, 30_000))
    if (fixture.ssr) {
      await step(`${fixture.name}: the server renders the page`, async () => {
        const html = await fetch(base).then((r) => r.text())
        const enter = /<div[^>]*id="enter"[^>]*>/.exec(html)?.[0]
        if (enter === undefined) throw new Error("no #enter in the server's HTML")
        if (!/opacity:\s*0(;|")/.test(enter)) throw new Error(`#enter isn't rendered at its initial opacity: ${enter}`)
      })
    }
    const page = await browser.newPage()
    const errors: Array<string> = []
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300))
    })
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)))
    if (fixture.appear === true) {
      // The server's Appear animation (ADR-0044): read at the page's first paint, before any script. A
      // production page hydrates as soon as its script runs, so the script's request is answered a
      // second late, as a slow network would, and the element is read while the markup alone is there.
      await page.route(/\.js(\?.*)?$/, (route) => {
        setTimeout(() => void route.continue(), 1000)
      })
      await page.goto(base, { waitUntil: "commit" })
      await step(`${fixture.name}: #enter plays its Appear animation from first paint`, async () => {
        await page.waitForSelector("#enter")
        const running = await page.evaluate(() => {
          const enter = document.getElementById("enter")!
          return { animations: enter.getAnimations().length, inline: enter.style.animation }
        })
        if (running.animations === 0 || !running.inline.startsWith("var(--wardic-a")) throw new Error(`no Appear animation running at first paint: ${JSON.stringify(running)}`)
      })
      await page.waitForLoadState("load")
    } else {
      await page.goto(base, { waitUntil: "load" })
    }
    await step(`${fixture.name}: #enter animates to its target`, async () => {
      await page.waitForFunction(() => Number(getComputedStyle(document.getElementById("enter")!).opacity) > 0.99, undefined, { timeout: 5000 })
    })
    if (fixture.appear === true) await step(`${fixture.name}: #enter is handed to its ward`, async () => {
      await page.waitForFunction(() => {
        const enter = document.getElementById("enter")!
        return enter.style.animation === "" && enter.getAnimations().length === 0
      }, undefined, { timeout: 5000 })
    })
    if (fixture.drag !== false) await step(`${fixture.name}: #drag drags once its lazy \`drag\` arrives`, async () => {
      const until = Date.now() + 5000
      const target = page.locator("#drag")
      const start = (await target.boundingBox())!
      while (Date.now() < until) {
        const box = (await target.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 12 })
        await page.mouse.up()
        await page.waitForTimeout(150)
        const moved = (await target.boundingBox())!
        if (moved.x - start.x > 40) return
      }
      throw new Error("it never moved")
    })
    await step(`${fixture.name}: no error in the console`, () => {
      if (errors.length > 0) throw new Error(errors.join("\n"))
    })
    await page.close()
  } finally {
    if (server.pid !== undefined) process.kill(-server.pid)
  }
}
await browser.close()
if (!process.argv.includes("--keep")) rmSync(work, { recursive: true, force: true })

const failed = results.filter((r) => r.problem !== undefined)
let summary = `pack:check: ${results.length - failed.length} of ${results.length} steps passed`
if (failed.length > 0) summary += `; failed: ${failed.map((r) => r.step).join(", ")}`
console.log(`\n${summary}`)
process.exit(Math.min(failed.length, 1))
