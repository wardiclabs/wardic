/**
 * `bun run bench:three [--base <ref>] [--head <ref>] [--reps 11] [--engines bun,node] [--n 1000]`
 *
 * Three's frame bench (#883's PR 5b, ADR-0073 decision 27): `--head`'s core, object and three (default:
 * the working tree) against `--base`'s (default: `main`), both through `harness.ts`, at N meshes or
 * instances, in Bun and Node, by bench:core's driver (`packages/core/bench/driver.ts`): its paired reps,
 * its gate (a median past +5% with its 25th percentile above 0%, Node's bytes a frame past +5%), and a
 * rerun before failing. `three/matrices x10`, three's own code alone, is its noise control.
 *
 * The Solid hooks' workloads (#885's PR 6) run a side's own `@wardic/three/solid` and `@wardic/solid`, so a
 * side is its core, dom, solid, object and three. Bun's bundler compiles JSX as React's, so each side's
 * `@wardic/solid` is compiled first, in its copy, by Solid 2's compile (`vite.solid2.ts`'s), and bundled as
 * the JavaScript it then is. Each side builds for production, as an app ships: Bun's bundler otherwise
 * resolves the `development` condition, Solid's dev build among it.
 *
 * No browser: the bench box draws WebGL in software, so a GPU's upload isn't measured. Runs on the bench
 * box, after `wardic-quiet`, not in CI.
 */
// ADR-0073 *Amendment (#883)*, PR 5's Q7.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { run } from "../../core/bench/driver.ts"
import { compileSolid2 } from "../../solid/vite.solid2.ts"

/** Each `.tsx` of a side's `@wardic/solid`, at `root`, compiled in place by Solid 2's compile, without its dev checks. */
const compiled = (root: string): void => {
  const src = join(root, "packages", "solid", "src")
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".tsx")) continue
    const path = join(src, file)
    writeFileSync(path, compileSolid2(readFileSync(path, "utf8"), path, { dev: false }))
  }
}

await run({
  name: "bench:three",
  folder: "bench-three",
  packages: ["core", "dom", "solid", "object", "three"],
  harness: "packages/three/bench/harness.ts",
  modules: { stage: "three/src/solid.ts", solid: "solid/src/index.tsx" },
  prepare: compiled,
  // What `compiled` wrote is JavaScript: Bun's TSX parser crashed on Solid's output.
  build: ["--loader", ".tsx:js", "--production"],
  noise: "three/matrices x10",
  engines: "bun,node",
  counts: "meshes or instances (a workload marked x10 or x100, ten or a hundred times)",
})
