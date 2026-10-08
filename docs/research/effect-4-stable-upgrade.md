# Effect `4.0.0-rc.117` → `4.0.2`: what changed for Wardic

> **Read at:** 2026-10-07 (UTC) · **Sources:**
> - `effect@4.0.2` and `@effect/vitest@4.0.2` (published 2026-10-07; `4.0.0` on 2026-10-01), and
>   both at `4.0.0-rc.117`, read from the npm tarballs (`npm pack`). 4.0.2 is published from
>   **`Effect-TS/effect`** (tag `effect@4.0.2` = `269a7c864351231d42e6e95b7fa8f32050df3691`). The same
>   tree is checked out, gitignored, at `.reference/effect`; its `packages/effect/src` matches the
>   tarball's.
> - Changelogs at that tag: `packages/effect/CHANGELOG.md` (the `4.0.0-rc.118` to `4.0.2` sections)
>   and `packages/vitest/CHANGELOG.md`.
>
> Paths are relative to the `effect` package root (`src/…`, `dist/…`) unless prefixed `wardic:`.
> The upgrade itself is #64. The previous read, beta.71 → rc.117, is
> [`effect-4-rc-upgrade.md`](effect-4-rc-upgrade.md).

## Summary

The upgrade needed one change: reactivity's import path. Every Effect behaviour that Wardic's frame
timing relies on (ADR-0017, ADR-0010's *Amendment (#13)*) works as it did at rc.117: the functions
in the timing table are code-identical, or changed around the line Wardic relies on without
changing it. The tests and the four timing guards pass unchanged.

The one runtime change with a cost Wardic can see is Node- and Bun-only: a fiber that suspends
now captures an `AsyncResource` and resumes through it ([The run loop](#the-run-loop-three-changes-inside-it)).
It doesn't show: every frame-bench workload's median is lower on 4.0.2 in Bun, Node and Chromium,
by more than this session's noise in Bun and on most workloads elsewhere, and Node's bytes per
frame fall by 15–57% ([Measured](#the-frame-bench)). The layout lab paints the same frames on
both versions in headless Chromium.

## What broke

1. **`effect/unstable/*` is gone** ([#8354](https://github.com/Effect-TS/effect/pull/8354),
   `packages/effect/CHANGELOG.md:420`). Reactivity is exported at `./reactivity`
   (`package.json:48`; rc.117 had `./unstable/reactivity` at `package.json:49`). There is no
   `./unstable/*` key and no `dist/unstable/`, so the old specifier falls through to `./*` and
   fails to resolve. Wardic's 19 imports (core 6, dom 6, solid 3, test 4, counting core's bench
   harness) and two doc comments moved to `effect/reactivity`, which joined `optimizeDeps.include`
   in the three browser configs (#62, `24e24c6`).

Nothing else. The other 39 `effect/*` subpaths Wardic imports resolve, every declaration #63's
rules lean on (`Arr.filterMap`, `Arr.makeEquivalence`, `Effect.fn`, `Predicate.Tuple`,
`UndefinedOr`, `Match`, `Combiner`, `Rec.union`, `Option.fromUndefinedOr`, `Order.mapInput`,
`Stream.fromEventListener`, `Stream.mapAccum`, `Layer.merge` / `provideMerge`, …) has the same
`.d.ts`, and `@effect/vitest` 4.0.2 still peers `vitest >=5.0.0 <6.0.0`, so vitest stays on 5.
Its `effect` peer is `^4.0.2`.

## The timing internals, re-read at 4.0.2

| Behaviour Wardic relies on | 4.0.2 source | vs rc.117 |
|---|---|---|
| `Effect.runFork` evaluates the new fiber synchronously up to its first async point | `runForkWith`, `src/internal/effect.ts:5672-5697` (`fiber.evaluate(effect)` at `:5681`; the `{ scheduler }` run option at `:5678`) | code-identical |
| `ManagedRuntime.runFork` on a built runtime uses its context, synchronously | `src/ManagedRuntime.ts:359-362` → `Effect.runForkWith(self.cachedContext)` | code-identical (`make` changed: below) |
| An `Effect.callback` resume after the fiber yielded re-enters it synchronously | `callbackOptions`, `src/internal/effect.ts:1140-1189` (`if (yielded) fiber.evaluate(effect)` at `:1157-1158`), and `evaluate` → `runLoop`, `:582-602`, `:624` | same behaviour. `register` is now called as `this.register.call(fiber.cache.scheduler, …)` instead of through a bound `internalCall` ([#8443](https://github.com/Effect-TS/effect/pull/8443)). Under Node and Bun, `evaluate` re-enters through `runInAsyncScope`, which calls synchronously (below) |
| `forkIn(…, scope, { startImmediately: true })` runs the child inline; otherwise the fork is posted to the scheduler | `forkUnsafe`, `src/internal/effect.ts:5519-5541` (`immediate ? child.evaluate(…) : currentDispatcher.scheduleTask(…, 0)` at `:5533-5539`); `forkIn` passes `startImmediately` at `:5625` | the branch is unchanged. A non-daemon child is now added to its parent's children before it runs, and a deferred fork captures the async context. `forkIn` forks daemons (code-identical), so neither reaches the Clock's loop |
| `Effect.whileLoop` never yields; `Effect.forever` adds a `yieldNow` per iteration unless `disableYield` | `src/internal/effect.ts:4902-4923` and `:2553-2577` | code-identical |
| The default scheduler picks `setImmediate` or `setTimeout(0)` once, at module load | `dist/Scheduler.js:44`, `"setImmediate" in globalThis` | same test (2 lines lower: every export gained a `@stability` doc tag, [#8770](https://github.com/Effect-TS/effect/pull/8770)) |
| Tests build `new MixedScheduler("async", fn)` and tune `MaxOpsBeforeYield` | `src/Scheduler.ts:171-190` (`shouldYield` at `:189`), `MaxOpsBeforeYield` at `:285` (`fiberCached`, default 2048); `setContext`, `src/internal/effect.ts:722-737` | `Scheduler.ts` identical apart from `@stability` tags; `setContext` rewritten to the same effect. The run loop's yield check has the same shape (`:639-649`), but what it counts changed (below). The `maxOpsBeforeYield: 5` guard passes |
| `PubSub.subscribe` + `Stream.fromSubscription`, `Effect.context` / `provideContext`, `Scope.makeUnsafe`, `FiberSet` | `src/PubSub.ts:1631`, `src/Stream.ts:1403`, `src/Scope.ts:277`, `src/FiberSet.ts:158` | `fromSubscription`, `unbounded`, `takeAll`, `Effect.context`, `provideContext`, `FiberSet.make` / `addUnsafe` and `Scope.makeUnsafe` identical. `subscribe` now passes the PubSub's `ended` state ([#8410](https://github.com/Effect-TS/effect/pull/8410)); a subscriber's wait (`pollForItem`) is rewritten as an `Effect.callback`, still woken synchronously by `Deferred.doneUnsafe` (identical) ([#8449](https://github.com/Effect-TS/effect/pull/8449)). `Scope.close` runs its finalizers uninterruptibly ([#8512](https://github.com/Effect-TS/effect/pull/8512)) |
| `Clock.sleep` wraps `setTimeout` in `Effect.callback` (ADR-0025, decision 8, cites rc.117's `internal/effect.js:2839-2842`) | `src/internal/effect.ts:6300-6327` (`setTimeout` at `:6323`; `dist/internal/effect.js:2877`) | code-identical |
| `Layer.merge(a, b)`: the later Layer wins for a service both provide (ADR-0021, decision 2) | `Layer.merge` → `mergeAll` → `mergeAllEffect`, `src/Layer.ts:1209-1224` → `Context.mergeAll`, `src/Context.ts:1213` (`map.set` in order) | code-identical |

### The run loop: three changes inside it

- **Async context across a suspension** ([#8629](https://github.com/Effect-TS/effect/pull/8629),
  `CHANGELOG.md:221`). Where `process.getBuiltinModule("node:async_hooks")` resolves at module load
  (`src/internal/effect.ts:471-480`), a fiber that returns `Yield` stores
  `new AsyncResource("effect/Fiber")` (`:596`), and the next `evaluate` re-enters through
  `asyncContext.runInAsyncScope(this.evaluate, this, effect)` (`:585-588`). That call is
  synchronous, so a `callback` resume still runs inside the microtask or Refresh frame callback
  that resumed it. Node 22.20 and Bun 1.3.14 both resolve it; a browser has no `process`, so
  nothing changes there. It is one allocation per suspension: at 1,000 elements, each element
  fiber suspends at least once per frame.
- **A synchronous throw becomes the fiber's exit** inside the loop (`:667`) instead of a
  recursive `runLoop` call ([#8778](https://github.com/Effect-TS/effect/pull/8778)).
- **Op counting.** `succeedWith` (`:705-711`, at most `maxInlineSteps = 32` at `:773`) hands a
  success value straight to the next continuation and counts it outside the loop's yield check
  ([#8437](https://github.com/Effect-TS/effect/pull/8437)). The `maxOpsBeforeYield: 5` case in
  `wardic:packages/core/test/refresh-frame-clock.test.ts:133-140` passes; #14's note that a budget
  below about 5 livelocks was not re-run, as it wasn't at rc.117.

### Changed, and reached by Wardic

The tests that cover each pass unchanged.

- **`ManagedRuntime.make`** ([#8528](https://github.com/Effect-TS/effect/pull/8528),
  [#8783](https://github.com/Effect-TS/effect/pull/8783)): the root scope is sequential, with a
  layer scope and a parallel fiber scope under it (`src/ManagedRuntime.ts:296-302`), so `dispose`
  interrupts the runtime's fibers before it releases the layers. Wardic's Solid provider and the
  bench harness dispose runtimes.
- **`Scope.close`** runs finalizers uninterruptibly, masks interruption before their callbacks
  ([#8512](https://github.com/Effect-TS/effect/pull/8512),
  [#8779](https://github.com/Effect-TS/effect/pull/8779)) and runs every one even when one throws
  ([#8418](https://github.com/Effect-TS/effect/pull/8418)). It now takes a `Closeable`
  ([#8473](https://github.com/Effect-TS/effect/pull/8473)); both Wardic call sites close a
  `Scope.makeUnsafe()`, which is one.
- **`RcRef` / `RcMap`** treat an interrupted acquisition as abandoned, and `RcRef` acquires in a
  forked fiber its getter joins ([#8719](https://github.com/Effect-TS/effect/pull/8719),
  [#8390](https://github.com/Effect-TS/effect/pull/8390)): `wardic:packages/dom/src/shared.ts`.
- **`Stream.concat`** is linear and **`Stream.forever`** has constant depth
  ([#8445](https://github.com/Effect-TS/effect/pull/8445),
  [#8416](https://github.com/Effect-TS/effect/pull/8416)): `wardic:packages/core/src/primitives/scalar.ts`'s
  `repeat` legs.
- **Reactivity.** `Atom.make`, `Atom.get`, `Atom.keepAlive`, `AtomRegistry.make` / `layer` and the
  registry's `get` / `set` keep their code and signatures (`dist/reactivity/*.d.ts` differ only by
  `@stability` tags). The registry's node graph was rewritten
  ([#8543](https://github.com/Effect-TS/effect/pull/8543)): every listener runs even when one throws
  (the first error is rethrown), and `subscribe` rebuilds a stale node before attaching. The
  Clock's per-frame `registry.set` targets `keepAlive` leaf atoms, which have no children to
  invalidate in either version. The `AtomRegistry` interface gained three members; Wardic only
  consumes it.
- **`@effect/vitest`**: `it.effect`, `it.live` and `layer` gain an `ExtraContext = {}` type
  parameter (the test context's type is unchanged), and `.each` passes the test context as a
  second argument ([#8425](https://github.com/Effect-TS/effect/pull/8425)). Wardic uses no `.each`,
  `prop`, `makeMethods` or `.extend`.

### Changed, but nothing in Wardic reaches it

- `Arr.partition`, `Arr.separate`, `Option.partitionMap`, `Record.partition` / `separate` and
  `Effect.partition` return `[passes, fails]`, swapped
  ([#8583](https://github.com/Effect-TS/effect/pull/8583)).
- `Queue.offer` and friends became dual; Wardic only calls `Queue.offerUnsafe`, which is identical.
- The root `index` adds `Arbitrary` and `Version` and drops `Encoding`.
- The `Atom` helpers Wardic doesn't use (`swr`, `family`, `fn`, `AtomRuntime`, `searchParam`,
  `windowFocusSignal`).

## Measured (2026-10-07, this machine: WSL2, Node 22.20.0, Bun 1.3.14)

| | rc.117 (`0967799`; `e8e631f`) | 4.0.2 (this branch) |
|---|---|---|
| `bun run typecheck` | 0 errors | 0 errors |
| `bun run lint` | 0 problems | 0 problems |
| `bun run test` (node tier) | 472/472 in 51 files | 472/472 in 51 files |
| `refresh-frame-clock.test.ts` + `next-microtask.test.ts` | pass in the full run | 14/14 + 3/3, run by name |
| `bun run test:browser` (Chromium) | 588/588 in 55 files | 588/588 in 55 files, twice |
| `clock-cold-start` (S1–S5) + `layout-id-scroll` (6) | pass in the full run | 5/5 + 6/6, run by name |
| Vite reloads on a warm cache ("optimized dependencies changed") | 0 | 0 on both runs; the second reused the cache the first wrote, which pre-bundles 4.0.2's `dist/reactivity` |
| layout lab `build` (JS) | 352.04 kB, 120.77 kB gzip | 355.54 kB, 122.22 kB gzip (+1.0%) |

### The frame bench

`bun run bench:core --base 0967799`: since `e8e631f` the base runs on its own `bun.lock`, so the
base side is rc.117 with `0967799`'s core and the head side is 4.0.2 with this branch's. Each bundle
was checked to carry its own Effect (only the head's has 4.0.2's `getBuiltinModule` probe). Median
per-rep head / base ratio [p25 – p75], 11 paired reps, 1,000 elements:

| Workload | Bun 1.3.14 | Node 22.20.0 | Chromium 147 | Node MB per frame |
|---|---|---|---|---|
| `ticksOnly` | −20.0% [−24.8% – −18.9%] | −13.0% [−15.6% – −9.6%] | −21.8% [−35.3% – −18.3%] | 2.17 → 0.94 |
| `springValues` | −16.7% [−22.1% – −13.6%] | −7.7% [−9.0% – −4.6%] | −19.0% [−25.0% – −13.4%] | 2.60 → 1.19 |
| `animateValues` | −13.1% [−15.3% – −11.8%] | −1.1% [−2.0% – +2.0%] | −7.0% [−11.2% – −2.6%] | 3.68 → 2.10 |
| `springBlend` | −11.7% [−13.4% – −10.1%] | −1.5% [−2.6% – −1.1%] | −6.7% [−10.0% – −4.3%] | 3.11 → 1.56 |
| `chase` | −16.0% [−17.9% – −15.4%] | −5.7% [−8.4% – −4.2%] | −19.9% [−25.7% – −14.6%] | 5.32 → 4.51 |

- **The gates.** Every workload passes both, on every engine. The runner still exits 2 ("TOO
  NOISY, rerun") on all three, because `ticksOnly` is outside its ±3% band. Across a dependency
  change `ticksOnly` runs the same core on two Effects, so its −13% to −22% is the upgrade's own
  per-frame cost, not noise.
- **The noise, measured.** A same-tree run right after (`--base HEAD`: 4.0.2 and this branch on
  both sides) put every median between −5.8% and +6.3%. Its `ticksOnly` read +0.7% (Bun), +4.6%
  (Node) and −5.8% (Chromium), so the runner flagged Node and Chromium as too noisy on identical
  code, and Node's bytes per frame matched to the hundredth on every workload. So Bun's drops,
  Chromium's `ticksOnly`, `springValues` and `chase`, and Node's `ticksOnly` and `springValues` are
  well outside this session's noise. Node's `animateValues` and `springBlend` (−1.1%, −1.5%) are
  inside it, and Chromium's (−7.0%, −6.7%) near its edge. The bytes are not noise: they don't move
  on unchanged code.
- **Start time** (reported, not gated; it moved by up to 5.3% in the same-tree run): 3–10% lower in
  Bun, within 3% in Chromium, and mixed in Node: `ticksOnly` 31.0 → 35.8 ms and `animateValues`
  149.6 → 171.4 ms up, `springValues` 85.8 → 63.0 ms down.
- **Why.** Not profiled. The changelog's candidates are the run loop handing success values on
  without allocating an `Exit` ([#8437](https://github.com/Effect-TS/effect/pull/8437)) and the PubSub
  and Queue reworks. Node's and Bun's numbers already include the `AsyncResource` per suspension.

### The layout lab, headless

`.tmp/p64/lab-check.ts` is a local, uncommitted Playwright script (`.tmp/` is gitignored, so it
resolves the repo's pinned playwright 1.59.1). Two dev servers ran side by side: rc.117 from the
bench's checkout of `0967799` on port 5198, and 4.0.2 from this branch on port 5199. Each server's
Vite pre-bundle was checked to come from its own Effect (`_metadata.json`: `effect@4.0.0-rc.117`
with `effect/unstable/reactivity`, against `effect@4.0.2` with `effect/reactivity`). In Chromium
147, headless, for each version × scheduler mode (default `setTimeout(0)`, `?scheduler=microtask`),
after one discarded run per page, the script ran 6 rounds with the two versions interleaved (the
first alternating each round): scenario 1 (click → `layoutDependency`) and scenario 9 (click →
`useWardic` spring), cold (Keep Clock warm off, 2.5 s apart), then warm (Keep Clock warm on). It
reads each run's `heldFrames`, `clock`, verdict, `msToFirstMotion` and `firstSteps` from
`window.__layoutLab`.

| Run | rc.117 | 4.0.2 |
|---|---|---|
| s1 cold | held 0 ×12, `cold`; 14.7 ms to first motion | held 0 ×12, `cold`; 14.5 ms |
| s1 warm | held 0 ×12, `warm`; 12.6 ms | held 0 ×12, `warm`; 13.3 ms |
| s9 cold | held 0 ×12, `cold`; 15.1 ms | held 0 ×12, `cold`; 15.1 ms |
| s9 warm | held 1 ×12, `warm`; 29.7 ms | held 1 ×12, `warm`; 30.0 ms |

- Each count is 6 of 6 in each scheduler mode, as the lab's README expects since #2's fix (s1 holds
  0 cold or warm; s9 holds 0 cold and 1 warm). The rc.117 read's "held 1" on s1 predates that fix.
- All 96 runs are `clean`, with no page errors and no timeouts. The first three steps match:
  `5.1 10.7 13.7` px cold, and `4.8`–`5.1`, `10.5`–`10.6`, `13.7`–`13.8` warm, on both versions.
  Times to first motion are medians of 12; their ranges overlap on every row.

## Re-checking at the next bump

1. `npm view effect dist-tags`, and `npm view @effect/vitest@<version> peerDependencies`. Watch the
   `vitest` range.
2. Diff the table's functions between the pinned tarball and the new one, including the run loop
   (`evaluate`, `runLoop`'s yield check). Read the changelog sections in between for `Scheduler`,
   `fork`, `callback`, `runLoop`, `yield`, `fiberCached` and async context.
3. Diff the two `package.json`s' `exports`: a moved module needs its import, and its
   `optimizeDeps.include` entry in the three browser configs, moved in the bump commit.
4. Bump together: the repo's own pins exact (the root's `effect` and `@effect/vitest`, solid's dev
   dependency, the layout lab), the peers a caret from the verified version
   (`docs/plans/upgrade-targets.md` §1).
5. Run the gates, then the guards by name: `refresh-frame-clock.test.ts`, `next-microtask.test.ts`,
   `clock-cold-start.browser.test.tsx` and `layout-id-scroll.browser.test.tsx`. Run
   `test:browser` twice and check the second log for "optimized dependencies changed".
6. `bun run bench:core --base <the commit before the bump>`. Since `e8e631f` the base runs on its
   own `bun.lock`, so the bench crosses the upgrade; `ticksOnly`'s ratio is then the upgrade's own
   cost plus noise, not noise alone. A same-tree run (`--base HEAD`) right after measures the noise.
7. The lab check, headless (or by hand), with the two versions served side by side and
   interleaved.

## Not checked

- **Firefox**, headless or desktop: it isn't installed on this machine, and the desktop run was
  skipped. At rc.117 Firefox was the only browser whose warm layout runs varied (1 or 2 held,
  depending on where the click fell against its refresh tick), so the interleaved Firefox A/B in
  [the rc.117 read](effect-4-rc-upgrade.md#layout-lab-desktop-by-hand) has no 4.0.2 counterpart.
- #14's livelock below a budget of about 5 (the guard at 5 passes).
- Whether vitest's browser mode gives the page a `process` with `getBuiltinModule`, which would
  turn the async-context path on in the browser tier. A plain page (the bench's Chromium side, the
  lab) has none.
- Changelog entries outside the core runtime, Stream, Scope, Layer, PubSub, Queue, `RcRef`,
  reactivity and `@effect/vitest` (HTTP, Schema, cluster, SQL, AI and so on) were scanned only for
  those keywords.
