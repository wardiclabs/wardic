/**
 * `bun run bench:three [--base <ref>] [--head <ref>] [--reps 11] [--engines bun,node] [--n 1000]`
 *
 * Three's frame bench (#883's PR 5b, ADR-0073 decision 27): `--head`'s core, object and three (default:
 * the working tree) against `--base`'s (default: `main`), both through `harness.ts`, at N meshes or
 * instances, in Bun and Node, by bench:core's driver (`packages/core/bench/driver.ts`): its paired reps,
 * its gate (a median past +5% with its 25th percentile above 0%, Node's bytes a frame past +5%), and a
 * rerun before failing. `three/matrices x10`, three's own code alone, is its noise control.
 *
 * No browser: the bench box draws WebGL in software, so a GPU's upload isn't measured. Runs on the bench
 * box, after `wardic-quiet`, not in CI.
 */
// ADR-0073 *Amendment (#883)*, PR 5's Q7.
import { run } from "../../core/bench/driver.ts"

await run({
  name: "bench:three",
  folder: "bench-three",
  packages: ["core", "object", "three"],
  harness: "packages/three/bench/harness.ts",
  noise: "three/matrices x10",
  engines: "bun,node",
  counts: "meshes or instances (a workload marked x10 or x100, ten or a hundred times)",
})
