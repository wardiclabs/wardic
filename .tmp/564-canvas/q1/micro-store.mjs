// PROTOTYPE Q1: does a keyed double store into a record allocate in V8? node --expose-gc micro-store.mjs
import { GCProfiler } from "node:v8"
let freed = 0, profiler = new GCProfiler(); profiler.start()
const allocated = () => { for (const gc of profiler.stop().statistics) freed += gc.beforeGC.heapStatistics.usedHeapSize - gc.afterGC.heapStatistics.usedHeapSize; profiler = new GCProfiler(); profiler.start(); return process.memoryUsage().heapUsed + freed }
const keys = ["x", "y", "z", "rotateY", "scale"]
const build = () => keys.reduce((r, k) => { r[k] = 0.5; return r }, {})
const N = 2_000_000
const run = (label, body) => {
  for (let i = 0; i < 200000; i++) body(i)
  gc(); const a0 = allocated(); const t0 = performance.now()
  for (let i = 0; i < N; i++) body(i)
  const ms = performance.now() - t0; const b = allocated() - a0
  console.log(label.padEnd(60), (ms * 1e6 / N).toFixed(1).padStart(6), "ns", (b / N).toFixed(1).padStart(6), "B/store")
}
const r1 = build(), r2 = build(), r3 = build(), r4 = build()
const f = new Float64Array(5)
const objs = Array.from({ length: 1000 }, build)
let s = 0
run("keyed store, one record, 5 keys", (i) => { r1[keys[i % 5]] = i * 0.25 })
run("named store r.x", (i) => { r2.x = i * 0.25 })
run("keyed store, 1000 records (like 1000 runs)", (i) => { objs[i % 1000][keys[i % 5]] = i * 0.25 })
run("Float64Array store", (i) => { f[i % 5] = i * 0.25 })
run("keyed store, int-valued", (i) => { r3[keys[i % 5]] = i })
console.log(s)
