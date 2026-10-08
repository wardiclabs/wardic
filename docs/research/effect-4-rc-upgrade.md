# Effect `4.0.0-beta.71` → `4.0.0-rc.117`: what changed for Wardic

> **Read at:** 2026-09-28 (UTC) · **Sources:**
> - `effect@4.0.0-rc.117` and `@effect/vitest@4.0.0-rc.117` (published 2026-09-21), and both at
>   `4.0.0-beta.71`, read from the npm tarballs (`npm pack`). RCs are published from
>   **`Effect-TS/effect`** (tag `effect@4.0.0-rc.117` = `14a3f140095fdebbff9162944fe7d4ea83e054e6`),
>   not from `Effect-TS/effect-smol`, which has no RC tags. The same tree is checked out, gitignored,
>   at `.reference/effect`. Every `src/` line cited below reads the same there; `dist/` and
>   `package.json` lines are the tarball's.
> - Changelogs at that tag: `packages/effect/CHANGELOG.md` and `packages/vitest/CHANGELOG.md`.
> - The vitest migration guides: `vitest-dev/vitest` @ `9bd8d464` (v4.1.11) `docs/guide/migration.md`
>   and @ `428e2e50` (v5.0.2) `docs/guide/migration/index.md`.
>
> Paths are relative to the `effect` package root (`src/…`, `dist/…`) unless prefixed `wardic:`.
> The upgrade itself is PR #20.

## Summary

The upgrade needed one source change, one test-config change and a test-toolchain move. Every
Effect behaviour that Wardic's frame timing relies on (ADR-0017, ADR-0010's *Amendment (#13)*) is
unchanged at rc.117. The tests pass unchanged, and the layout lab paints the same frames in
Chromium (headless) and desktop Chrome. Firefox, headless and desktop, holds a warm layout run for
1 or 2 frames on both versions. Which one it gets depends on whether Firefox runs its refresh
tick within about 1 ms of the click, not on the Effect version
([Desktop, by hand](#layout-lab-desktop-by-hand)).

## What broke

1. **`Stream.fromEventListener` no longer infers its element type from the target.** At rc.117 it
   is `fromEventListener = <A = unknown>(target: EventListener, …)` (`src/Stream.ts:1412-1413`);
   beta.71 took `target: EventListener<A>` (`src/Stream.ts:1647-1648` there). Changelog: rc.113,
   [#7443](https://github.com/Effect-TS/effect/pull/7443). The only Wardic call site that relied on
   inference and read the event was `wardic:packages/dom/src/probe.ts:80` (`ev.matches` on
   `unknown`, the one compile error across src, tests and the lab). Both `probe.ts` sites now pass
   the event type explicitly, as `wardic:packages/dom/src/input.ts` already did. The same PR makes
   `{ once: true }` end the stream after one event; Wardic never passes `once`.
2. **`@effect/vitest` requires a newer vitest.** Its `vitest` peer is `^3.0.0 || ^4.0.0` up to
   beta.102, `^4.1.0` at beta.103–104, `>=4.1.0 <5.0.0` from beta.105 to rc.112, and `>=5.0.0 <6.0.0` from rc.113
   ([#8104](https://github.com/Effect-TS/effect/pull/8104), `packages/vitest/CHANGELOG.md:153`,
   which also requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`). Versions can't be mixed:
   `@effect/vitest@rc.117` on vitest 3.2.6 fails every file (`getCurrentSuite` is undefined), and
   `@effect/vitest@beta.71` on `effect@rc.117` fails to load (`effect/testing/FastCheck` is gone).
   So vitest moved from 3.2.6 to 5.0.2 (see [Vitest 3 → 5](#vitest-3--5)).
3. **Host timers in core's tests.** `wardic:packages/core/test/next-microtask.test.ts` and
   `refresh-frame-clock.test.ts` use `setTimeout`/`clearTimeout`/`queueMicrotask`, but core's test
   tsconfig declares no host types (`lib: ["ES2022"]`, base `types: []`). They typechecked only
   because vitest 3's types pulled in `@types/node`. tsc's `--explainFiles` shows the path:
   `vitest@3.2.6/dist/index.d.ts` → happy-dom's `BrowserWindow.d.ts` → `WebSocket.d.ts` →
   `@types/ws` → `/// <reference types="node" />`. Vitest 5's types don't import the environment
   packages, so the leak stopped. `wardic:packages/core/tsconfig.test.json` now declares
   `types: ["node"]`: the node tier runs these tests under Node. `src` stays host-free (it declares
   the one global it needs locally, `wardic:packages/core/src/util/microtask.ts:6`).

## The timing internals, re-read at rc.117

| Behaviour Wardic relies on | rc.117 source | vs beta.71 |
|---|---|---|
| `Effect.runFork` evaluates the new fiber synchronously up to its first async point | `runForkWith`, `src/internal/effect.ts:5603-5612` (`fiber.evaluate(effect)`); a `{ scheduler }` run option is added to the fiber's context at `:5609` | unchanged |
| `ManagedRuntime.runFork` on a built runtime uses its context, synchronously | `src/ManagedRuntime.ts:347-350` → `Effect.runForkWith(self.cachedContext)` | unchanged |
| An `Effect.callback` resume after the fiber yielded re-enters it synchronously (so `nextMicrotask` resumes inside the microtask, `nextFrame` inside the Refresh frame callback) | `callbackOptions`, `src/internal/effect.ts:1148-1190` (`if (yielded) fiber.evaluate(effect)`), and `evaluate` → `runLoop`, `:620-628` | unchanged |
| `forkIn(…, scope, { startImmediately: true })` runs the child inline; otherwise the fork is posted to the scheduler | `forkUnsafe`, `src/internal/effect.ts:5454-5468` (`immediate ? child.evaluate(…) : currentDispatcher.scheduleTask(…, 0)`); `forkIn` passes `startImmediately` at `:5556`; the child inherits the parent's context at `:5463` | unchanged |
| `Effect.whileLoop` never yields; `Effect.forever` adds a `yieldNow` per iteration unless `disableYield` | `src/internal/effect.ts:4834-4855` and `:2564-2586` | code-identical |
| The default scheduler picks `setImmediate` or `setTimeout(0)` once, at module load | `dist/Scheduler.js:42`, `"setImmediate" in globalThis`. The function is renamed `setTimer`, and a timer that throws falls back to a microtask ([#7930](https://github.com/Effect-TS/effect/pull/7930)) | same test, same line; the harness polyfill and the lab's `?scheduler=microtask` still work |
| Tests build `new MixedScheduler("async", fn)` and tune `MaxOpsBeforeYield` | `setImmediateFn` is now optional, and `"sync"` mode defaults to a microtask (`src/Scheduler.ts`). `Scheduler` and `MaxOpsBeforeYield` became `fiberCached` references, and a fiber recomputes its cache when its context changes (`setContext`, `src/internal/effect.ts:742-757`) | same for how Wardic calls it. The run loop's yield check has the same shape as beta.71's, so #14's finding that a budget below 5 livelocks should still hold (not re-run) |
| `PubSub.subscribe` + `Stream.fromSubscription`, `Effect.context` / `provideContext`, `Scope.makeUnsafe`, `FiberSet` | signatures unchanged. PubSub's changes are in replay buffers and count normalisation (Wardic uses `unbounded()` with no replay). `Scope`'s open state gained a single-finalizer fast path | unchanged for Wardic's use |

### Changed, but nothing in Wardic reaches it by name

- **The fiber run loop was rewritten** (rc.113, [#7643](https://github.com/Effect-TS/effect/pull/7643),
  "Reduce memory usage in Effect primitives and fibers"). Context-derived fiber fields moved under
  `fiber.cache`, which is shared per context root, and interrupting a fiber *while it runs* now
  takes effect at its next step (`src/internal/effect.ts:609-611`) instead of re-entering it. Wardic
  reads no fiber internals.
- **Nested Layer builds fork the memo map** (beta.94, [#2538](https://github.com/Effect-TS/effect-smol/pull/2538);
  `CurrentMemoMap.forkOrCreate`, `src/Layer.ts:585-587`). Only Wardic's tests nest
  `Effect.provide(layer)`, per test, for data-replay Layers.
- **A failing effect whose finalizer also fails reports both failures**
  ([#7361](https://github.com/Effect-TS/effect/pull/7361), `packages/effect/CHANGELOG.md:1187`).
- **`effect/unstable/reactivity`** is still exported at the same subpath (`package.json:49`).
  `Atom.make` and `Atom.get` are code-identical; `Atom.keepAlive` differs only in its doc comment.
  `Atom` gained an `equals` member that defaults to `Object.is`, so `registry.set` still notifies
  on any non-identical value. `AtomRegistry`'s node graph now keeps `parents`/`children` in `Set`s
  instead of arrays (`src/unstable/reactivity/AtomRegistry.ts:99-100`; beta.71 `:166-167`), and a
  node invalidated while it builds is rebuilt ([#6751](https://github.com/Effect-TS/effect/pull/6751)).
- **`@effect/vitest`'s API** (`src/index.ts`) changes only `prop` (FastCheck → `effect/unstable/arbitrary`)
  and adds a `concurrent` option to `layer`. `it.effect`, `it.live`, `layer`, `describe`, `expect`
  and `vi` are unchanged. After a timeout it now awaits the timed-out test's finalizers before the
  next test starts ([#8154](https://github.com/Effect-TS/effect/pull/8154), `packages/vitest/CHANGELOG.md:151`).

## Vitest 3 → 5

- **The browser provider is a factory** since vitest 4: `provider: playwright()` from
  `@vitest/browser-playwright`, and "the `@vitest/browser` package is no longer needed"
  (migration guide v4.1.11, lines 270-297). Both `packages/*/vitest.browser.config.ts` changed.
  `@vitest/browser-playwright@5.0.2` peers `vitest: "5.0.2"` exactly and `playwright: "*"`, so
  playwright stays at 1.59.1 to match nix's browsers.
- **`vite` is a required peer**, and vitest 5 needs Vite ≥ 6.4 and Node ≥ 22.12 (migration guide
  v5.0.2, lines 16-21). The root pins `vite` at the lab's 6.4.2, so the install has one Vite.
- **Artifacts moved to `.vitest/`**, including failure screenshots (was `__screenshots__/`; same
  guide, line 557). It is gitignored.
- **`clearMocks` defaults to `true`** (same guide, line 29). No Wardic test depends on mock history
  across tests.
- **jsdom stays.** `vite-plugin-solid` 2.11.12 sets `environment: 'jsdom'` when none is set
  (`node_modules/vite-plugin-solid/dist/esm/index.mjs:80-81`), which a direct
  `--config packages/solid/vitest.browser.config.ts` run needs.

## Measured (2026-09-28, this machine: WSL2, nix devshell, Node 22.22.3)

| | beta.71 + vitest 3.2.6 | rc.117 + vitest 5.0.2 |
|---|---|---|
| `bun run typecheck` | 0 errors | 0 errors (after the fixes above) |
| `bun run test` (node tier) | 153/153 in 27 files | 153/153 in 27 files |
| `refresh-frame-clock.test.ts` + `next-microtask.test.ts` | 12/12 + 3/3 | 12/12 + 3/3 |
| `bun run test:browser` | 177/177 at #14's final gate (not re-run today) | 177/177 in 32 files |
| `clock-cold-start` (S1–S5, incl. S3's 0 dispatches) + `layout-id-scroll` (6) | 11/11 | 11/11 |
| layout lab `build` (JS) | 249.74 kB, 85.51 kB gzip | 256.43 kB, 87.67 kB gzip (+2.5%) |

**Layout lab, headless.** `.tmp/lab-14-check.ts` is a local, uncommitted Playwright script (`.tmp/`
is gitignored; it lives there so it resolves the repo's pinned playwright 1.59.1). It loads the
lab's dev server in Chromium and Firefox × default and microtask scheduler, clicks Run on
scenario 1 (layout) and scenario 9 (spring) twice each cold, then twice each with Keep Clock warm
on, and prints each run's `heldFrames` · `clock`. The first script run after the dev server
started was discarded. Both versions were served side by side from checkouts of the two commits:

- Chromium, both modes, both versions: cold layout held **1**, s9 cold **0**, warm layout **1**,
  s9 warm **1**, in every run.
- Firefox, both modes, both versions: cold layout held **1** (apart from the misread below), s9
  cold **0**, s9 warm **1**. Warm layout held **1 or 2** on both versions (PR #19's desktop
  Firefox run also had warm runs a frame long, 3 of 10). How often it held 2 differed between
  samples: 5 of 8 (beta.71) against 7 of 8 (rc.117) in the check above, then 20 of 24 against
  11 of 24 in a focused sample (warm layout only, 12 runs per mode). Two-sided Fisher p ≈ 0.57
  and ≈ 0.015; pooled, 25/32 against 18/32, p ≈ 0.11. Each sample ran one version after the
  other, not interleaved, so the cause of the focused sample's shift, which is towards the
  minimum of 1, is not established.
- One run per version read `held 0` on a cold Firefox layout run, with two samples delivered
  about 2 ms apart. That is the lab's documented late-delivery misread
  (`wardic:examples/layout-lab/README.md:78-82`).

### Layout lab, desktop, by hand

Devin, Windows, Chrome 153 and Firefox 156 at devicePixelRatio 2, default scheduler
(`setTimeout(0)`), 2026-09-28. The logs are in `wardic:examples/layout-lab/logs/` (gitignored, so
local only).

- **Chrome, rc.117** (`2026-09-28T02-55-33-766Z`): s1 cold held 1 ×3, s9 cold 0 ×3; with Keep
  Clock warm on, s1 held 1 ×3 and s9 held 1 ×3. An s9 retarget read `warm` and reversed smoothly.
- **Firefox, rc.117, every scenario** (`…02-43-05-753Z`, 67 runs). Every scenario run fresh
  matches the beta.71 Firefox log from PR #19 (`…00-25-55-720Z`):
  - s1, s6 and s7 (all 6 Container runs) cold: held 1;
  - s2–s5 and s8: held 1 with verdict `flash` (#2's late measure pass);
  - s9 cold: held 0.
  
  38 mid-flight layout retargets from rapid clicks showed no doubled or frozen step: 0 of 924
  moving steps changed by more than 1.8× both neighbours or dropped to 0 between moving ones.
- **Firefox, warm s1, interleaved A/B.** Two visible windows, each served by the lab at one
  commit: beta.71 on port 5198 (`…03-53-10-729Z`) and rc.117 on port 5199 (`…03-53-04-144Z`).
  Each server's Vite pre-bundle was checked to come from its Effect version. Runs were
  alternated, and the throwaway first runs and one known misread were dropped.

  | Measure pass starts | beta.71: held 2 | rc.117: held 2 |
  |---|---|---|
  | ≤ 1 ms after the click | 11/15 | 19/24 |
  | later | 0/15 | 2/11 (both at 2 ms) |
  | all | 11/30 | 21/35 |

  - Given when the measure pass starts, the versions agree (≤ 1 ms: two-sided Fisher p ≈ 0.71).
    Click-to-first-motion within each case also agrees: held-1 runs 20.5 and 21.9 ms, held-2
    runs 27.9 and 28.8 ms.
  - The overall gap (p ≈ 0.08) comes from how many clicks Firefox handled right before a
    refresh tick: 15/30 against 24/35 (p ≈ 0.14). That share rose over the session in both
    logs. Stratified by time, the version effect isn't significant (Mantel–Haenszel p ≈ 0.15).
  - Every one of these runs had exactly one measure pass, so the ResizeObserver mechanism #18
    hypothesises is not involved. The late start is tracked in #18.

## Re-checking at the next RC

> For a bump from 4.0.2, use [the 4.0.2 read's checklist](effect-4-stable-upgrade.md#re-checking-at-the-next-bump), which re-reads this table there.

1. `npm view effect dist-tags`, and `npm view @effect/vitest@<rc> peerDependencies`. Watch the `vitest` range.
2. Diff the table's functions between the pinned tarball and the new one, and read the
   changelog sections in between for `Scheduler`, `fork`, `callback`, `runLoop` and `fiberCached`.
3. Run the guards by name: `refresh-frame-clock.test.ts`, `next-microtask.test.ts`,
   `clock-cold-start.browser.test.tsx` and `layout-id-scroll.browser.test.tsx`. Then run the
   headless lab check (or, without the local script, the same clicks by hand in the lab) and
   compare with the numbers above. Interleave the two versions if comparing Firefox's warm runs.

## Not checked

- Whether a stable `4.0.0` date has been announced.
- Every changelog entry outside the core runtime, Stream, Layer, PubSub, reactivity and
  `@effect/vitest` (HTTP, Schema, cluster, SQL and so on) was scanned only for those keywords.
- Per-frame CPU cost, which was not profiled. The gate and the lab measure frame timing, not CPU.
  So whether rc.117 changes how often Firefox handles a click right before a refresh tick
  (through main-thread load) is not ruled out.
