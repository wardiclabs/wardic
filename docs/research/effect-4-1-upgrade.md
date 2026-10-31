# Effect `4.0.5` → `4.1.1`, Solid `2.0.0-rc.19` → `rc.20`: what changed for Wardic

> **Read at:** 2026-10-31 (UTC) · **Sources:**
> - `effect@4.1.1` and `@effect/vitest@4.1.1` (published 2026-10-30; `4.1.0` on 2026-10-29), and
>   `effect@4.0.5`, read from the npm tarballs (`npm pack`). Both are published from
>   **`Effect-TS/effect`** (`packages/effect`); the release notes are its `effect@4.1.0` and
>   `effect@4.1.1` GitHub releases.
> - `solid-js`, `@solidjs/web`, `@solidjs/signals` and `@solidjs/diagnostics` at `2.0.0-rc.20`
>   (published 2026-10-29): their GitHub releases in `solidjs/solid` and
>   `packages/signals/CHANGELOG.md` at the `solid-js@2.0.0-rc.20` tag. `solid-js@1.9.18` (2026-10-29)
>   has no release notes; it was read as a diff of the `1.9.17` and `1.9.18` tarballs.
>
> Paths are relative to the `effect` package root (`src/…`) unless prefixed `wardic:`. The upgrade
> is #460's first PR (its decisions, Q6a). The previous Effect read, rc.117 → 4.0.2, is
> [`effect-4-stable-upgrade.md`](effect-4-stable-upgrade.md); this one follows its *Re-checking at
> the next bump*.

## Summary

The upgrade needed no change to Wardic's code. The pins moved:

| | from | to |
|---|---|---|
| `effect`, `@effect/vitest` (root, solid's dev, the examples) | `4.0.5` | `4.1.1` |
| `effect` peer (core, dom, solid, test) | `^4.0.5` | `^4.1.1` |
| `solid-js-2`, `@solidjs/web`, `@solidjs/diagnostics` (solid's dev), the Solid 2 examples | `2.0.0-rc.19` | `2.0.0-rc.20` (`@solidjs/signals` with them) |
| solid's peers | `@solidjs/web ^2.0.0-rc.19`, `solid-js ^1.9.13 \|\| ^2.0.0-rc.19` | `^2.0.0-rc.20`, `^1.9.13 \|\| ^2.0.0-rc.20` |
| Solid 1 (solid's dev, the layout lab, the Solid 1 storefront, `solid-start-basic`) | `1.9.13`–`1.9.17` | `1.9.18` |
| `vite-plugin-solid` (root, the layout lab) | `2.11.12` | `2.11.15` |

`bun run skills` recopied the library skills: Effect's `AGENTS.md` is unchanged at 4.1.1, and
Solid's add `onFlush` to the primer and cheatsheet and `LOADING_ON_ACCESSOR` to the diagnostics
(below).

Every suite passes, and so does `bench:solid` on both bindings. `bench:core` passes in Chromium.
In Bun and Node it carries the upgrade's own cost, outside the Frame loop the bindings run on
([Measured](#measured)):
- Node's `ticksOnly` is 6–8% slower. About a third of that is 4.1.1's `emitDestroy` after each
  fiber resume, in Node and Bun only.
- Node's Stream workloads allocate 2–3% more, 64 bytes per element per frame. That comes from
  `Context`'s new field, times a context root that core's `Stream.withSpan` makes on every pull.
- Bun's small Frame loop workloads flapped, a different one failing each run.

## Effect

`effect@4.1.1`'s `exports` only gained entries (`./crypto`, `./jose` and internal wildcards).
`src/Crypto.ts` and `src/testing/TestCrypto.ts` are gone (#8829, `effect/crypto/*`); Wardic imports
neither. `@effect/vitest@4.1.1` peers `effect ^4.1.1` and still `vitest >=5.0.0 <6.0.0`.

### The timing internals, re-read at 4.1.1

The rows of [the 4.0.2 table](effect-4-stable-upgrade.md#the-timing-internals-re-read-at-402),
diffed between the 4.0.5 and 4.1.1 tarballs:

| Behaviour Wardic relies on | 4.1.1 source | vs 4.0.5 |
|---|---|---|
| `Effect.runFork` evaluates the new fiber synchronously up to its first async point | `runForkWith`, `src/internal/effect.ts:5746` | code-identical |
| `ManagedRuntime.runFork` on a built runtime uses its context, synchronously | `src/ManagedRuntime.ts` | doc comments only |
| An `Effect.callback` resume after the fiber yielded re-enters it synchronously | `callbackOptions`, `src/internal/effect.ts:1192` | same behaviour: `fiber._yielded = …` became `fiber.yieldWith(…)` (`:1218`), which sets the same field (`:759-760`) |
| `forkIn(…, scope, { startImmediately: true })` runs the child inline | `forkIn`, `src/internal/effect.ts:5669-5712`; `forkUnsafe` `:5587` | `forkUnsafe` code-identical. **A closed scope** now gets an unstarted fiber, interrupted at once (`:5698-5708`); before, the child ran (inline, with `startImmediately`) and the closed scope's finalizer interrupted it. [Below](#changed-and-reached-by-wardic) |
| `Effect.whileLoop` never yields; `Effect.forever` yields per iteration unless `disableYield` | `src/internal/effect.ts:4979`, `:2616` | code-identical |
| The default scheduler, `MixedScheduler`, `MaxOpsBeforeYield` | `src/Scheduler.ts` | identical |
| `PubSub.subscribe` + `Stream.fromSubscription`, `Scope.makeUnsafe`, `FiberSet` | `src/PubSub.ts`, `src/Scope.ts`, `src/FiberSet.ts` | doc comments only (`FiberSet.ts` identical) |
| `Clock.sleep` wraps `setTimeout` in `Effect.callback` | `sleep`, `src/internal/effect.ts:6449` | code-identical |
| `Layer.merge(a, b)`: the later Layer wins | `src/Layer.ts` | doc comments only |

### The run loop: two changes at its edges

- **A fiber's end drops its span and stack frame** ([#10164](https://github.com/Effect-TS/effect/pull/10164),
  `src/internal/effect.ts:661-669`): when the fiber's cache holds either, it is replaced by a copy
  without them, so a finished fiber held by an observer no longer keeps the span chain alive. One
  object spread per ending fiber that ran inside a span or a traced `Effect.fn`.
- **Node and Bun only:** each resume through the captured `AsyncResource` now calls
  `emitDestroy()` after it (`:620-629`). A browser has no `process`, so nothing changes there.

### Changed, and reached by Wardic

The tests that cover each pass unchanged.

- **`forkIn` into a closed scope** (above). Wardic forks into scopes at `wardic:packages/core/src/Clock.ts:228`
  (`forkIn`, `startImmediately`), `SharedSource.ts:65` and `dom/src/internal/probe.ts:101`
  (`forkScoped`), and through `FiberHandle.run` (`frameLoop.ts:383`, `solid/src/drag-track.ts`).
  A fork that lands after its scope closed (one racing an unmount) now never starts, where it used
  to run its synchronous prefix before the interrupt.
- **Defects win over failures** ([#8829](https://github.com/Effect-TS/effect/pull/8829),
  `causeElectDefects`, `findRecoverableError`, `src/internal/effect.ts:184-200`): `catch`,
  `mapError`, `orElse`, `match`, `ignore` and the `Exit` mappers read a cause holding both a `Die`
  and a `Fail` as a defect, and `Effect.all` and `ensuring` combine causes that way. Wardic's nine
  catches (`dom/src/internal/projection.ts`, `solid/src/drag-track.ts`, `presence-controller.ts`,
  `reorder-input.ts`, `runtime.ts`) are `catchCause` or `tapCause`, handing the whole cause to the
  failure report: it sees the same reasons, a mixed cause's failures now as defects.
- **`AtomRegistry.subscribe` builds an atom it hasn't read** ([#10119](https://github.com/Effect-TS/effect/pull/10119),
  `src/reactivity/AtomRegistry.ts:552-566`): without `immediate`, a subscribe to an unread derived
  atom used to never notify. Wardic's subscribes (`core/src/LiveValue.ts:453`, `:569`,
  `solid/src/live-style.ts:269`, `bridge.ts`, `unstable/v2/bridge.ts`, `dom/src/internal/projection.ts:5597`)
  now compute an unread atom's node at the subscribe instead of at its first read.
- **`Effect.all` over a record** builds the result with `Object.fromEntries` from `[key, value]`
  pairs (`:4762-4777`), one pair per key: `wardic:packages/core/src/Machine.ts:1413` and `:1523`,
  where a Machine's blenders are built, not per frame.
- **`MutableRef`** is `Equal` by reference with a random hash (`src/MutableRef.ts:81-86`). Wardic's
  one `Equal.equals` compares `Option`s of edges (`dom/src/internal/auto-scroll.ts:140`).
- **`Match`'s tuple patterns** check the array's length (`src/internal/matcher.ts:143`). Wardic's
  `Match` has no tuple pattern.

### Changed, but nothing in Wardic reaches it

- `Context.makeUnsafe`'s new `maxDepth` (default 8, as before), `Context.pick`'s.
- `Effect.fnUntraced({ self }, body)` ([#8829](https://github.com/Effect-TS/effect/pull/8829)),
  `Effect.ignore({ log: "Unhandled" })`, `Duration.toMicros` / ISO durations, `Match.literals`
  (unstable).
- Crypto, HTTP, RPC, SQL, cluster, AI, MCP, CLI, `KeyValueStore`, `Toml`, `Yaml` and Schema's
  codec fixes.

## Solid

### `2.0.0-rc.20`

Nothing in Wardic changed. What changes beside it, for the binding's async reads (`latest()` around
`setupOf` (#335), `isPending` over `settled()` and `tapped()` in docs and tests):

- **`latest()` no longer opens a transaction** (81a12d8): a `latest(a)` read beside `b()` in one
  pass can't pair `a`'s new value with `b`'s old one.
- **An uninitialized async memo re-asked as a verdict lane's work throws `NotReady`** (9baaba3) from
  `latest()`, `isPending()` and plain reads, instead of returning `undefined`.
- **`isPending` read through a memo** settles when the action completes, even when its source is
  also written outside the action (910abc1), and a derived store's key isn't pending at its first
  landing (178605c).
- **`<Errored>` / `<Loading>`:** a dozen fixes for recovery, holds and hydration, for apps such as
  the storefront's Solid 2 app.
- **Stores:** `<For>` over a shallow store diffs the backing array (38e0c49); the first draft write
  to a plain array clones it with `slice()` (56a982c).
- **Dev:** the "multiple instances of Solid" warning fires only when two copies meet (df2ba6c), so
  a page with Solid 1 and Solid 2 in separate roots no longer warns. `LOADING_ON_ACCESSOR` flags a
  `<Loading on>` given a function. `@solidjs/web`'s server functions copy less.
- **The skills** now say: writes in one synchronous frame land together, and `onFlush(fn)` (not
  `queueMicrotask` or `setTimeout`) lands one on its own; and hydration runs each adopted compute
  once with a `Promise` and `fetch` that never settle, so a promise made in a compute mustn't be
  cached past it. Both are #460's Solid 2 audit's to check against the binding.
- **New package:** `@solidjs/element@2.0.0-rc.20`, "Webcomponents wrapper for Solid". Wardic
  doesn't use it.

Not bumped: `@solidjs/router` 2.0.0-next.43 and `@solidjs/vite-plugin` 3.0.0-next.54 exist, but
next.42 and next.51 peer `^2.0.0-rc.17` and `^2.0.0-rc.16`, so rc.20 satisfies them. Kobalte's
`@solid-primitives/*` keep their own nested rc.18, and `@solidjs/router-2` (solid's dev alias) its
nested rc.19; `vite.solid2.ts` resolves every `solid-js` under the Solid 2 tests to `solid-js-2`.

### `1.9.18`

Three fixes, none reached by Wardic: `lazy`'s cleanup keeps a component a later load set, SVG's
`fr` attribute is typed, and the server store's `reconcile` sets an array's `length`.

## Measured

On the bench server (Ryzen 7 9700X, Bun 1.3.13, Node 22.22.3, Chromium 147), 2026-10-31, after
`wardic-quiet`.

| | |
|---|---|
| `bun run typecheck` (TS 7, every package and example) | 0 errors |
| `bun run lint` | 0 problems |
| `bun run test` (unit and server-render) | 1,622 / 1,622 in 142 files |
| `bun run test:browser` (dom, Solid 1, Solid 2, both hydration projects) | 2,270 / 2,270 in 281 files, twice; neither log has "optimized dependencies changed" |
| `bun run test:storefront` | Solid 1 57 / 57 routes, Solid 2 59 / 59, Next 57 / 57 |
| `examples/solid2-start` | built; `/`, `/appear` and `/ssr` load with nothing logged |

The guards the 4.0.2 doc names ran in those suites: `refresh-frame-clock.test.ts` and
`next-microtask.test.ts` in the unit run, `clock-cold-start` and `layout-id-scroll` in the browser
runs.

### The frame bench

`bun run bench:core --base main`: main (`ebecdb6`) runs on its own `bun.lock`, Effect 4.0.5, and
the head on 4.1.1, with the same core. Median per-rep head / base ratio [p25 – p75], 1,000
elements. A second run took Bun and Node to 21 reps.

- **Chromium** (11 reps): every workload passes, `ticksOnly` −1.3%; the Stream workloads within
  −0.8% to +1.5%, the Frame loop ones (`/loop`) within −5.5% to +3.7%.
- **Bun:** every Stream workload within −4.7% to +2.4% in both runs. One small Frame loop workload
  failed each run, a different one each time: `chase/loop` +12.9% [+0.9% – +18.8%] (0.06 ms a
  frame), then +4.3% at 21 reps, and `animateRepeat/loop` −7.5%, then +8.3% [+1.4% – +13.4%]. Bun
  spreads widest on this box (its calibration control read +3.0% on identical code), so these are
  read as noise.
- **Node:** "too noisy" both times, `ticksOnly` +7.7% [+5.1% – +8.0%], then +6.2%
  [+5.2% – +8.8%]. Across an Effect bump `ticksOnly` runs the same core on two Effects, so this is
  the upgrade's own cost, not noise (the 4.0.5 bump read −3.8% the same way). The Stream workloads
  move −0.3% to +3.1%, the Frame loop ones −3.2% to +1.3%. **Bytes per frame** rise on the Stream
  workloads by 0.06 MB (`ticksOnly`, 3.09 → 3.15) to 0.13 MB (the others, +2.6–2.9%), identically
  in both runs, and stay flat on the Frame loop ones (`animateComplex/loop` 2.64 → 2.69 in one run
  of two).

**Where Node's cost comes from** (`.tmp/460/probe/`, local): the two bench bundles run in Node,
11 paired reps per variant, with a preload that makes `AsyncResource#emitDestroy` do nothing, or
that hides `node:async_hooks` from Effect, so a fiber captures no async context at all:

| ms, MB per frame | 4.0.5 | 4.1.1 | 4.1.1, no `emitDestroy` | 4.0.5, no async context | 4.1.1, no async context |
|---|---|---|---|---|---|
| `ticksOnly` | 1.444, 3.089 | 1.529, 3.153 | 1.497, 3.153 | 1.391, 2.961 | 1.420, 3.025 |
| `springValues` | 2.177, 4.440 | 2.286, 4.568 | 2.236, 4.568 | 2.115, 4.311 | 2.138, 4.440 |
| `keyframesValues` | 3.109, 4.911 | 3.250, 5.039 | 3.205, 5.039 | 3.022, 4.783 | 3.131, 4.911 |
| `chase/loop` | 0.032, 0.184 | 0.031, 0.184 | 0.031, 0.184 | 0.032, 0.184 | 0.031, 0.184 |

- **About a third of the time is the new `emitDestroy`** after each resume (Node and Bun; a
  browser has no `process`): `ticksOnly` 1.529 → 1.497 ms without it.
- **The bytes are not async context:** +0.064 MB on `ticksOnly` and +0.128 on `springValues` with
  or without it. A sampling heap profile of `ticksOnly` (unminified bundles,
  `includeObjectsCollectedByMinorGC`) puts the difference in `FiberImpl#setContext`: 33.9 MB on
  4.0.5, 41.3 MB on 4.1.1, under PubSub's `strategyCompleteSubscribersUnsafe` resuming each
  subscriber and `updateContext`. Removing `Context`'s new `maxDepth` field from the head bundle
  brings it back to 33.9 MB. `setContext` adds `_fiberCache` to a new context root after it's built,
  and the root now has one more field before it. Declaring `_fiberCache` in the constructor
  instead moved the bytes into the constructor and raised the total (453.6 MB against 448.2), so
  there's no one-line fix to suggest upstream.
- **Why a new root per element per frame:** `Clock.ticks` is `Stream.withSpan("wardic.clock")`
  (`wardic:packages/core/src/Clock.ts:250`), and `Machine.toStream` wraps a Machine's span the same
  way (`Machine.ts:702`), so each element's pull provides a `ParentSpan`, a cached key, and every
  fiber rebuilds its context cache each frame. That was already 7.7% of `ticksOnly`'s allocation
  on 4.0.5. The bindings run Machines on the Frame loop (ADR-0027), one subscriber to the Clock
  for the whole page, and its workloads didn't move; the Stream model's per-pull span is #460's
  measure and cut parts' to weigh.

### The bindings' bench

`bun run bench:solid --base main` (Chromium 147, 1,000 elements, 11 paired reps, 3 for bytes and
retained): every gate passes on both bindings, control +1.7% [−0.5% – +3.7%].

| warm, head / base | Solid 1 | Solid 2 |
|---|---|---|
| mount | −0.1% [−1.9% – +1.4%] | +0.3% [−0.7% – +1.8%] |
| Retarget | +1.8% [−0.8% – +2.7%] | +0.9% [−3.3% – +2.8%] |
| at-rest Retarget | +1.5% [−0.8% – +2.4%] | +1.9% [+0.7% – +2.0%] |
| unmount | −11.8% [−13.7% – −10.6%] (6.6 → 5.8 ms) | −0.8% [−2.9% – +0.6%] |
| bytes per element per round | +0.4% (136.6 → 137.2 KB) | +0.9% (131.1 → 131.8 KB) |
| retained, hover + press | +0.2% (20.77 → 20.82 KB) | +0.3% (20.08 → 20.14 KB) |
| retained, Reorder item | +0.7% (29.18 → 29.37 KB) | +0.8% (28.25 → 28.46 KB) |
| left after an unmount | 0.12 / 0.13 KB | 0.22 / 0.22 KB |

The layout page's measures and frames move −2.5% to +3.3% on both, inside their quartiles, its
bytes per frame flat, and every scene lands in the same frames. Solid 1's faster unmount isn't
attributed: 1.9.18's `createRoot` now builds its disposer in a function of its own, and Effect's
scope and fiber-end paths changed (above).

### The layout lab, headless

`.tmp/p64/lab-check.ts` (local), as at 4.0.2: two lab dev servers, main's on its own install
(Effect 4.0.5, Solid 1.9.17) and this branch's (4.1.1, 1.9.18), interleaved, 6 rounds of s1
(click → `layoutDependency`) and s9 (click → spring) per version × scheduler mode × Keep Clock warm
off and on.

- All 96 runs are clean, with no held frame and no page error, on both versions.
- s1's first three steps are `2.1 4.1 6.9` px on both. s9's are `11.4 27.7–27.9 35.3–35.8` on
  4.0.5 and `11.6 27.8–28.0 35.4–35.6` on 4.1.1.
- Times to first motion, medians of 24: s1 15.6 ms on 4.0.5 against 15.5 on 4.1.1 (ranges
  14.7–16.0 and 14.9–16.3); s9 16.4 against 16.5 (15.8–17.1 and 15.9–17.0).
- Every run read a warm Clock, the runs meant to start cold included, on both versions, so this
  read compares warm starts only. Why the script's cold runs no longer start cold in today's lab
  wasn't looked into.

## Not checked

- Firefox and Safari: not installed on the bench server.
- A cold Clock start in the lab (above). `clock-cold-start.browser.test.tsx` covers one in the
  browser suite.
- Changelog entries outside the core runtime, Context, Stream, Channel, PubSub, Scope, Layer,
  reactivity, `Match`, `MutableRef` and `@effect/vitest` were read for their module names only.
