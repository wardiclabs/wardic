// One rep of core's frame bench in a fresh Bun or Node process: load a bundle, run it with the
// options in argv[3] (JSON), print the results as JSON. Under Node with --expose-gc it also
// hands the harness a heap hook, so it can report bytes allocated per frame.
const node = typeof process.versions.bun === "undefined"
if (node && typeof globalThis.gc === "function") {
  const { PerformanceObserver } = await import("node:perf_hooks")
  let gcCount = 0
  new PerformanceObserver((list) => {
    gcCount += list.getEntries().length
  }).observe({ entryTypes: ["gc"] })
  globalThis.__mem = { gc: () => globalThis.gc(), heapUsed: () => process.memoryUsage().heapUsed, gcCount: () => gcCount }
}
await import(process.argv[2])
console.log(JSON.stringify(await globalThis.__wardicBench(JSON.parse(process.argv[3]))))
