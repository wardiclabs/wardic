// One rep of core's frame bench in a fresh Bun or Node process: load a bundle, run it with the
// options in argv[3] (JSON), print the results as JSON. Under Node with --expose-gc it also
// hands the harness a heap hook, so it can report bytes allocated per frame.
//
// The hook counts allocation as the used heap plus every byte a GC has freed, read from a
// v8.GCProfiler, which reports synchronously. A PerformanceObserver on "gc" reports as a task,
// and a measured window only awaits microtasks, so it never saw a scavenge inside one: the heap
// delta lost what the scavenge freed, and the core that allocated more was under-counted more
// (#65).
const node = typeof process.versions.bun === "undefined"
if (node && typeof globalThis.gc === "function") {
  const { GCProfiler } = await import("node:v8")
  let freed = 0
  let profiler = new GCProfiler()
  profiler.start()
  /** Add what each GC since the last call freed, and start counting again. */
  const drain = () => {
    for (const gc of profiler.stop().statistics) {
      freed += gc.beforeGC.heapStatistics.usedHeapSize - gc.afterGC.heapStatistics.usedHeapSize
    }
    profiler = new GCProfiler()
    profiler.start()
  }
  globalThis.__mem = {
    gc: () => globalThis.gc(),
    allocated: () => {
      drain()
      return process.memoryUsage().heapUsed + freed
    },
  }
}
await import(process.argv[2])
console.log(JSON.stringify(await globalThis.__wardicBench(JSON.parse(process.argv[3]))))
