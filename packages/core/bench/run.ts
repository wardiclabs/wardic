/**
 * `bun run bench:core [--base <ref>] [--head <ref>] [--reps 11] [--engines bun,node,chromium] [--n 1000]`
 *
 * Core's frame bench (#63, ADR-0025): `--head`'s core (default: the working tree) against
 * `--base`'s (default: `main`), both through `harness.ts`, at N elements, in Bun, Node and
 * Chromium, by the frame benches' driver (`driver.ts`: its paired reps, noise control, gates and
 * reruns). `ticksOnly` is its noise control.
 */
// #883's PR 5b: the driver is `bench:three`'s too.
import { run } from "./driver.ts"

await run({
  name: "bench:core",
  folder: "bench-core",
  packages: ["core"],
  harness: "packages/core/bench/harness.ts",
  noise: "ticksOnly",
  engines: "bun,node,chromium",
  counts: "elements (a loop workload with a scale, ten times: #545)",
})
