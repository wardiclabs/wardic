# Effect end to end in core: Effect's time stays wall time, failures are reported where they stop, and the per-frame path gets cheaper

#83 gathered what was left for core to use Effect end to end once ADR-0027 put every Primitive on the Frame loop: a frame-time `effect/Clock` (A), typed errors and error reporting (C), and the start path and per-frame allocation (D). Its part B, a pipeable `Machine` module, became ADR-0028. The grill found most of A and C already holding through Effect's own defaults, or without a caller yet, and measured D's hypotheses. Effect's time stays wall time and frame time is the Machine combinators', so `Clock.delay` goes. A machine's build keeps its `never`, and a run's defect stays the thrown value, which Effect already names after its run. Failures are reported to `ErrorReporter` where they stop, at the bindings' unobserved fibers, and an app installs its loggers, its level, its reporters and the devtools on the Environment it hands the provider. A dev check for non-finite Frames is off by default and free when off. On the per-frame path an index in range is a plain read, `springValues` steps in place, and the Clock's `time` and `dt` Atoms go. The start path, where the span per run is most of a start, is #87's. This amends ADR-0006, ADR-0017, ADR-0025, ADR-0027 and ADR-0028.

## Why

- **#83's direction** (a design discussion on 2026-10-08, after #68): core should use Effect end to end, be extensible through `pipe`, and report its failures. It listed every part as undecided: "It needs a grill first, and will likely split into slices as #68 did."
- **Where core stood at `935e493`:**
  - **Time.** `Clock.delay` waits on `Clock.ticks` through a `mapAccum`: a fiber and a subscription per wait. ADR-0028 kept it "until #83 (A) replaces it". Its one caller is its own test (`packages/test/test/util-effect.test.ts:11`). Nothing in dom, solid or the examples runs `Effect.sleep`, `Effect.delay`, `Effect.timeout` or `Schedule` in an animation: the spine folds its stagger and `delayChildren` into each leg's `delay`, and `when` waits on settles (`use-wardic.tsx:1210-1231`). The only raw timers left are the Resize block's (#45), which are wall time.
  - **Errors.** Every error channel in core is `never`. A step or sink that throws ends its run with `Exit.die` (ADR-0027, decision 7). The registry's "can't blend" case is a warning and a Discrete pair (ADR-0026, decision 4).
  - **Logs.** 22 `logDebug`, 2 `logWarning` and 6 `logError` calls in `packages/*/src`, and no Info. Nothing installs a Logger, a minimum level, an `ErrorReporter` or a Tracer.
  - **D's hypotheses.** A run started at 8–44 ms per 1,000, against 3.5–5.9 ms for a plain handle (ADR-0027, decision 6). Each element allocated a fresh state and Frame per tick, 0.95 MB per frame on `springValues/loop` in Node. The Clock's `time` and `dt` Atoms were written every tick, and #83 found nothing reading them.
  - **Silent boundaries.** A defect in presence's exit (`presence.tsx:221-223`), in drag's track, or in a recognizer's signal (`runScoped`, `provider.tsx:245-269`) stops that feature with nothing logged: the shape #75 found in the projection coordinator.

## Decisions (grilled 2026-10-10 against effect 4.0.2's `dist`)

1. **Effect's time stays wall time; frame time is the Machine combinators' (amends ADR-0025's decision 8 and ADR-0028's decision 12).**
   - **No frame-time `effect/Clock` until something calls one.** `Effect.sleep`, `delay`, `timeout`, `Schedule`, `repeat` / `retry`, `Stream.debounce` and `throttle` run on Effect's default `Clock`, wall time. Frame time (CONTEXT.md) is what a run on the Clock counts: `Machine.delay`'s and `holdAfter`'s Holds, a tween's `duration`, a stagger.
   - **`Clock.delay` goes,** with no alias, and its test with it. A run held in frame time is `Machine.run(b.pipe(Machine.delay(0.3)), sink)` after `run(a)`: its sink gets its start value, `done: false`, through the Hold, as Motion's `delay` does. That's #95's reasoning for `wait`, `onSettle` and `group`, which nothing outside core's tests called either.
   - **Why not now: a frame-time Clock has two timebases to reconcile, and no caller to answer for.** Effect's combinators read the time from the same Clock they sleep on:
     - `Schedule` reads `currentTimeMillisUnsafe()`, then sleeps the step's delay (`Schedule.js:215-223`);
     - `Stream.timeout`, `debounce` and `aggregateWithin` set a deadline from `currentTimeMillisUnsafe()` and sleep `deadline − now` (`Stream.js:1982-1995`, `:5447-5480`, `:6000-6043`).

     #83's lean, `sleep` on frames and the rest probed, leaves a debounce waking before its wall-time deadline and sleeping again. Both on frame time, `TestClock`'s way (its millis, nanos and monotonic time move together, `testing/TestClock.js:87-95`), stamps every span (`internal/effect.js:2709`, `endSpan`), log date (`:3147-3150`) and `ErrorReporter` timestamp (`:3412`) under that Clock in frame time, so anything inside one task, building a machine or a Retarget, traces as 0 ms. #87 profiles exactly those.
   - **What a frame-time Clock has to answer, when a caller comes:** its reach (animation programs only, so #45's and #69's wall-time policies stay wall time); what `currentTimeMillis`, `currentTimeNanos` and `monotonicTimeNanos` report; whether `sleep(0)` is the next tick or a yield; and raw or clamped `dt`, with #23. A sleep would start as a run does, so measure it against a run's start first.
   - **ADR-0025's decision 8, its `Schedule` bullet,** now reads: `Schedule` runs on wall time, as all of Effect's time does; `delay`, `stagger` and the `repeat` legs run on frame time, through the Machine combinators. It's not a mismatch to fix but the split.
   - **ADR-0028's decision 12, the services' row:** `delay` → `Clock.delay` is gone.
   - **Rejected:**
     - **A frame-time Clock for animation programs now,** #83's direction: no caller, and each of the questions above would be answered for none.
     - **Keeping `Clock.delay` until one comes:** a second way to hold in frame time beside `Machine.delay`, with a fiber and a subscription per wait.
2. **A machine's build keeps `E = never`; its first typed error is #66's (ADR-0026's decision 4 stands).**
   - **Nothing a build does today can fail.** Of #83's four cases:
     - "no entry decodes a pair" (`"auto"` → `"none"`) is a Discrete pair, by ADR-0024 and CONTEXT.md, and silent: an ordinary switch;
     - "an entry decodes a pair it can't blend" (`"10px"` → `"1em"`) is a Discrete pair too, CONTEXT.md's own example, with the registry's warning, as Motion warns;
     - #66's decode hasn't landed;
     - "a Probe target is missing" isn't a build's: `Probe.measure` is `Effect<Bounds>`, and no constructor in `Machine.ts` reads a Probe.
   - **A typed error would bring back what ADR-0026 removed.** As a defect at `resolve`, "that defect failed the element's whole leg, so one key stopped every key" (decision 4). A typed error in `springBlend`'s build fails the whole build too, so the binding's `catchTag` couldn't fall back for one key: it would rebuild without it, or the error would carry each pair's fallback. That's today's behaviour, in more code, for a policy no caller wants changed.
   - **#66 decides the shape of the first one.** ADR-0028's decision 3 already gives a build that needs a service an `E` (`Effect<Machine<F>, E, R>`). The plain constructors (`Machine.tween`, `spring`, `animate`, …) return a `Machine`, so a decode that rejects would make them Effects, or run in the binding instead: one of #66's own "where" options.
   - **Rejected:** `Schema.TaggedError`s for #83's four cases, and the binding choosing the fallback with `catchTag` (#83, C.1).
3. **A run's defect stays the thrown value: Effect names its run.**
   - **Effect 4 annotates the defect with the run's span.** When a run's fiber resumes from its `Deferred` with `Exit.die`, `exitFailCause` annotates the cause with the fiber's stack frame (`effect/Cause/StackTrace`, `internal/core.js:338-348`), which the run's `withSpan` pushed with the span's name (`provideSpanStackFrame`, `internal/effect.js:2746`). `Cause.pretty` prints it.
   - **Measured** (`.tmp/83-defect/probe.ts`: a step that throws on its second tick, on core's real Frame loop, logged as the spine's `legEnded` logs):

     ```
     ERROR: wardic.spine: a leg failed
     Error: boom in step
         at <anonymous> (probe.ts:16:30)
         at tick (internal/frameLoop.ts:131:29)
         at wardic.springValues (internal/frameLoop.ts:220:14)
     id: el-1
     ```

     The frame is the span's name, not a function's, so minifying doesn't lose it. dom's `coordinator failed` reads `at wardic.projection.coordinator` the same way, and a reporter receives each reason's annotations (decision 4).
   - **A wrapper would cost the reporters their grouping.** Error trackers group by the error's type and message, so a `StepDefect` around every throw puts a blender's `TypeError` and a sink's `RangeError` in one bucket, unless every reporter unwraps it.
   - **Not recorded:** the `dt` of the tick that threw, and the span's attributes. A NaN after a stall is decision 7's.
   - **Rejected:** `Exit.die` with a `StepDefect` carrying `machine.span.name`, its attributes and the tick's `dt` (#83, C.2).
4. **Failures are reported where they stop: the bindings' unobserved fibers. Core doesn't report.**
   - **Where a failure stops,** a binding reports it with `ErrorReporter.report(cause)` beside its log:
     - the boundaries that log today: the spine's `legEnded` (`wardic.spine: a leg failed`) and dom's five `wardic.projection: … failed`;
     - the boundaries that are silent today, which gain a log at Error and a report: presence's exit, and `runScoped`, which covers drag's track, `streamToSignal` (the hover, press and focus signals) and `useWardicFiber` in one place.
   - **Core doesn't report.** The Frame loop hands each run's failure to its caller (ADR-0027, decision 7), and a Tier 2 caller may recover (`retry`, `catchCause`): a report from the loop would flag a failure its caller handles.
   - **An app installs its reporters** on the Environment it hands the provider, `ErrorReporter.layer([…])` merged into `env`, Effect's own way. Wardic ships none.
   - **Why it costs nothing:**
     - Effect never reports by itself: only `withErrorReporting` and `ErrorReporter.report` reach `reportCauseUnsafe` (`internal/effect.js:3400-3415`, `ErrorReporter.js:199-202`), and a `runFork` fiber that fails unobserved isn't reported;
     - with no reporter installed, a report is one `getRef` and a size check (`:3406-3407`), on the failure path only;
     - a reporter dedupes a cause and its original error (`ErrorReporter.js:62-90`), so a cause that crosses two boundaries reports once.
   - **The risk:** `effect/ErrorReporter` is `@stability unstable` in 4.0.2. The use is a handful of `report` calls and one documented `layer`.
   - **Rejected:** reporting at the Frame loop's boundary (#83, C.4).
5. **No Logger and no minimum level: Effect's defaults are production's.**
   - **Effect 4.0.2's defaults:** `MinimumLogLevel` is `"Info"` (`internal/references.js:39-42`), and the loggers are the console logger and the tracer logger (`internal/effect.js:3037-3039`). The console logger pretty-prints a log's cause, decision 3's frame included (`:3340-3350`). So Wardic's Debug logs are filtered, and its warnings and errors reach the console.
   - **An app turns Wardic's Debug logs on in development** through `env`, which `WardicProvider` already takes (`provider.tsx:104-105`):

     ```ts
     <WardicProvider env={Layer.mergeAll(DomLive, Logger.layer([Logger.consolePrettyBrowser()]), Layer.succeed(References.MinimumLogLevel, "Debug"))}>
     ```

     The docs show it, with decision 4's reporters and decision 6's devtools.
   - **Rejected:**
     - **`MinimumLogLevel` at `"Warn"` in production** (#83, C.5): Wardic logs nothing at Info, so it would filter only an app's own Info logs, where they share the runtime;
     - **a Wardic `devLayer`:** the two lines above, under a second name, with no caller.
   - Skipping the start log when Debug is filtered is a cost question: decision 9.
6. **Devtools are Effect's: `DevTools.layer()` on `env`.**
   - **It's #83's "the loop's spans and metrics, without a custom Tracer".** `effect/devtools`' `layer(url?)` is a `Layer<never>` (`devtools/DevTools.d.ts:60`) that installs a tracer mirroring the current one and streams span starts, events and ends, and metric snapshots, over a WebSocket to the Effect devtools process. An app merges it into `env` in development, and the docs show it beside the logger.
   - **The spans reach it:** the burst's spans reach the Tracer of the run that starts it, since `provideContext` merges the Layer's build context over the caller's and the build context has no Tracer (ADR-0027, *Implementation in #74*).
   - **The metrics should, and a slice checks it.** The loop updates its gauge, counters and histogram against its build context (`internal/frameLoop.ts:147-148`, `:164`), and the devtools' snapshot reads the `MetricRegistry` from its own (`Metric.js:1363-1364`). A `Context.Reference`'s default value is cached on the reference (`Context.js:593-595`), so both should be one registry. The slice runs a devtools tracer beside `DomLive` and reads the burst's `wardic.frameloop` span, each run's span and the three metrics, as #74 checked the layout lab's Tracer.
   - **#75's "a future timeline or devtools":** this is the devtools. The layout lab's timeline stays.
   - **The risk:** `effect/devtools` is `@stability unstable`. Wardic only documents it.
7. **A dev check for non-finite Frames: off by default, a sink wrapper at a run's add.**
   - **What it catches:** a NaN or an Infinity a step produces. Today it's written as `NaNpx`, which the browser drops without a word, so the element stops moving. #66 rejects NaN in options, the commonest source, but not what a step makes of good options, or a machine built with `Machine.make`.
   - **The switch:** `FrameLoop.CheckFrames`, a `Context.Reference<boolean>`, `false` by default. An app turns it on in development through `env`, beside decision 5's logger.
   - **The check:** `run` reads the Reference once per start, from the caller's fiber. When it's on, it wraps the run's sink in a check of each Frame's `value`: a number passes `Number.isFinite`; a record's values are checked one by one; a string fails on `"NaN"` or `"Infinity"`. A failure throws a `NonFiniteFrame` defect with the key and the value, which the tick's `try` ends the run with (`Exit.die`), and decision 3's annotation names the run.
   - **Why a sink wrapper, not a second tick:**
     - main's tick doesn't change, so it isn't kept twice, and off costs nothing per frame by construction: the wrap is at start, and only when on;
     - read from the caller's fiber, the Reference works when an app merges it beside `DomLive` with `Layer.mergeAll`. Read at the loop's build, it would see only what the FrameLoop layer was built with, and a `mergeAll` sibling isn't that: decision 6's reason the burst's spans reach the app's Tracer.
   - **Measured** (`bench:core`, 11 paired reps on the bench server; head / base, median [p25–p75]):
     - **a costlier off,** a second tick chosen once at the loop's build plus a 4 ms comparison (`probe/83-check-off` against main): every workload passes on every engine, and Node's bytes per frame are unchanged or lower. Noise controls: Bun +0.8%, Node −1.4%, Chromium +0.5%.

       | Off / main | Bun | Node | Chromium |
       |---|---|---|---|
       | `springValues/loop` | −7.4% [−10.9, −3.7] | +0.7% [−0.8, +1.0] | +1.7% [+0.0, +10.0] |
       | `animateValues/loop` | +4.4% [−3.9, +6.0] | −3.9% [−6.4, −1.8] | −2.1% [−4.2, +4.3] |
       | `springBlend/loop` | +1.2% [−4.4, +2.8] | −4.7% [−5.6, −2.7] | +3.4% [−4.8, +4.8] |
       | `chase/loop` | −1.5% [−11.3, +2.9] | −1.0% [−5.3, +2.8] | +0.0% [+0.0, +11.1] |
       | `animateComplex/loop` | +1.1% [−3.2, +1.7] | +0.9% [−1.7, +1.9] | −0.8% [−1.7, +0.0] |
       | `animateRepeat/loop` | +1.8% [−5.9, +5.1] | −0.1% [−3.3, +0.8] | +1.6% [+0.0, +4.4] |
       | `animateRepeatDelay/loop` | −0.8% [−5.7, +1.8] | −0.6% [−2.0, +0.9] | +0.0% [−3.2, +1.6] |

     - **on, against that off** (report-only; noise controls Bun −2.4%, Node −2.0%, Chromium −0.9%): `springValues/loop` +6.0% / −5.6% / +8.6% (Bun / Node / Chromium), `springBlend/loop` +28.7% / +17.8% / +25.0%, `animateValues/loop` +32.1% / +22.3% / +27.7%, the rest from +0.0% (`chase/loop`, Chromium) to +41.2% (`animateComplex/loop`, Bun). The string scans dominate, and Node's bytes rise up to 18%. Development only.
   - **Its limits:** dom's projection coordinator writes the gate directly and its Frames carry nothing, so the box math isn't checked; and a string value that really contains "Infinity" would trip it.
   - **Rejected:** a second tick function chosen at the loop's build (#83, C.3), measured above: the tick kept twice, and a switch that a `mergeAll` sibling doesn't reach.
8. **No frame budget warning: the tick histogram is the record.**
   - **#83's proposal:** a Warning once per burst when a tick passes ADR-0027 decision 1's 4 ms.
   - **It fires on a fast desktop.** The off variant above carried it. In one head run on the bench server (Ryzen 7 9700X), it fired in 7 of 21 loop bursts, at 4.1–12.0 ms ticks with 1,000 runs, all in the rounds the gate discards: likely the first ticks, before the JIT warms. An app would warn the first time a page animates 1,000 elements on hardware that meets the target.
   - **A Warning reaches production:** decision 5 keeps Effect's `"Info"` minimum.
   - **ADR-0027's target is steady frames,** not a burst's first tick. A rule that fits it (skip a burst's first ticks, a p95 over a window) is policy without a caller, and `wardic_frameloop_tick_ms` (ADR-0027, decision 6) already holds every tick, which decision 6's devtools show.
   - **Found on the way:** Effect's default logger wrote the Warning to stdout, which the bench's `run.ts` parses as JSON. The probe sent it to stderr (`References.LogToStderr`).
   - **Rejected:** the Warning (#83, C.6), and the same check at Debug, which fires on the same cold ticks.
9. **The start path: `FrameLoop.run` stays as it is, and #87 decides with its profile.**
   - **Measured** (`.tmp/83-starts/`: 1,000 `FrameLoop.run` starts in one task on core's real Clock and Frame loop, `MixedScheduler("sync")` as the bench's; a copy of `internal/frameLoop.ts` with each variant; 11 paired reps on the bench server). Main's 1,000 starts take 5.0–7.4 ms for `springValues` and 4.2–7.1 ms for `springBlend`, 4–7 µs a start; building 1,000 `springBlend` machines, blenders resolved, takes 3.8–6.3 ms more. Each variant / main, median [p25–p75]:

     | Starts | Bun | Node | Chromium |
     |---|---|---|---|
     | no start log, `springValues` | −2.9% [−23.3, +0.6] | −17.2% [−23.4, −14.5] | −11.3% [−20.1, −8.3] |
     | no start log, `springBlend` | −4.0% [−24.8, −2.1] | −9.2% [−14.8, −7.8] | −7.8% [−8.3, −5.9] |
     | no span, `springValues` | −40.3% [−60.9, −33.3] | −40.1% [−45.0, −39.8] | −72.8% [−75.9, −72.5] |
     | no span, `springBlend` | −31.3% [−45.9, −27.0] | −61.4% [−64.6, −58.9] | −78.4% [−79.3, −77.8] |
     | neither, `springValues` | −55.0% [−66.8, −51.5] | −57.5% [−64.5, −57.0] | −81.5% [−82.7, −81.4] |
     | tracing off (`References.TracerEnabled` `false`), `springValues` | +14.8% [+3.0, +20.0] | +0.3% [−11.2, +0.7] | −7.0% [−12.4, −5.9] |
     | tracing off, `springBlend` | −17.2% [−17.8, −15.5] | −20.8% [−26.1, −1.4] | −5.2% [−6.2, −3.6] |
     | the log's annotations on the log alone, `springValues` | +27.7% [+13.4, +33.5] | +0.6% [−7.9, +6.1] | +0.5% [−19.9, +2.0] |
     | `runAll`: one `acquireUseRelease`, log and span per batch, a `Deferred` per entry, `springValues` | −83.9% [−88.6, −77.8] | −86.6% [−88.9, −85.6] | −94.5% [−95.0, −94.0] |

   - **The span is most of a start, about 1.4–5.5 µs here,** more than ADR-0027 decision 3's "about 1 µs", which timed `Effect.makeSpan` alone, not all of `withSpan`. It's what traces a Primitive, and decision 3's naming comes from it.
   - **Effect's own switch saves little.** A noop span still runs `withSpan`'s machinery (`makeSpanUnsafe` → `noopSpan`, `useSpan`, the stack frame), so an app turning tracing off doesn't get the span's share back. Decision 3's frame survives it: the noop span's `_tag` is `"Span"` (`internal/effect.js:2659-2660`), so `provideSpanStackFrame` still runs (`.tmp/83-defect/probe-notrace.ts`).
   - **The log is a small share** (0.2–1 µs), and it's what decision 5's Debug shows in development.
   - **`runAll` has no caller:** each element's spine effect starts its own legs, so a batch across elements needs a coordinator in the spine, which is #87's. ADR-0027 left a cheaper API "beside `run` if a burst of starts shows up in a profile".
   - **#87 decides.** A Retarget of 1,000 elements took 106–149 µs an element in #76's page (the WSL host); #87 inferred core's two starts an element at about 45 ms of a 127 ms Retarget, and nothing else in it is profiled. Whether per-animation spans go is a call with the whole task in view: this breakdown goes to #87.
   - **Rejected for #83:** skipping the start log when Debug is filtered, narrowing its annotations, `runAll`, and dropping the span per run (#83, D).
10. **On the per-frame path, an index in range by construction is a plain read (amends `effect-first.md`'s per-frame forms).**
    - **The rule:** `xs[i]`, never `Arr.getUnsafe(xs, i)`. A value present by construction keeps `UndefinedOr.getOrThrow(x)`, which measured free and keeps a defect on a broken invariant. tsconfig has no `noUncheckedIndexedAccess`, so `xs[i]` types as `T` with no cast; an out-of-range read gives `undefined`, which throws on an object, or becomes a NaN that decision 7's check catches in development.
    - **Why: `Arr.getUnsafe` is a call V8 doesn't reduce to an index.** It's `dual(2, …)`, `Math.floor` and a bounds check (`Array.js:815-821`). One loop, ns per element against plain indexing, 11 paired reps, a fresh process or page each (`.tmp/83-index/`):

      | Loop | Form | Bun | Node | Chromium |
      |---|---|---|---|---|
      | a sum of numbers | `getUnsafe`, called before with three element types | ×5.97 [5.94, 6.00] | ×5.75 [5.69, 5.77] | ×6.03 [6.01, 6.05] |
      | | `getUnsafe`, not | ×5.73 [5.71, 5.74] | ×5.75 [5.66, 5.77] | ×5.98 [5.97, 6.01] |
      | | a module-local `at(xs, i)` | ×1.02 | ×1.00 | ×0.98 |
      | objects, calling a method | `getUnsafe`, called before with three element types | ×2.20 [2.10, 2.23] | ×2.86 [2.83, 2.87] | ×2.46 [2.44, 2.47] |
      | | `getUnsafe`, not | ×1.09 [1.07, 1.09] | ×2.86 [2.83, 2.86] | ×2.46 [2.44, 2.48] |

      In V8 the cost is the call itself; in JSC, the other element types its shared body has seen. **A new hot caller slows the old ones:** decision 11's in-place step, first written with `getUnsafe`, made Bun's `springValues/loop` 3.8× slower and Node's unchanged `animateComplex/loop` 48% slower, through the tick's own `getUnsafe`.
    - **Main pays for it today.** Its twelve per-frame calls (`internal/frameLoop.ts:128`, `:141`; `Machine.ts:260`; `Interpolator.ts:260`, `:261` twice, `:296` twice, the complex blend; `Easing.ts:205`, `:206`; `Scalar.ts:59`, `:62`) as plain reads (`probe/83-index`, `bench:core --base main`, 11 paired reps; noise controls Bun +0.8%, Node +0.6%, Chromium +1.4%): every row passes, and Node's bytes are unchanged or lower.

      | Workload | Bun | Node | Chromium |
      |---|---|---|---|
      | `animateComplex/loop` | −38.4% [−39.9, −37.4] | −7.5% [−8.3, −6.4] | −11.6% [−14.5, −9.9] |
      | `chase/loop` | −19.4% [−27.2, −14.8] | −4.6% [−13.7, −2.9] | −10.0% [−10.0, +0.0] |
      | `springValues/loop` | −13.0% [−18.1, −3.9] | −2.8% [−3.1, −2.4] | −1.7% [−8.6, +4.7] |
      | `springBlend/loop` | −12.9% [−16.0, +2.0] | +0.5% | −0.0% |
      | `animateComplex` (Stream) | −12.6% [−13.4, −11.4] | −1.3% [−2.7, −1.1] | −1.6% [−2.2, +0.0] |
      | the rest | −6.1 to +3.6% | −1.5 to +0.7% | −2.1 to +1.6% |

    - **`getOrThrow` doesn't pay.** Its five per-frame calls (`holdAfter`'s held ticks, `Machine.ts:381-382`; `springValues`' per-key loop, `:636-637`; `springBlend`'s `map`, `:859`) as plain reads on top (`--base probe/83-index`): every median between −4.7% and +2.3%, noise controls 0.0% to +1.0%.
    - **Held by lint:** `no-restricted-properties` on `Arr.getUnsafe` in the per-frame loop files and `Easing.ts`. Input-event code (`Reorder.ts`, `Velocity.trailing`) keeps it.
    - **Found with it:** `Interpolator.array`'s blend runs `Arr.map` with a closure each frame (`Interpolator.ts:127`), against the per-frame forms. It becomes a counted loop in the same slice, with a unit test. No bench workload interpolates an array, so it's unmeasured.
    - `effect-first.md` states the rule, and its *Pitfalls* the reason: an Effect function on the per-frame path is measured before it goes there, as a combinator layer is (ADR-0028, *Implementation in #94*).
11. **`springValues` steps in place (amends ADR-0027's decision 4 and ADR-0028's decision 7).**
    - **The leaf** rewrites its state and one Frame object per run each tick. The other leaves (`tween`, `spring`, `decay`, `chase`, `decayVec`) allocate their Frame per tick as now, until a measurement asks.
    - **The contract, on `FrameLoop.Sink` and `Machine.run`:** a Frame handed to a sink is the run's until the next tick, so a sink that keeps it copies it. `run`'s settled Frame is stable: nothing steps after a settle. **`Machine.toStream` copies a record Frame** (its `value` and `velocity`) before it emits, so a Stream consumer owns each emission and Tier 2's Stream semantics don't change.
    - **Measured** (`probe/83-in-place`: the leaf in place, with plain indexing, and `toStream`'s copy; `bench:core --base main`, 11 paired reps; noise controls Bun +1.3%, Node −1.2%, Chromium +0.5%). Its Frames are main's, through both drivers, on uneven dts (`.tmp/83-steps/parity.ts`). Every row passes.

      | Workload | Bun | Node | Chromium | Node MB per frame |
      |---|---|---|---|---|
      | `springValues/loop` | −39.1% [−39.9, −36.8] | −44.1% [−44.3, −43.6] | −46.7% [−50.7, −44.1] | 0.92 → 0.14 |
      | `springBlend/loop` | −5.5% [−14.3, −2.8] | −16.8% [−20.7, −15.2] | −14.3% [−18.5, −11.3] | 1.05 → 0.76 |
      | `springValues` (Stream) | −4.4% | −3.9% | −10.3% | 4.95 → 4.44 |
      | the other Stream rows (the copy) | −1.5 to +4.3% | −2.1 to +3.7% | −2.7 to +3.5% | +0.07 to +0.11 |
      | the other loop rows | −11.3 to +2.7% | −1.3 to +1.1% | −2.1 to +0.0% | unchanged |

      Node's one bytes flag, `animateValues/loop` 0.73 → 0.80 MB, is inside what it reads on identical code (0.69–0.80, ADR-0028, *Implementation in #94*). Steps alone (`.tmp/83-steps/`), GC was about 2.5% of main's step time, so the gain is the step's own work, not the collector's.
    - **Why `springValues`:** it's the binding's hottest leaf, the spine's numeric legs, presence's numeric exit and drag's snap to origin, and `springBlend`'s progress rides it.
    - **No sink that sees its Frames keeps one:** the spine's legs spread into new Snapshot objects, `gate.write` copies (`Object.assign`, `gate.ts:232`), `recordFrame` copies (`use-wardic.tsx:634`) and the settled Frame is dropped (`:930`); presence's `commitFrame` copies (`presence.tsx:205-209`); drag's snap to origin builds a fresh `{ x, y }` (`drag.ts:321`).
    - **Two sinks keep `decayVec`'s,** so it doesn't step in place until they copy: drag's fling release stores `frame.value` in its track's `Ref` (`drag.ts:303-305`), and `Drag.fling` emits `frame.value` (`Drag.ts:264-266`).
    - **Not measured:** a real page, where the gate's flush is about 80% of the loop's JS (#79), so the page's share of the gain is smaller than the loop rows (*inferred*).
    - **Rejected:** every leaf in place now: `decayVec`'s sinks keep its Frames, and nothing measured the others.
12. **The Clock's `time` and `dt` Atoms go.**
    - **Nothing reads them.** Their one reader is a Clock test (`packages/core/test/refresh-frame-clock.test.ts:305`, `:331-341`). `Clock.ts`, `packages/test/src/clock.ts:17-18` and `:71-72`, and `frame-loop.test.ts`' fake Clocks construct them. No `src`, the bench or the examples reads either.
    - **They're the Clock's only reason to need an `AtomRegistry`.** `Clock.fromRefreshFrames` then needs a `Scope` alone, and `ClockDomLive` drops its requirement. `DomLive` keeps the registry, for `Probe.viewport` and `prefersReducedMotion`.
    - **Not for CPU** (`.tmp/83-tick/`: a real Clock, one subscriber, 20,000 Refresh frames, without the two writes against main, 11 paired reps): Bun −3.7% [−10.3, +0.7], Node −2.8% [−3.9, −2.6], Chromium −2.5% [−5.1, −0.7], about 20–24 ns per Refresh frame, once per frame, not per element. #83's "probably nothing; one look" holds.
    - **The change:** `Clock.Clock` loses `time` and `dt`, and `@wardic/test`'s Clocks theirs, with no alias. The Clock test reads `ticks`. A frame-time signal, if an app ever wants one, reads `ticks`, as the legs do.
    - CONTEXT.md's flagged ambiguity on "Atom" names `Probe`'s Atoms alone.
13. **How #83 lands.** Each slice adds an *Implementation in* section here, and the amendments to the ADRs it changes, as ADR-0027's and ADR-0028's slices did.
    - **This record first,** docs only: ADR-0030; CONTEXT.md's Frame time and its "Atom" ambiguity; `effect-first.md`'s per-frame read rule; `pipeable.md`'s sink contract.
    - **#109 (slice 1), core: `Clock.delay` and the Clock's `time` / `dt` Atoms go** (decisions 1 and 12). It amends ADR-0025 (decision 8's `Schedule` bullet), ADR-0028 (decision 12's services row), ADR-0006 and ADR-0017 (the Atoms).
    - **#110 (slice 2), core: per-frame reads are plain** (decision 10), with the lint and `Interpolator.array`'s loop.
    - **#111 (slice 3), core: `springValues` steps in place** (decision 11), with the sink contract and `toStream`'s copy. Blocked by #110. It amends ADR-0027 and ADR-0028.
    - **#112 (slice 4), core: `FrameLoop.CheckFrames`** (decision 7).
    - **#113 (slice 5), the bindings: failures reported where they stop** (decision 4), with the docs' `env` recipe (decisions 5 and 6) and the devtools check.
    - **Comments, not slices:** #87 (decision 9's breakdown, and whether spans per run stay); #45 and #69 (decision 1: their timers and policies are wall time, Effect's); #66 (decision 2); #68 and #79 (decisions 10 and 11); #23 (decision 1's open questions).
    - **Filed from #83's "tick as fixed phases":** #114, React Native's one multiplexed `requestAnimationFrame`, a Clock tick and a gate flush from one callback (`docs/research/clock-and-scheduler.md`, Option C), which no issue held. The other gap, the coordinator's place in a tick, is answered: order within a tick is add order, and nothing depends on it (ADR-0027, *Implementation in #75*).

## Consequences

- **Breaking, for Tier 2 and Environment authors:** `Clock.delay` and the Clock's `time` and `dt` go, and `Clock.fromRefreshFrames` no longer needs an `AtomRegistry` (#109). A sink keeps a `springValues` Frame only by copying it (#111). Core is unpublished, so nothing is aliased.
- **Effect's time is wall time, everywhere.** Frame time is what the Machine combinators hold, and CONTEXT.md now defines it. A frame-time `effect/Clock` waits for a caller, with decision 1's questions to answer.
- **Failures reach the console and an app's reporters wherever the bindings stop them,** including the three boundaries that were silent (#113). Core reports nothing; each run's failure stays its caller's.
- **An app configures observability on `env`,** with Effect's own layers: a logger and a level, its reporters, the devtools. Wardic ships none of them, and its defaults are Effect's.
- **The per-frame path gets faster** at no change in Frames: up to 38% on `animateComplex/loop` from plain reads (#110), and 39–47% on `springValues/loop` from stepping in place (#111), with Node's bytes per frame there 0.92 → 0.14 MB.
- **A dev check exists for non-finite Frames,** off by default and free when off (#112).
- **The start path is #87's,** with this record's breakdown, and per-animation spans stay until its profile says otherwise.
- **Not done here:** typed build errors (#66's); a `StepDefect`; a frame budget warning; a `devLayer`; `runAll`; stepping in place for the other leaves.
