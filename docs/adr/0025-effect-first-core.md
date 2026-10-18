# Effect-first core: Effect's modules over vanilla TypeScript, no ternaries, and a per-frame path that allocates nothing

Core's code uses Effect's modules for its loops, its boolean checks and its missing values, and it has no ternary operators (#63). The exception is code that runs once per Clock tick, per key or per node, the **per-frame path**. It keeps both rules, but in forms that allocate nothing per call: written with the combinators, it cost 13–44% frame time at 1,000 elements. Core's surface becomes Effect-native, and hiding Effect is the bindings' job, which amends ADR-0008. The working rules are in [`docs/agents/effect-first.md`](../agents/effect-first.md), and ESLint holds them on `packages/core/src`.

## Why

- **The rules were set on 2026-10-07,** reviewing `blendersFor` in #62 (`1540cd2`, `8581b87`). The aim is uniform, concise code that gets the full benefit of Effect.
- **Where core stood at `8581b87`:**
  - Effect modules imported, by number of files: Effect 19, Stream 17, Context 7, Option 2, and Predicate and Record 1 each. `Array`, `Match`, `Boolean`, `Number`, `String` and `Schema`: none.
  - Vanilla idioms: about 76 ternaries, 21 loops, 144 `if`s, 11 `typeof` checks and 86 `undefined` / `??` checks (#63's table).

## Decisions (grilled 2026-10-07 against effect `4.0.0-rc.117`'s `dist`)

1. **The rules.**
   - **Effect over vanilla TypeScript:**
     - loops use `Arr` / `Rec` / `Iter` and `Effect.forEach` / `Effect.all`;
     - boolean checks are named `Predicate`s;
     - missing values use `Option`, and `UndefinedOr` (new in v4) reads a value that is already `A | undefined` without allocating a `Some`;
     - `Match`, `Schema`, Services, `Scope` and `Schedule` are used where they fit.
   - **No ternary operators:** `Boolean.match`, `Option.match` or `Match` instead.
   - **Scope:** `packages/core/src`. New code in dom, solid and test follows the rules too; converting their existing code is #69.
2. **`if` and `switch`.** It depends on what the branch does:
   - `switch` becomes `Match`;
   - a branch that picks a value (an `if … else` included) is a match;
   - an `if` with no `else` stays, as a statement: a guard around a side effect, or an early return in per-frame code;
   - every condition follows rule 1.

   Banning `if` outright would turn each guard into `Boolean.match(cond, { onTrue: stop, onFalse: constVoid })`: noise and an allocation, with nothing gained. Leaving every `if` alone would leave the value-picking `if … else`, which is a ternary over several lines.
3. **The per-frame path keeps both rules in allocation-free forms.**
   - **What's on it:**
     - the steppers;
     - `multi.ts`'s `blendAt`, its blenders, and `springValues`' per-tick step;
     - the `Stream.map` / `mapAccum` bodies in `scalar.ts` and `chase.ts`, and `decayVec`'s in `momentum.ts`;
     - the easings;
     - each Interpolator's `interpolate`, and the registry's resolved closures;
     - `math/`, `layout/box.ts` and `layout/projection-geometry.ts` (dom's projection pass calls them per node, per frame);
     - `util/velocity.ts`, and the functions `util/generators.ts` returns.

     Input-event code (recognizers, reorder, the held pointer) gets the full rules: its volume is one gesture's events, not every key on every frame.
   - **The forms:**
     - a statement `if` or `Math.min` / `max` for a ternary;
     - no `Option`, `Match`, `Num.clamp`, `Rec.map` or closure-taking `Boolean.match` on each call;
     - options resolved once, when the stream is built;
     - `for` for counted numeric loops and for loops over a stream's keys;
     - arithmetic stays arithmetic.
   - **Lint and loops:** lint lets exactly the files that need such a loop have one.
   - **`blendAt` returns from #62's `Rec.map` to a loop.**
   - **Measured before deciding.** The per-frame kernels were rewritten with the combinators (`Boolean.match`, `Match.value`, `Num.clamp`, `Option` defaults, `Arr.reduce` substeps, `Rec.map`) and timed against core as it was.
     - **Per call** (median ns, 9 fresh processes or pages; a throwaway probe, minified bundles):

       | Case | Chromium 147 | Bun 1.3 (JSC) |
       |---|---|---|
       | the Discrete switch, with `Boolean.match` | 1.5 → 6.0 | 1.1 → 21.7 |
       | `easeInOutElastic`, with `Match.value` | 43.5 → 140 | 26.0 → 160 |
       | `clamp`, with `Num.clamp` | 13.2 → 38.5 | 3.6 → 55.6 |
       | `springStep`, with `Option` defaults and `Arr.reduce` substeps | 63.5 → 280 | 182 → 383 |
       | `blendAt`, 4 keys, a loop → `Rec.map` | 81 → 131 | 29.8 → 67.8 |
       | an Effect round trip per frame (`Effect.runSync`), against `blendAt`'s 81 | 1,195 | 1,540 |

       The allocation-free form matched the old code everywhere. `springStep` with its options resolved once was 30% faster in JSC.
     - **Per frame** (median ms per Refresh frame, 1,000 elements, 5 reps; the prototype of decision 4's bench):

       | Workload | Chromium | Bun | Node | V8 MB per frame |
       |---|---|---|---|---|
       | `ticksOnly` (the same code in both builds) | 3.00 → 3.21 | 9.66 → 8.92 | 6.70 → 6.37 | 2.28 → 2.22 |
       | `springValues` | 5.52 → 7.95 (+44%) | 14.4 → 20.4 (+42%) | 10.1 → 11.4 (+13%) | 2.72 → 8.45 |
       | `chase` | 4.80 → 5.45 (+14%) | 13.5 → 15.4 (+15%) | 7.5 → 8.5 (+14%) | 5.52 → 7.85 |
       | `springBlend` | 11.4 → 12.2 (+7%) | 24.1 → 27.1 (+12%) | 15.5 → 16.5 (+7%) | 3.40 → 6.54 |
       | `animateValues` | 12.5 → 12.8 (+2%) | 24.7 → 28.2 (+14%) | 18.3 → 19.2 (+5%) | 3.98 → 5.55 |
4. **A committed frame bench, ahead of the conversion.**
   - **What it runs:** `bun run bench:core --base <ref>` (`packages/core/bench/`) builds core at the ref and the working tree's core. It runs both through core's real streams (1,000 elements, a manual Refresh frame source, the Effect scheduler on microtasks), in paired reps, in Bun, Node and Chromium (cross-origin isolated).
   - **The gate:**
     - **Time:** a workload fails when its median per-rep head / base ratio passes +5% *and* its 25th percentile is above 0%, so at least three pairs in four ran slower.
     - **Bytes:** Node's bytes per frame fail at +5%.
     - **Noise:** `ticksOnly` runs the same code in both cores and is the noise control. A run where its median is off by more than ±3% is rerun.
     - Start time is reported, not gated.
   - **Why both conditions.** The plan was the median alone at +5%, and the baseline below ruled it out. Run against itself, a single Chromium pair swung ±17%, and a workload's median wandered from −6.7% (Node, `chase`) to +4.0% (Chromium, `chase`). Bytes per frame didn't move at all on unchanged code, and allocation is what decision 3 is about.
   - **Not CI:** it takes about 15 minutes and is noisy.
   - **The baseline at `02ecce7`,** 11 paired reps of `02ecce7` against itself, 1,000 elements. Medians of the base side:

     | Workload | Chromium 147 ms per frame | Bun 1.3 | Node 22 | Node MB per frame | Start ms (Chromium / Bun / Node) |
     |---|---|---|---|---|---|
     | `ticksOnly` | 3.72 | 10.01 | 6.94 | 2.10 | 24 / 47 / 31 |
     | `springValues` | 6.51 | 15.06 | 10.75 | 2.53 | 43 / 77 / 81 |
     | `animateValues` | 13.58 | 26.09 | 18.41 | 3.79 | 116 / 172 / 129 |
     | `springBlend` | 12.44 | 24.18 | 14.91 | 3.21 | 92 / 143 / 110 |
     | `chase` | 5.63 | 14.25 | 8.11 | 5.32 | 35 / 68 / 50 |

     Against itself, the paired ratios' medians were within −1.1% to +1.2% in Bun, −6.7% to +1.1% in Node, and −2.3% to +4.0% in Chromium.
5. **ESLint on `packages/core/src`.**
   - `no-ternary`;
   - `no-restricted-syntax` on `SwitchStatement`, `IfStatement[alternate]`, `??` (with `??=` and `?.`, the same missing-value check), `=== undefined` / `!== undefined`, `typeof` in a comparison (as a value, `typeof target` names a span attribute), and the five loop statements;
   - `@typescript-eslint/no-non-null-assertion`.

   The per-frame files that need a loop get a `files` override for the loop rules alone: `primitives/stepper.ts`, `primitives/multi.ts`, `interpolate/complex.ts`, `math/index.ts` and `layout/projection-geometry.ts`. `bun run lint` runs in CI. The six modules that hide a global take fixed aliases (`Arr`, `Rec`, `Num`, `Str`, `Bool`, `Iter`), and lint rejects a namespace import under the global's name. Lint can't judge whether a `Predicate` is *named*, or whether `Match` or `Scope` "fits", so those stay with review.
6. **Schema where values are decoded and encoded, never per frame.**
   - **Bundle size is not the constraint.** Core already ships Schema through `effect/reactivity`'s `Atom`. Using it adds about 0.15 KB min + gz to a consumer importing three core exports (69.6 → 69.8 KB), and 0.2 KB to all of core (82.0 → 82.2 KB). `Match`, `Array`, `Boolean`, `Number`, `String` and `Iterable` together add 1.0 KB.
   - **The fits:** each Interpolator's value kind as a codec (#65), and the option bags at the public boundary (#66).
   - **Not in #63:** a decode validates, and what to reject is a behaviour change. So #63 resolves options through `Option`.
   - **The codec measurement:** decoding a unit string through a Schema codec costs 433–491 ns, against 87–90 ns for the regex parse. That's fine when a stream is built. `Schema.encode` costs 155–236 ns, against 6–14 ns for a plain encode, which is why the frame calls the codec's plain encode function.
7. **Core is Effect-native; the bindings hide Effect (amends ADR-0008).**
   - **Core's functions use Effect types where they're natural.** `baseValueOf`, `startValueOf`, `transformIdentity` and `unitOf` return `Option`, and `autoScrollStep` takes and returns its state as one. So do the callbacks a binding passes in: `BaseSources.style` / `own`, and the reorder item's `layoutBox` / `axis`.
   - **The shapes users write stay plain TypeScript:** option bags, `Values`, the `Frame` types.
   - **Pure values stay plain** because nothing in them is missing or effectful: the easings, `math/`, `springs`, `stagger`.
   - **dom and solid unwrap at their call sites,** in the commit that changes each signature.
8. **The Clock's frames come from the Environment, not from Effect's `Scheduler` or `Schedule`.**
   - **The two roles:**
     - *When frames happen* is the Environment's `RefreshFrameSource`, through `Effect.callback` (`makeRefreshFrameClock`). Effect's own `Clock.sleep` wraps `setTimeout` the same way (`internal/effect.js:2839-2842`).
     - *When woken fibers run* is Effect's `Scheduler`, a `Context.Reference` an Environment may provide (#67).
   - **Why the Scheduler can't drive frames:**
     - its tasks are `() => void`, with no frame timestamp;
     - it governs every fiber, so the Priming tick (ADR-0017), the Measure pass (ADR-0018) and input handling would move to the next frame;
     - a fiber waiting on frames can't process an interruption in a background tab;
     - and it would contradict ADR-0017's decision 3.
   - **`Schedule`** sleeps after each step (`Effect.repeat`), and a 0 ms sleep is a `yieldNow`. It runs on wall time, as all of Effect's time does; `delay`, `stagger` and the `repeat` legs run on frame time, through the Machine combinators. It's not a mismatch to fix but the split: *Amendment (#109)*.
   - **No CPU to gain.** The element fibers already run on Effect's built-in scheduler, and its four configurations were within noise. Chromium, 1,000 elements, ms per frame:

     | Configuration | `ticksOnly` | `springValues` | `springBlend` |
     |---|---|---|---|
     | default (a dispatcher per fiber, `setTimeout(0)`) | 3.42 | 6.46 | 11.88 |
     | microtasks per fiber | 3.83 | 5.74 | 11.91 |
     | one shared dispatcher | 3.50 | 6.44 | 12.33 |
     | one shared dispatcher, drained at the end of the frame callback | 3.72 | 6.70 | 12.59 |

     The drain's value is latency, not CPU: the gate could flush in the same frame (#67).
   - **#63 converts the Clock to the rules only.**
9. **v4 modules.**
   - **Used in #63:** `Match`, `UndefinedOr`, `Arr` with `Order` / `Equivalence` (reorder), `MutableRef` for the mutable cells in synchronous callbacks, `Combiner` with `Rec.union` (`resolveOverrides`), `Effect.fn` (`group`, `onSettle`, `applyTo`, `delay`, `wait`), `Struct` and `Tuple`.
   - **Follow-ups:** `RcMap` (dom's Shared sources, #69), `Scheduler` (#67), `Schema` (#65, #66).
   - **No fit in core:**
     - `ExecutionPlan` (fallback steps that each provide a Context or Layer, with retries); core's fallback chains are chains of pure values, which `Option.orElse` and `Arr.findFirst` express;
     - `Graph`, `Optic`, `HashMap` / `HashSet`, `Tx*`, `Cache` / `Request`;
     - `Data.TaggedEnum`: core's Tier 2 unions use `type`, which `Match.discriminator` reads as it is.

## Considered Options

- **Banning `if` outright, or leaving it alone** (decision 2). Rejected, as above.
- **The rules applied uniformly per frame, with the bench vetoing conversions one at a time** (decision 3). Rejected: closures over `t`, `from` and `to` can't be hoisted, so most easings and interpolators would come back as exceptions anyway, each argued case by case.
- **A throwaway bench in `.tmp/`, as #57 had** (decision 4). Rejected: the numbers here couldn't be reproduced, and the next per-frame change would have no bench.
- **Oxlint or Biome** (decision 5). Rejected: neither supports `no-restricted-syntax` selectors, which most of these rules need. **No lint:** rejected, because the rules would drift.
- **Schema in #63,** for the option bags or as interpolator codecs (decision 6). Rejected for #63: the first changes behaviour, and the second redesigns a Tier 2 extension point (`InterpolatorEntry`). Both are follow-ups.
- **`Option` inside core, `undefined` at its boundary** (decision 7). Rejected: core's customers are Environment and binding authors, and hiding Effect is the bindings' job (ADR-0001, ADR-0008's own principle).
- **The Clock driven by `Schedule` or by a frame-driven `Scheduler`** (decision 8). Rejected, as above.

## Consequences

- **Breaking (Tier 2):** the signatures in decision 7.
- **The follow-ups:**
  - #64: Effect stable, `effect/unstable/reactivity` → `effect/reactivity`;
  - #65: interpolators as Schema codecs; also the colour and complex interpolators' per-frame parse;
  - #66: option bags through Schema;
  - #67: Environment-provided Scheduler;
  - #68: core's per-frame cost at 1,000 elements (the floor is 3 µs per element per frame in Chromium and 2.3 MB per frame in V8, which is ADR-0006's condition for its central coordinator);
  - #69: dom, solid and test to the rules.
- **Imports and the browser tier:** each `effect/*` module core newly imports is listed in `optimizeDeps.include` in the dom browser config and in solid's browser and hydrate configs, so a warm Vite cache doesn't reload mid-run (#62, `24e24c6`).

## Amendment to ADR-0008

- **Tier 1** is the bindings' API, plus the plain shapes and pure values core exports: option and config types, `Values`, the `Frame` types and `isPhysicsFrame`, the easings, `math/`, `springs` and `stagger`. These carry no Effect types because nothing in them is missing or effectful.
- **Core's functional surface is Tier 2:** Effect-native (`Option`, `Effect`, `Stream`), for Environment and binding authors, and "stability tracks Effect". The "Effect-free Tier 2" label (`base-value.ts`, `reorder/group.ts`) is retired.
- **The bindings keep ADR-0008's principle** that Effect is invisible to users.

## Amendment (#65, 2026-10-07): the bytes gate counts what a GC frees

Decision 4's bytes gate skipped a round with a GC in its window, but its `PerformanceObserver` reports as a task, and a window only awaits microtasks, so it never saw a scavenge inside one: the heap delta lost what the scavenge freed, without the round being skipped. A core that allocated enough to scavenge was under-counted, the more so the more it allocated, and the MB per frame figures above read low wherever a window scavenged (`ticksOnly` 3.09 MB per frame at `871a898`, not the 0.94 the gate printed). `one.mjs` now counts the used heap plus every byte a GC has freed, from a `v8.GCProfiler`, and every round counts (ADR-0026, Consequences). The +5% gate itself is unchanged.


## Amendment (#68, 2026-10-08): the Frame loop's per-frame path, and its bench workloads

- **Decision 3's per-frame path gains the Frame loop's tick and every Primitive machine's step** (ADR-0027). A step and a sink are plain functions, typed so that an Effect can't be returned from either. A file whose per-frame code needs a loop joins `PER_FRAME_LOOPS`.
- **Decision 4's bench gains loop workloads:** `springValues`, `springBlend`, `animateValues`, `animateComplex` and `chase`, at N = 1,000.
  - They're report-only in #68, since main has no Frame loop, and gated from the next PR, after a baseline of head against itself (11 paired reps).
  - The `Stream` workloads keep gating as before. `ticksOnly` stays the ±3% noise control.

## Amendment (#109, 2026-10-11): `Schedule` runs on wall time, and that's the split

ADR-0030's decision 1: Effect's time stays wall time, and frame time (CONTEXT.md) is what a run on the Clock counts.

- **Decision 8's `Schedule` bullet** now reads: `Schedule` runs on wall time, as all of Effect's time does; `delay`, `stagger` and the `repeat` legs run on frame time, through the Machine combinators (`Machine.delay`, `holdAfter`, a tween's `duration`).
- **`Clock.delay` goes,** the one wait in frame time outside the combinators. Its one caller was its own test.
- **A frame-time `effect/Clock` waits for a caller,** with ADR-0030 decision 1's questions to answer: its reach, what its `currentTime*` report, what `sleep(0)` means, and raw or clamped `dt`.

## Amendment (#69, 2026-10-16): the rules reach dom, solid and test

#69 converts `@wardic/dom`, `@wardic/solid` and `@wardic/test` to these rules (grilled 2026-10-16, Q1–Q6 all A). On main `300c431`, core's rules flagged about 750 places in their source (dom 479, 232 of them in `internal/projection.ts`; solid 266; test 7) and 2,129 in their tests. Since #63 the rules already applied to new code there. Two of the issue's deliverables had landed by then: dom's Shared sources are on `RcMap` / `RcRef` (`internal/shared.ts`), and dom's API shape is ADR-0041's.

1. **dom's surface follows core's (Q1): `Option` for a missing value,** in its returns and in the callbacks a binding passes in (decision 7, *Amendment to ADR-0008*). Option bags keep their `?:` fields, read through `UndefinedOr`, and per-frame members stay plain. The places this changes:
   - **Returns:** `ProjectionSystem.NodeHandle`'s `layoutBox` and `handBackWithin`; `OwnValues.OwnValue`, `valueLike` and `styleValueOf`.
   - **Callbacks a binding passes in:** `RegisterNodeOptions`' `transition`, `dragTransition`, `onLayoutAnimationStart` and `onLayoutAnimationComplete`; `ReorderController.Options`' `axis` and `announcements`; a Reorder item's `element`.
   - **Already `Option`:** `Variables.resolve`.

   Solid unwraps at its boundary, as it does for core's. dom's audience is binding authors, Foldkit among them (ADR-0041).
   - Rejected: keeping `| undefined` at dom's surface, which leaves it mixed and has an Effect binding wrapping every read; `Option` in returns only.
2. **dom's per-frame files, by core's file-level rule (Q2).** `projection.ts`, `gate.ts`, `renderer.ts`, `svg.ts`, `scale-correction.ts`, `key-rules.ts` and `measure.ts` (all under `packages/dom/src/internal/`) join lint's per-frame lists: they may keep a `for`, and they read by index with `xs[i]`. Their cold code follows the full rules by review, as `Machine.ts`'s does.
   - **The per-frame code:**
     - dom's: the projection pass (the coordinator's step and its write per node), the Measure pass's reads per node, the gate's `write` and flush, the Renderer's `project`, the SVG split in a flush, the scale correctors, and the Key rules' `KeyBlend`s and the colour blend.
     - solid's: only its run sinks (`Machine.run((frame) => gate.write(…))`, presence's `commitFrame`, drag's `tapFrame`), one-line closures, so no solid file is listed.
   - **The start path** (per key, at an animation's start: solid's `use-wardic.tsx`) isn't per frame. It keeps the full rules, and `bench:solid` checks their cost.
   - Rejected: splitting `projection.ts` first, so only its per-frame half is listed; a disable comment on each per-frame loop.
3. **Tests (Q3):** the existing line holds ("tooling: no ternaries, and the rest where it reads well"), and lint now holds its one hard rule. `no-ternary` covers every package's tests and benches, core's included, which means 164 ternaries to rewrite. Nothing else in test code is converted wholesale: most of the 2,129 are a `!` on a lookup a test just made, or a `for` that fires frames.
   - Rejected: tests unlinted, as before; the full rules in tests.
4. **One-shot delays are `Effect.sleep` in a fiber, not a `Schedule` (Q4).** `Schedule` describes repetition. These are delays that restart or cancel. This refines *Amendment (#109)*: wall time is still Effect's.
   - **The Resize block's 250 ms** (ADR-0018, *Amendment (#39)*) and **Reorder's held-arrow thinning, 150 ms** (ADR-0037) become `Effect.sleep(<Duration>)`, then their action, in a `FiberHandle` in the owner's Scope. Running the handle again restarts the delay; clearing it cancels.
   - **The Measure pass's `leftover`,** the next task's pass after the round cap, becomes `nextTask`: a 0 ms timer as an Effect (`Effect.callback` around `setTimeout(0)`, cleared on interruption). It's a next-task hop under any Scheduler, a microtask one included (Foldkit's, #208).
     - **Corrected in PR 3** (re-grilled, A): this first said `Effect.sleep(Duration.zero)`, on the belief that Effect's Clock always sleeps on a timer. For zero it doesn't: `sleepMillis(0)` returns `yieldNow`, and in dom's browser tests that resumed in the same task, so the round-cap test read 6 passes where the cap allows 5.
     - Rejected then: `Effect.sleep(Duration.millis(1))`, a 1 ms timer that the test's own 0 ms wait can beat; keeping `Duration.zero`.
   - **The Scope ends them,** in place of `clearTimeout` in a `dispose`.
   - Rejected: a `Schedule` for each, which here only wraps `Effect.sleep` in a repeat that never repeats; keeping `setTimeout` with a written exemption.
5. **Five PRs, each switching lint on for what it converts (Q5):**
   1. dom's surface on `Option`, with solid's call sites;
   2. dom's internals outside `projection.ts`, with lint on for dom's source but `projection.ts`;
   3. `projection.ts`, with the Resize block's and `leftover`'s timers;
   4. solid's internals;
   5. test's source and every package's test ternaries, with `no-ternary` in tests.

   **Checks:**
   - every PR: the gates, the lab's drives, and the `optimizeDeps` rule (each new `effect/*` import listed in all three browser configs in the same commit, and no "optimized dependencies changed" in a warm-cache `test:browser` log);
   - PRs 2 and 3: the gate-flush and projection-pass page probes, paired with an A/A;
   - PRs 1, 3 and 4: `bench:solid` with an A/A;
   - the timers: mutations on the restart and the cancel;
   - `bench:core` only if core changes.

   Rejected: one PR per package; one PR.
6. **This amendment (Q6).** Each PR adds an *Implementation in #69's PR n* below. `effect-first.md` gets the scope, the per-frame code by name and the test rule as they land, and ADR-0041 points here for dom's `Option` surface.
   - Rejected: a new ADR; no ADR.

## Implementation in #69's PR 1: dom's surface on `Option`

- **The members:**
  - **`ProjectionSystem`:** `NodeHandle.layoutBox()` and `handBackWithin(…)` return `Option`. `RegisterNodeOptions`' `transition`, `dragTransition`, `onLayoutAnimationStart` and `onLayoutAnimationComplete` return `Option` (`None` for Motion's default, or no callback).
  - **`OwnValues`:** the reader (`OwnValue`), `styleValueOf` and `valueLike` return `Option`.
  - **`ReorderController`:** `Options`' `axis` and `announcements`, and an item's `element`, return `Option`.
- **The internals** keep `undefined` behind the surface, wrapped at it (`Option.fromUndefinedOr`), until PRs 2 and 3. The engine reads a callback's `Option` where it reads it: `Option.getOrElse` for a transition, `callAppIfAny` for a layout animation callback.
- **Solid** wraps its Tier 1 options into `Option` where it registers a node (`useLayoutMember`), its Reorder group and items, and unwraps what it reads (presence's hand-back, the spine's style and own links). Tier 1 is unchanged.
- **The tests** construct and read the new types; a syntax-aware rewrite took `transition: () => (…)` to `transition: () => Option.some(…)`.
- **`effect/Option`** joins the three browser configs' `optimizeDeps`, where it wasn't listed.
- **Checks:**
  - **`bench:solid`** against main `300c431`, 11 paired reps, warm: mount +0.6%, Retarget +0.2%, at rest −0.6%, unmount +0.4%. Main against itself read +2.6%, +0.4%, +0.2% and −0.8%. Exit 0.
  - **Lab** (5173, restarted on this branch):
    - smoke 0 errors;
    - crossfade board 54 runs, 0 fails;
    - held 30 runs, 0 off;
    - scenario 15, 14 runs clean;
    - scenario 7 `passes 1 (1 seeding)`;
    - scenario 17's lines as main's;
    - keyboard reorder announced;
    - real-mouse drags 0.00 px, 0 frames behind.

    One scenario-17 line, "Untriggered, then Shuffle, triggered (expect wrong-origin)", reads `clean` here and on main (`.tmp/4/drive17.ts`'s label is stale).
  - **Gates:** typecheck, lint, unit (963), browser (1007), the lab's tsc and vitest (208). No "optimized dependencies changed" in the browser log.

## Implementation in #69's PR 2: dom's internals outside `projection.ts`

- **Lint** holds the rules on dom's source, but `internal/projection.ts` until PR 3. The per-frame files (decision 2) keep a `for` and plain index reads. On main `e1e86c9` that flagged 224 places in 16 files, all converted.
- **The per-frame files** (`renderer.ts`, `svg.ts`, `scale-correction.ts`, `gate.ts` and `measure.ts`) take the per-frame forms:
  - statement `if`s with an early return, and `Predicate` checks in place of `typeof` and `=== undefined`;
  - no `Option` or `Match` per call;
  - a value that may be missing is still `undefined` there, checked in an early return.
- **The cold code** (announcer, input, probe, shared sources, Starting style, own values, Auto-scroll, the Reorder controller) takes the full rules: `Option` for a missing value, `Match` / `Bool.match` for a branch, `Arr` for a loop, `MutableRef` for the controller's mutable state.
  - **The CSS-text scanner** (`parseCssText`) is an `Arr.reduce` over the text's UTF-16 units. On 20,016 inputs, hand-picked and random (quotes, escapes, nested parentheses, non-ASCII), it gives what main's did.
- **PR 1's two shims are gone:** the Own-value reader and a Reorder item's element are `Option` inside too.
- **Reorder's held-arrow thinning** (decision 4) is `Effect.sleep(REPEAT_ANNOUNCE)` (150 ms), then the announcement, in a `FiberHandle`. The handle lives in a Scope of the controller's own, which `dispose` closes. An announcement spoken at once clears the handle.
- **The start path's matchers are built once.** The first draft wrote `valueLike`, `entryOf` and `resolveInitial` with `Match.value(x).pipe(…)`, which builds its matcher on every call. `bench:solid`'s Retarget failed its gate on it, +7.7% [+6.6, +9.5].
  - **The profile** (`.tmp/87/prof.ts`, main built from a worktree) showed it as `pipeArguments`, Effect's matcher builder and their garbage.
  - **The fix:** module-level `Match.type` matchers over the call's inputs. `valueLike` went from 136 ns a call to 46, main's 30 (Node).
  - **`effect-first.md`** now says so under `Match`.
- **Tests:**
  - **KB12:** an announcement spoken at once cancels a held arrow's waiting one, so a drop right after it is all that's said.
  - **The existing tests pass unchanged,** dom's RC tests on the controller's factory (now with a two-method runner).
- **Mutations** on the timer, 4:
  - **Caught:** a repeat that doesn't restart the wait (KB8), no wait (KB8, KB11), and an announcement at once leaving the wait (KB12, written for it).
  - **Survives:** `dispose` leaving the controller's own Scope open. Under `ReorderController.make` the runner forks into the controller's Scope, which ends the wait anyway.
- **`effect/Duration`** joins the three browser configs' `optimizeDeps`.
- **Timing** against main, each paired with main against itself (A/A):
  - **`bench:solid`** (11 paired reps, warm), after the matchers' fix: it passes its gate on both runs.

    | Task | Run 1 | Run 2 | A/A |
    |---|---|---|---|
    | mount | +3.0% | +4.2% | −0.8% |
    | Retarget | +0.0% | +1.9% | +0.0% |
    | at rest | +3.0% | +1.5% | −2.4% |
    | unmount | −3.2% | −15.7% | −0.5% |

  - **The gate's flush per frame** (`.tmp/132-flush`, whole-frame JS, 11 reps): transform +1.0% (A/A −0.5%), mixed −0.4% (−1.4%), flip +1.8% (+0.9%), styled +2.6% (+0.3%), partial +5.2% [+2.6, +5.5] (+0.3%).
  - **The projection pass per frame** (`.tmp/132-proj`, 9 reps, 1,000 nodes): glued −1% (A/A −1%), delay −3% (+4%), flip +4% (+3%), scaled +6% (+1%).
  - **What's unexplained:** partial, styled and scaled read 2–6% over their A/A, consistently across runs.
    - **No function I changed costs more in isolation:** the Renderer's `project`, minified in Chromium, is 120–271 ns a call on main and on this branch alike, on both its paths (`.tmp/69-pr2/project-micro*`).
    - **The SVG check** costs the same in each form (14–16 ns).
    - **The style writes per frame are identical** (116,000 `setProperty` calls per key either way).
    - **A bisect** with one file reverted to main's at a time read partial +0.6% with main's `renderer.ts`, +3.4% with main's `svg.ts` and +2.2% with main's `gate.ts`, against the branch's +3.1%. Styled read +2.3% to +3.6% for each, so no single file.
    - **A profile of partial** spreads it thin over `apply`, `project`, `write` and `setProperty`.
- **Lab** (5173, restarted on this branch):
  - smoke 0 errors;
  - crossfade board 54 runs, 0 fails;
  - held 30 runs, 0 off;
  - scenario 15, 14 runs clean;
  - scenario 7 `passes 1 (1 seeding)`;
  - scenario 17's lines as main's;
  - keyboard reorder announced;
  - real-mouse drags 0.00 px, 0 frames behind.
- **Gates:** typecheck, lint, unit (963), browser (1008), the lab's tsc and vitest (208). No "optimized dependencies changed" in the browser log.

## Implementation in #69's PR 3: `projection.ts`

- **Lint** holds the rules on all of dom's source (main `6d1287e` flagged 165 places in `projection.ts`, all converted).
- **The node state keeps `undefined`.** It's read per node per frame, so it's checked with `Predicate` in early returns (decision 2's per-frame forms): 102 `=== undefined` checks became `Predicate.isUndefined` / `isNotUndefined`.
  - **Ternaries, `??` and `?.`** became small per-frame helpers with early returns (`definedOr`, `offsetUnlessZero`, `projectionPatchOf`, `layoutAnchorOf`, `rootShareOf`, `containerScrollOf`, the fold's `foldAt` / `withScroll` / `readScrollOf`), the existing `boxOf`, or `Math.min`.
  - **`if … else`** became early returns, or `continue` in a loop.
  - **The cold paths** (`debug`, a leaver's hold, `handleLeave`) use `UndefinedOr.match`, `Bool.match` and `Option`.
- **The Resize block's 250 ms** (decision 4) is `Effect.sleep(RESIZE_BLOCK)` in a `FiberHandle` in the engine's Scope. A later width change restarts it (`FiberHandle.setUnsafe`), and a pass clears it.
- **The round cap's next-task pass** is `nextTask`: a 0 ms timer in an `Effect.callback`, cleared on interruption, forked into the engine's task fibers.
  - **Re-grilled** (A): the first draft's `Effect.sleep(Duration.zero)` is a yield, which resumed in the same task, and the round-cap test read 6 passes where the cap allows 5. Decision 4 above is corrected.
  - **The Scope ends both waits.** The `clearTimeout`s in `dispose` are gone.
- **New test RB12:** a burst of width changes longer than the block (five, about 100 ms apart) ends in one blocked pass, because each change restarts the wait. It checks its own spacing: no gap reaches 250 ms, and the burst outlasts it. Five runs in a row passed.
- **Mutations** on the waits, 6:
  - **Caught (5):** no restart (RB12, written for it), no wait (RB1, RB8, RB10), a wait that never runs the pass (RB2, RB3, RB6), the round cap's hop as a yield, and no next-task pass (the round-cap test).
  - **Survives (1):** a pass leaving the wait uncleared. The wait runs a pass only while the block is set, and a pass clears the block.
- **Timing** against main `6d1287e` (PR 2 included), each paired with main against itself (A/A):
  - **The gate's flush per frame:** transform +1.5% (A/A −0.5%), mixed −0.4% (0.0%), flip −2.5% (−3.2%), styled −1.0% (+2.1%), partial −0.0% (+0.3%).
  - **The projection pass per frame:** glued +1% (A/A −3%), delay 0% (+2%), flip +2% (0%), scaled −3% (−1%).
  - **`bench:solid`**, two runs, warm: mount −1.4% / −1.0%, Retarget −0.9% / +0.3%, at rest +4.7% / −0.8%, unmount −0.8% / +1.5%. The A/A read −2.0%, 0.0%, −0.9% and −5.3%. Exit 0.
- **Lab** (5173, restarted on this branch):
  - smoke 0 errors;
  - crossfade board 54 runs, 0 fails;
  - held 30 runs, 0 off;
  - scenario 15, 14 runs clean;
  - scenario 7 `passes 1 (1 seeding)`;
  - scenario 17 as main;
  - keyboard reorder announced;
  - real-mouse drags 0.00 px, 0 frames behind.
- **Gates:** typecheck, lint, unit (963), browser (1009), the lab's tsc and vitest (208).

## Implementation in #69's PR 4: solid's internals

- **Lint** holds the rules on solid's source: `eslint.config.js`'s dom block now covers `packages/solid/src/**/*.{ts,tsx}`. On main `54fd4bd` it flagged 262 places, all converted:
  - 200 `no-restricted-syntax`;
  - 52 ternaries;
  - 10 `!`.
- **Patterns:**
  - `Predicate` for the undefined checks;
  - `UndefinedOr.match`, `Bool.match` and `Option` for the value picks and the conditional props;
  - `Arr`, `Rec` and `Iter` for the loops;
  - module-level `Match.type` matchers on the start path: `resolveEntry`, `dragMovesOf`, the drag snapshot's `numberOrZero`, a Reorder item's `dragAxisFor`;
  - defaulted parameters (`NO_INTERNALS`, `NO_USER_PROPS`) in place of `internal?.` and `userProps?.`;
  - `accessorOf` for a config given as a value or an accessor;
  - `ownOrInherited`, shared by the variant node and the spine.
- **Tier 1 is unchanged:** the declaration diff against main shows only internal exports.
- **The start path.** The first conversion failed `bench:solid`: Retarget +5.8% and +9.4%, mount +7.3% and +6.7%. A heap profile found two causes, both now fixed.
  - **`Arr.fromIterable` copied a Map.** The spine's walk of the keys a Retarget drove did this per element per Retarget: 190 ns, against 9 ns for main's `for … of`. It's `Iter.forEach` over the Map now, at 11 ns.
  - **Core's `ReducedMotion.applies` built a `Match.value` matcher on every call.** On main, V8 inlined it into the Retarget and dropped the matcher. With the Retarget's own `Arr`, `Rec` and `UndefinedOr` calls added, it stopped inlining it, and every element allocated the matcher: 2 KB per element per round. It's built once now, with `Match.type`.
  - Both are now pitfalls in `effect-first.md`.
- **What's left is +2–3%** on the time of a task, and +2.4% in bytes allocated. Without a GC before the task, the Retarget's median followed GC phase rather than cost, so `bench:solid` now times each task after a full GC and gates bytes (grilled, A: ADR-0040, *Amendment (#69)*).
- **`bench:solid`** in that mode, two runs against main `54fd4bd` (11 reps, 3 for bytes), warm:
  - mount +4.3% / +2.4%;
  - Retarget +1.2% / +1.5%;
  - at rest +0.9% / +3.2%;
  - unmount +0.6% / +1.9%;
  - bytes +2.4% / +2.4% (194 against 190 KB per element per round);
  - exit 0.

  The A/A read 0.0%, +0.6%, −0.1%, −1.4%, and −0.4% for bytes.
- **Lab** (5173, restarted on this branch):
  - smoke 0 errors;
  - crossfade board 54 runs, 0 fails;
  - held 30 runs, 0 off;
  - scenario 15, 14 runs clean;
  - scenario 7 `passes 1 (1 seeding)`;
  - scenario 17 as main;
  - keyboard reorder announced;
  - real-mouse drags 0.00 px, 0 frames behind.
- **Gates:** typecheck, lint, unit (963), browser (1009), the lab's tsc and vitest (208).

## Implementation in #69's PR 5: test's source, and the tests' ternaries

- **Lint** now covers two more areas:
  - It holds the rules on `@wardic/test`'s source, which joins dom's and solid's block.
  - It holds `no-ternary` on every package's tests and benches (decision 3). `bun run lint` now reaches `packages/core/test`, which no block or path covered before.

  On main `a470c20` that flagged 183 places:
  - **test's source, 7:** all `??` defaults in `probe.ts`. They're destructuring defaults now, in one `fixed` helper that both Probes share.
  - **tests and benches, 176 ternaries:** the issue's 164 at `300c431`, plus those written since. By package: solid's tests 140, dom's 17, solid's bench 12, core's 5, test's 2.
- **The forms are rule 2's, as in source:**
  - `Bool.match` for a boolean pick, and for a spread on a boolean;
  - `UndefinedOr.match` for an undefined pick, and for a spread of an optional field;
  - `Option.match` over `Option.fromNullOr` for a regex match or a node that can be `null`;
  - `Match.value` for a chain.

  In JSX:
  - A prop on a signal keeps its getter, so it tracks as before.
  - A branch in children on a signal is Solid's `<Show>`. There's one, in `drag-measure-pass`.
  - A static branch is a `Bool.match` or `UndefinedOr.match` returning the JSX.
  - Exceptions:
    - `server-guard`'s `instanceof Error` pick is an early return, since `Bool.match` can't narrow the defect.
    - The bench's report lines take a `when(cond, text)` helper for their optional parts.
- **Core's smoke test imports `@wardic/core`'s root,** because the root is what it tests. That's the one place the subpath rule is turned off, with its reason given.
- **Gates:** typecheck, lint, unit (963), browser (1009), and the lab's tsc and vitest (208).
  - No "optimized dependencies changed" in the browser log: every `effect/*` module the tests now import was already in the three lists.
  - No source but `probe.ts` changed, so no bench or lab run. A short `bench:solid` A/A confirms its runner after the edits.
- **With this PR, #69's five PRs are in.**

## Amendment (#66, 2026-10-17): the option bags decoded through Schema

Decision 6 left the option bags' Schemas to #66, because a decode validates and what it rejects is a behaviour change. #66 was grilled 2026-10-17 (Q1–Q5, all A). By then, every resolver ran only when an animation was built or started: core's constructors once a Primitive, dom's projection once a flight (at its start) and once a release. The per-node per-frame `Spring.resolve` that `effect-first.md` still described was gone, so a decode could replace the resolvers themselves.

1. **The decode is inside core's resolvers (Q1).** `Spring.resolve`, the tween's and the decay's resolvers (`internal/stepper.ts`), `animate`'s, and `Inertia.resolve`'s options are each a Schema decode. Every caller goes through them: core's constructors, dom's flight starts and releases, the binding's Retargets, and a Tier 2 user with no binding.
   - **The bags users write are each Schema's encoded side,** unchanged. Each field is declared once, with its check and its default (`field(Positive, 170)`, `internal/options.ts`). The Schema checks it as an optional key, and the resolver fills in the default after the decode. A missing key and an `undefined` one both take the default, and an excess key (a transition's `type`, a binding's own fields) is ignored.
   - **Changed after measuring (re-asked 2026-10-17, A):** Q1 had the defaults in the Schema, through `Schema.withDecodingDefault`. That runs an Effect for each missing key. A spring bag's decode cost 12–16 µs cold and 2.2 µs warm in Node (9–12 / 1.6 in Bun), against 2.3 / 0.27 with optional keys and the defaults filled in after (`~/wardic/.tmp/66-decode/probe.ts` on the bench box). On `bench:solid`, an element carrying its own `transition` failed the gate: mount +13.0%. A `transition` rebuilt on each Retarget failed retarget (+13.3%), restRetarget (+23.0%) and bytes (+6.8%). Optional keys passed both pages (*Measured*). The defaults are still declared once, beside each check.
     - Rejected: keeping `withDecodingDefault` and the cost; decoding in development only (Q4's C).
   - **The tween's resolver is public as `Machine.resolveTween`,** Tier 3 (ADR-0008, ADR-0028 decision 2), as `Spring.resolve` is. dom's layout tween read its bag's fields itself. It now runs on the tween's resolved form.
   - Rejected: decoding at the binding's boundary only, which leaves a Tier 2 user unchecked; both, which is two places to keep in step.
2. **What's rejected (Q2):**

   | Bag | Field | Valid |
   |---|---|---|
   | spring | `stiffness`, `mass`, `restDelta`, `restVelocity` | finite, > 0 |
   |  | `damping` | finite, ≥ 0 (0 is an undamped spring) |
   |  | `from`, `velocity` | finite |
   | tween | `duration` | finite, ≥ 0 (0 is instant) |
   |  | `easing` | a function |
   | decay | `friction`, `restVelocity` | finite, > 0 |
   | inertia | `timeConstant`, `bounceStiffness`, `restDelta`, `restSpeed` | finite, > 0 |
   |  | `bounceDamping` | finite, ≥ 0 |
   |  | `power` | finite |
   |  | `min`, `max` | not NaN (an infinite edge is no edge), `min` ≤ `max` |
   |  | `modifyTarget` | a function |
   | all | `delay`, `repeatDelay` | finite, ≥ 0 |
   | animate | `repeat` | a whole number ≥ 0, or `Infinity` |
   |  | `yoyo`, `reverse` | booleans |

   NaN is rejected everywhere, and `Infinity` everywhere but `repeat` and an edge. A value of the wrong type (`stiffness: "170"` from a JS caller) is rejected too.
   - **A fractional `repeat` is rejected.** ADR-0027 (*Implementation in #74*) and ADR-0028 (#94) had it run `ceil(N + 1)` segments and settle on the last, and four tests pinned that (*Tests*). `options.test.ts` pins the rejection.
   - Rejected: types only (Motion's behaviour, which doesn't validate); the issue's short list only.
3. **A rejected bag is a defect, contained to its one animation (Q3).** The resolver decodes with `decodeUnknownSync`, so a rejected bag throws a `SchemaError` whose message names the field (`Expected a value greater than 0 at ["stiffness"]`). Each call site contains it:
   - **The binding builds each leg inside the leg's own fiber** (`Effect.suspend`), the reduced-motion snap's included: its delay is read through the same decode. The defect ends that leg, and it's reported as any failed leg is ("wardic.spine: a leg failed", ADR-0030 decision 4). The element stays where it is, and the rest of the page animates. A fork runs inline up to its first yield, so no leg starts later than before.
   - **dom's flight start** (`startFlight`): the node lands on its new box on its first frame, as reduced motion lands it, reported as "wardic.projection: layout transition rejected". The rest of the pass animates.
   - **dom's release:** it starts at rest on the slot, so the node lands there, reported as "wardic.projection: drag transition rejected".
   - **solid's drag release** (decided while implementing): a release whose run dies is reported ("wardic.drag: a release failed"), and the element rests where it was dropped. Before, any failure of a release failed the whole drag track, and the element stopped dragging until it was remounted. A release's other defects get the same treatment, `CheckFrames`' non-finite Frame among them (`error-reporting.browser.test.tsx`).
   - **A Tier 2 user** gets the throw when the Primitive is built. An inertia's glide is worked out at its run's start, so its bag is decoded there, and the throw is a defect of the fiber running it.
   - Rejected: a typed error in each constructor's `E`, which changes every Tier 2 type and call site; falling back to the default with a logged warning, which hides a typo behind an animation that looks almost right.
4. **Each decode is cached by its bag's identity (Q4),** in a `WeakMap` from the bag to its resolved form (`internal/options.ts`, `cachedResolver`). A Wardic element's `transition` is the same object across its Retargets, so it's decoded once an element, not once a Retarget.
   - **A missing bag is one object:** core's constructors default to a shared empty bag, and the binding's spring legs and presence's exits pass a module-level one, so a call with no options decodes once.
   - **A Retarget's transition with the same fields as the element's last one is the last one** (decided while measuring): Solid rebuilds a staggered child's bag (`delay` plus its stagger, ADR-0007) on every Retarget, and a `transition` that reads a signal on every read. A shallow comparison (same keys, each `===`) costs less than the decode and the cache insert it saves (about 1.2 µs an element in Chromium).
   - **A drag release's bag** spreads the edges into the drag transition, so it's a new object each release and decodes each time, once a release.
   - **The caveat:** a bag changed after its first decode keeps its first result. The bags are `readonly` in their types, and `internal/options.ts`' doc says so.
   - Rejected: no cache; decoding in development only, which has the two builds behave differently.
5. **This amendment, one PR (Q5).** `effect-first.md`'s line on resolving options is corrected: no caller resolves per frame any more.
   - Rejected: a new ADR; two PRs, which would have core throwing at the binding's uncontained call sites in between.

**Not covered:** `Easing.spring`, which bakes a spring into an easing curve, reads `stiffness`, `damping` and `mass` itself. Decoding them through `Spring.resolve` would make `Easing.ts` import `Spring.ts`, which imports `internal/stepper.ts`, which imports `Easing.ts`, and `stepper.ts` needs `Easing.linear` as it loads (the tween's default).

**Measured** (bench box, after `wardic-quiet`; head `9cf962a` against main `4a3f3ec`; the probes and logs in `~/wardic/.tmp/66-decode/` and `~/wardic/.tmp/66*.out`):
- **`bench:core`, 11 reps:** Node passes every workload, with every MB/frame unchanged. Its start times, where each of the 1,000 elements decodes its own fresh bag, rise 1–1.5 ms (24.7 → 25.9 for `springValues`). With `withDecodingDefault` they had risen about 10 ms (24.8 → 35.0). Bun's and Chromium's frame workloads pass too, but for one small Chromium `/loop` workload a run (0.3 ms a frame, its medians printing the same): `animateRepeat/loop` +6.3% on the first run, then +4.5% on a rerun, when `animateRepeatDelay/loop` read +5.1%. The same workloads against #66's first commit, whose per-frame code is the same, read +3.1% and −4.8%. The flag moves between workloads from run to run. It's the timer's quantization on the smallest workloads, not the frame path, which #66 doesn't change.
- **`bench:solid`, 11 reps, warm, against main:** its page as it is, every element on the binding's one empty bag: mount +0.8%, retarget +0.9%, restRetarget +0.5%, unmount +0.1%, bytes +0.6%. Two variants of the page, run the same way and then reverted:
  - **each element with its own static `transition={{ stiffness: 170 }}`**, decoded once an element: mount +3.8%, retarget +2.0%, restRetarget +1.8%, bytes +1.8%. With `withDecodingDefault`: mount +13.0%, bytes +3.4%.
  - **a `transition` that reads a signal**, which Solid rebuilds on every read: mount +3.3%, retarget +1.4%, restRetarget +2.6%, bytes +2.0%. With `withDecodingDefault`: retarget +13.3%, restRetarget +23.0%, bytes +6.8%. With optional keys but no reuse of a same-fields transition (decision 4): restRetarget +7.5%.

**Tests:**
- **`packages/core/test/options.test.ts`** (54): the table row by row, through the public builders and resolvers (each rejection a `SchemaError` naming its field, a JS caller's `"170"` among them); the defaults, `undefined` as missing; the cache (the same bag resolves to the same object, an equal one decodes afresh, a bag changed after its decode keeps its first result).
- **`packages/dom/test/projection-options.browser.test.ts`:**
  - PO1: a rejected layout transition (a spring's stiffness 0, a tween's negative duration) lands its node on its first frame, reported, while the node beside it animates.
  - PO2: a rejected drag transition's release is reported and lands on the slot.
  - PO3: a layout tween with no duration runs core's 0.3 s.
- **`packages/solid/test/error-reporting.browser.test.tsx`:**
  - a leg on a rejected transition fails alone, reported naming the field; the element beside it animates, and its next Retarget on a good transition animates;
  - drag's release on a rejected drag transition: reported, the element rests where it was dropped, and the next drag drags (it replaces the track-failure test, whose NaN is now rejected at the decode);
  - a release that steps a NaN under `CheckFrames` (a `modifyTarget` returning NaN) fails alone.
- **Mutations** (worktree `wardic-wt/m66`, removed), each caught by its test: dom's flight start uncontained (PO1, both rows), dom's release uncontained (PO2), a spring leg built outside its fiber (the leg test), drag's release uncontained (both drag tests).
- **Fractional `repeat`:** `machines.test.ts` lost two cases and `reduced-motion.test.ts` one. `frame-loop.browser.test.tsx`'s afterChildren test moves from `repeat: 1.5` to `repeat: 2`, the same three segments.

**Gates:** typecheck, lint, unit (1024), browser (1013, no "optimized dependencies changed": `effect/Schema` and `effect/Cause` were already in the three lists), and the lab's tsc and vitest (208). The lab's drives on a restarted 5173 are as #221's: drive16 54 of 54, drive-held 0 off, drive7 6 clean · held 0, drive17 identical, drive14k on its slot, late reads 0 frames behind.
