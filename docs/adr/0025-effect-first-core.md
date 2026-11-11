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
   | spring | `stiffness`, `mass`, `restDelta`, `restSpeed` | finite, > 0 |
   |  | `damping` | finite, ≥ 0 (0 is an undamped spring) |
   |  | `from`, `velocity` | finite |
   | tween | `duration` | finite, ≥ 0 (0 is instant) |
   |  | `easing` | a function |
   | decay | `friction`, `restSpeed` | finite, > 0 |
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

*Note (#511, 2026-11-01):* the bags are checked by hand since #511, with Wardic's own checks in place of a Schema, and a rejected bag throws an `OptionError` with the same message (*Amendment (#511)*).

## Amendment (#225, 2026-10-18): `Easing.spring`'s bag is decoded too

*Amendment (#66)* left `Easing.spring` under *Not covered*. It read `stiffness`, `damping` and `mass` itself, so a value every other spring bag rejects baked a broken curve. NaN stiffness or `mass: 0` gave NaN through the middle of it, a negative stiffness reached −5e17 by t = 0.75, and a string `"170"` was coerced. Grilled 2026-10-18 (Q1–Q3, all A).

1. **It throws when called (Q1),** as a Tier 2 builder does (*Amendment (#66)*, decision 3): `Easing.spring` decodes its bag through `Spring.resolve` at the call, before it bakes the curve, so a rejected bag throws its `SchemaError` naming the field, at the developer's own line. The binding's per-animation containment doesn't reach it: an easing is built in user code, usually as a component renders, outside any leg.
   - Rejected: decoding at the curve's first sample, inside a leg (contained, but the curve's 0.1–0.8 ms build moves into a frame, and a Tier 2 user sees the throw far from its cause); a logged fallback to the defaults (#66's Q3 rejected it).
2. **The whole bag, as every spring bag's (Q2).** `Spring.resolve` checks every field, so a spring field the curve doesn't read (`restDelta`, `from`, `delay`) is still rejected when it's wrong, and a bag shared with a spring transition passes or fails the same way in both places. Only `stiffness`, `damping` and `mass` shape the curve, which bakes its own rest thresholds (1e-4) and step (1/240 s). `Easing.SpringOptions` stays those three, the JSDoc says the rest are checked, and a call without a bag shares one, so its decode is cached.
   - Rejected: a narrower Schema for the three (a second spring table to keep in step); also rejecting the fields it ignores (it would refuse a bag that's valid everywhere else).
3. **The import cycle #66 named isn't one.** `Spring.ts` loaded `internal/stepper.ts` at run time only for `valueOr`, in `Spring.init`. Read through `UndefinedOr` there, `Spring.ts` imports nothing of `stepper.ts` but a type, so `Easing.ts` imports `Spring.resolve` and `stepper.ts` still finds `Easing.linear` defined when it loads. No module moved.

**Tests:** `options.test.ts` gains `Easing.spring`'s rows: `mass: 0`, NaN and `"170"` stiffness, a negative damping, and a rejected `restDelta` and `from` the curve doesn't read, each throwing its `SchemaError` naming the field. It accepts the defaults, a bouncy bag, and a transition-shaped bag. `easing.test.ts` pins the curve against main's at four samples on two bags, equal to the last bit. Mutation: baking without the decode fails the six rejection rows.

**Gates:** typecheck, lint, unit (1113), browser (1017), and the lab's tsc and vitest (208). No bench and no lab drives: no per-frame code changed, and nothing in Wardic calls `Easing.spring`.

*Note (#344, 2026-10-24):* the spring's and the decay's `restVelocity` is `restSpeed` (ADR-0050), and a spring's `restDelta` and `restSpeed` have no default: a leg's are Motion's, by its distance, unless given.

## Amendment (#460, 2026-11-01): the hot path composes once

The final review (#460, Part 3) re-grilled Q8 with what Effect's `dual` costs per call. Effect's two-argument wrapper keeps its first argument for the data-last closure it might return, so V8 gives every call a context for it, data-first calls too, unless TurboFan has inlined the wrapper into an optimized caller; its other forms read `arguments`. Most of a binding's per-leg code runs in Maglev. In Node, one data-first `Bool.or` measured 0 B under TurboFan and 104 B under Maglev; a predicate piped at the call 264 / 472 B; the same predicate built once at module scope 0 / 0 B. On the bench page, `dual`'s wrapper was 18 KB of each element's 139 KB a round.

- **The hot path is code that runs per key or per element on every Retarget, per leg, or per frame.** The per-frame path's rules (decision 3) stand; the hot path adds its own, *compose once* (Q8 re-grilled, 2026-11-01). The user asked first whether functional pipelines could keep Effect's utilities without the cost: they can, written as definitions.
  - A predicate, matcher or pipeline over values the call doesn't own is built at module scope, data-last, and applied.
  - A step that needs a value only the call has is a statement: an `if` with an early return, `&&`, `||`, `!`.
  - Effect's and core's operations are called data-first, never a pipe of data-last steps built at the call.
  - Loops stay `Arr` / `Iter`; per mount and below, rule 1's forms (Q8: `Bool.and` / `Bool.or` for values in hand, lint's `BOOL_OPERANDS` for the rest).
- **Core builds its operations with its own `dual`** (ADR-0028, *Amendment (#460)*), so a data-first call into core costs nothing in any tier.
- **Applied** to dom's Key rules (`mayApply`, `isVariableValue`), core's per-leg constructors (`animate`, `animateValues`, `springBlend`, `keyframes`, `keyframesValues`, `blendersFor`), the registry's lookups, `Values.pick`, the Frame loop's per-run code, and the binding's Retarget and leg path (`resolutionOf`, `retarget`, `dragHolds`, `startKey`, `legProgram`, `legEnded`, `legsWith`).

Measured (`bench:solid --base main --features` and `bench:core --base main`, on the bench host, with Q6's `fnUntraced` and ADR-0040's *Amendment (#460)*), Solid 1 / Solid 2:
- warm mount −11.9% / −13.6%, Retarget −33.2% / −34.1%, rest Retarget −30.4% / −29.1%, unmount −17.0% / −15.1%;
- bytes per element per round −21.0% / −22.4% (135.7 → 106.9 KB, 129.5 → 100.5 KB), and −17% to −23% on every feature page;
- layout scenes within ±3.8% / ±3.4%, their bytes per frame −0.7% / −0.9%;
- `bench:core`: every workload within its gate on Bun, Node and Chromium; a run's start down by about a third (`animateValues` 13.1 → 8.3 ms in Bun, 9.1 → 5.6 in Chromium).

## Amendment (#511, 2026-11-01): the option bags checked by hand, without Schema

ADR-0067's decision 9 (grilled 2026-11-01, Q9: A) takes `Schema` out of Wardic's runtime. An app with one `wardic.div` shipped about 54 KB of Schema, minified, used only to decode the option bags (*Amendment (#66)*) and an Interpolator's values (ADR-0026). This amendment reverses *Amendment (#66)*'s Schema and keeps the rest of its design. It ships with #460's PR 3b.

1. **The same design, without Schema.** Each field is still declared once, with its check and its default (`field(positive, 170)`, `internal/options.ts`); a resolver still checks a bag once, caches the result by the bag's identity, runs the bag's cross-field `check` on the filled fields, and fills each default after checking. A missing key and an `undefined` one take the default, and an excess key is ignored. What changed is the check: a plain function, `(value: unknown) => true | string`, the string what it expected.
   - **The checks:** `number`, `finite`, `positive`, `nonNegative`, `notNaN`, `boolean`, `fn(name)`, `literals([…])`, `union([…])`, `array(check)`, `nonEmptyArray(check)`, `tuple([…])` (the bézier's four numbers), and `refine(check, f)` for the bags' own (`Repeat`, `Times`); `EaseDefinition`, `EaseOrList` and `NoEasing` are built from them.
   - **Each names the values it takes,** `type` in words (`number`, `"loop" | "reverse" | "mirror"`, `an easing function`) and `takes` by runtime type, beside the call. A union asks only the members that take a value's runtime type, as Schema's did, and a field rejects a value its check doesn't take as `Expected <type> | undefined`. Without them, `ease: "bogus"` would list the bézier's failure too, and `stiffness: "170"` would read `Expected number`.
2. **A rejected bag throws an `OptionError`,** a `Data.TaggedError("OptionError")` whose `_tag` and `name` are `"OptionError"` (Effect's `TaggedError` sets `name` to its tag on the prototype). It's still a defect, contained by each call site as decision 3 of *Amendment (#66)* describes; only its name changes from `SchemaError`.
   - **Its message is Schema's, word for word:** `Expected <what>`, then `  at ["<field>"]`; a union's members that take the value, each on its own lines; a place below the field as Schema wrote it (`  at ["ease"][3]`, `Missing key`, `Expected no excess property`); a value of the wrong type as `Expected number | undefined`; a bag that isn't an object as `Expected object`; the cross-field check's at the root (`Expected min (10) at or below max (0)`); and the first rejected field, in the bag's declared order. A probe of 137 rejected bags across every resolver, run before and after, printed the same messages but for the error's name.
   - **`Machine.OptionError`**, public beside the bags: `Machine` declares every option bag (`SpringOptions`, `TweenOptions`, `AnimateOptions`, `KeyframesOptions`, `DecayOptions`, `InertiaOptions`), and its builders and resolvers are where a bag is rejected; `Spring.resolve`, `Inertia.resolve` and `Easing.spring` throw the same class.
   - Rejected: keeping Schema for the bags alone (the 54 KB stays while any use does); a message of Wardic's own wording (decision 9 asked for the field named, and Schema's messages already did).
3. **The cache's hit path is statements** (#460, compose once): a `WeakMap` read and an early return, where it was an `UndefinedOr.match` with closures per call.

**Measured:**
- **`bun run size --base main`** (`main` at `e4ce8fa`; the Schema step alone, before the rest of #460's PR 3b), KB gzipped: Solid 1's complete element 180.6 → 166.8 (−7.6%), with presence 187.2 → 173.3 (−7.4%); Solid 2's 216.9 → 203.1 (−6.4%) and 223.6 → 209.8 (−6.2%); the plain apps unchanged. Minified, Effect's share falls 57.4 KB in every Wardic app and core's grows 1.7 KB. Of Schema's 13 modules in the complete app (55.3 KB minified, by its source map), 118 bytes stay: `effect/reactivity`'s `Atom` imports `Schema`, and its type id is kept.
- **A fresh bag's resolve** (a probe on the dev host, not gated; ns per bag, cache insert included), Node 22 / Bun 1.3: `Spring.resolve({ stiffness })` 818 → 396 / 687 → 404; an empty spring bag 764 → 372 / 629 → 427; `resolveTween({ duration, ease })` 523 → 268 / 488 → 332; `animate`'s `{ repeat, repeatType }` 957 → 566 / 1,357 → 728. The first resolve in a fresh process, 973 → 254 µs in Node.

**Tests:** `options.test.ts`' rows now expect an `OptionError` naming the field, and it gains 25 rows pinning the messages word for word (each `instanceof Machine.OptionError`): every check's message, a union's lines, the places below a field, the wrong-type and non-object messages, the cross-field one, and the declared order. `motion-ease.test.ts` (ME4) and solid's `ease.ssr.test.tsx` (EA2) expect `OptionError`. solid's `error-reporting.browser.test.tsx` reads the field's name in a failed leg's cause, which the message keeps.

## Amendment (#540, 2026-11-03): the mount path's measured sites take statements

#535's cold-mount profile left a mount of 1,000 elements spending about 13 ms cold and 4.7 ms warm in Effect's small helpers, spread over many call sites, beside its runtime (a fiber per leg, #542). #540 prototyped two steps on #519's harness (`probe/540-helpers`), 11 reps paired against `main`:
- **within today's rules** (the element's style composed with data-first `Style.over` / `Style.without` calls, not a `pipe` and a closure each; `isHeld` without a two-element array per key): warm −0.0% / +0.3%, cold −2.7% / −2.8%;
- **with statements at five hot sites as well:** warm **−3.7% / −3.2%** (Solid 1 40.4 → 38.8 ms, beside Motion 14.9's 38.7), cold −2.6% / −3.5%.

Decided in #540's grill (2026-11-03):

1. **Q1, the helpers before the runtime.** They're shallow and measurable; the leg fibers are a design change, #542.
2. **Q2, measured hot sites only.** Code that runs once per element as it mounts follows the hot path's rules, but at a site a profile shows with a measurable helper cost. There, plain statements and loops take the place of Effect's helpers: an `if` with an early return, a `let` set in a guard, a `for … of`.
   - **Marked:** each site has a comment, `// Per element at mount (#540): statements.` (or `a loop.`).
   - **Listed:** a file whose site loops is in `eslint.config.js`'s `MOUNT_PATH_LOOPS`, beside the per-frame files; lint lifts only its loop rule. Ternaries stay banned, and the checks rule holds (`Predicate`, not `=== undefined` or `typeof`).
   - **Everything else stays Effect-first.** A new site needs a profile behind it.
   - Rejected: the whole mount path, which lint can't tell from the rest file by file; keeping the rule and shipping the first step alone, which measured nothing warm.
3. **The sites:**
   - dom's Starting style (`internal/starting-style.ts`): `filtered` (a `for` in place of `UndefinedOr.match` and `Rec.filter`), `resolveInitial` and `recordOf` (in place of a `Match.type`), `recordOfInput` and `over` (in place of `UndefinedOr.match`es), `isHeld` and `without` (a `for` in place of `Arr.some` and `Rec.filter`);
   - solid's `configBuildOf` (a `for` in place of `Arr.reduce`), and the variant tree's `inheritedContext` and `startingValuesOf` (in place of `Bool.match`es);
   - core's `ReducedMotion.applies` (in place of the `Match.type` matcher #69's PR 4 built once).

**Measured** (`bench:solid --base main --features`, 11 paired reps; the noise control −0.0%), Solid 1 / Solid 2:
- **warm:** mount −3.3% / −1.9%, Retarget −2.7% / −3.5%; rest Retarget +0.3% / +3.0% and unmount +0.9% / +0.8%, within their gates;
- **cold** (not gated): mount −3.9% / −2.4% (53.6 → 51.0 ms, 60.4 → 59.5);
- **bytes per element per round:** −5.0% / −4.1% (101.5 → 96.2 KB, 98.6 → 94.6), and −2.3% to −4.3% on every feature page;
- **the feature pages' mounts:** −1.5% to −3.9%;
- **retained at rest and the layout scenes:** flat, within their gates.

`bun run size --base main`: −0.1 KB minified in each of core, dom and solid; s1-slim 120.4 of its 121 KB.

## Amendment (#545, 2026-11-03): `bench:core` reruns before it fails, and its two tiniest loop workloads run ten times N

#542 changed the Frame loop's run code and left its per-frame path byte-for-byte `main`'s. On Bun, decision 4's gate still failed `animateRepeat/loop` in 2 of 6 runs and `chase/loop` in 2. Judging those failures took about an hour of reruns. Grilled 2026-11-03 (https://github.com/wardiclabs/wardic/issues/545#issuecomment-6613256226).

**The probe.** `main` against `main` (`--head main`), 21 reps, Bun, Node and Chromium. Both sides run the same code, so the spread between a workload's 25th and 75th percentile is the bench's own noise. Across the eight loop workloads, in points, typical / worst:
- **as it was** (1,000 runs, each frame timed), 6.5 min:
  - Bun 10.2 / 28.9 (`chase/loop`);
  - Node 3.2 / 8.0;
  - Chromium 5.7 / 25.0 (`chase/loop`).
- **10,000 runs on the loop,** 18.5 min:
  - Bun 9.9 / 18.1;
  - Node 5.6 / 7.6;
  - Chromium 5.6 / 14.4.
- **10-frame batches per timed sample:**
  - Bun 9.3 / 25.8;
  - Node 3.5 / 5.4;
  - Chromium 7.0 / 23.3.

The medians stayed within ±3.6%, but for `chase/loop` on Bun. So size isn't the lever for most of the lane. On #542, Bun's medians moved −10% to +39%, beyond anything `main` showed against itself, with the frame code unchanged: JavaScriptCore compiling the same frame differently after a change elsewhere. No size removes that. The gate's judgement has to absorb it.

1. **The two tiniest loop workloads run ten times N** (Q1). `chase/loop` and `springValues/loop` ran under 0.1 ms a frame (a workload's `scale`, `harness.ts`). Each result reports the runs it timed. A row whose two sides timed different counts, such as a base on its own older harness, is reported, not gated (`rows.ts`' `runsOf`).
2. **A rerun before failing** (Q2). An engine with a failing workload runs its reps again. A workload fails only when it fails both runs (`confirmed`), and the output shows both tables and a line for each workload that passed its rerun.
3. **Bun gated as the others** (Q3), with the rerun. It's the only check on Safari's engine.
4. **No absolute floor** (Q4). After decision 1 every gated frame is at least about 0.2 ms, so +5% is already at least about 10 µs.
5. **A noisy engine runs once more** (Q5). An engine whose `ticksOnly` is off by more than ±3% runs its reps again, and that run is judged as its first. Only an engine still noisy after it makes the run exit 2. Node's `ticksOnly` spreads 7–10 points between its quartiles, so ±3% on its median trips by chance.

Stated, not asked: `ticksOnly` stays the only noise control. A loop-lane control would run the loop's own code, which a change under test can alter (ADR-0027, decision 12).

Rejected:
- the whole loop lane at 10,000 runs (3× the time, no tighter spread);
- batch timing;
- rerunning until two of three runs agree;
- Bun at a wider margin, or reported only;
- a 10 µs floor;
- widening the noise limit to ±5%.

**Checked:**
- **The rows test** (`core/test/bench-rows.test.ts`): a side's runs, and a failure confirmed only by its rerun.
- **`main` against `main`** with every decision in:
  - Bun's `animateComplex/loop` failed one run by noise (+6.9%, its 25th percentile +0.3%) and passed its rerun;
  - Node's noise control tripped at +3.0% with every workload steady, the case decision 5 reruns;
  - Chromium's `chase/loop` at 10,000 runs read +0.0% [−4.2%, +0.0%];
  - Bun's `chase/loop` stays bimodal at any size, its 25th percentile at −30% to −40%, under the gate.
  - a second run, with decision 5 in, passed every workload on its first run on all three engines and exited 0.
- **A real regression:** a busy loop in `chase`'s step, run on Node, failed both runs (`chase` +21% and +24%, `chase/loop` +705% and +714%), and the bench exited 1.


## Amendment (#618, 2026-11-06): the rule goes by how often code runs

Found in the review of 2026-11-05 (H1). The per-frame rule said where code was, not how often it ran. Code that runs once a frame, or once an input event, took either the per-frame path's plain forms or Effect's helpers built at the call, with no rule between them. Measured (Node 22 / Bun 1.3, ns a call):
- `Num.clamp` 30 / 26, against `Math.min`/`max` 6 / 5;
- `Match.value` built at the call 69 / 62, against a `Match.type` built once 10 / 14 and a record 7 / 3;
- `Option.match` with closures 14 / 8, against an `if` 9 / 4;
- `Bool.every` 10 / 7, against an `if` chain 6 / 3;
- `Clock`'s timing helpers 30 / 16, against plain reads 7 / 6.

**Decided:** the multiplier decides the form (`effect-first.md`, *Once a frame, or once an input event*).
- **Per element, key or node, every frame:** the per-frame path's plain forms, as before.
- **Once a frame, or once an input event:** Effect's helpers, built once. A `Match.type` at module scope, never `Match.value(x).pipe(…)` at the call; handlers hoisted; `Bool.not`, which is free.
- **A call that runs once for each of its callers every frame is per caller.**
- **Per key per Retarget, or per leg:** the hot path, as before.
- **Lint:** `BOOL_OPERANDS` covers `Bool.every` and `Bool.some` too: an element after the first that calls more than a pure check.

**The sites:**
- **core:**
  - `LiveValue.eachFrame` clamps with `Math`;
  - `startsKeyPress` is an `if` chain: `Bool.every` read the press claims on every key event;
  - `Stagger.make` resolves its origin and easing once, and `Arc.make` its direction;
  - `Projection.shapeOrigin`'s matcher is built once, its shapers at module level;
  - `watchPan` is an `Effect.fnUntraced`.
- **dom:** input's `kindOf`, `buttonOf` and `keyOf` are built once, and `keyActionOf` is statements. `makeRunner` stays a function returning `Effect.gen`: `Effect.fnUntraced` can't carry its type parameter.
- **solid:** the spine's imperative legs fork data-first.
- **Every package:** `Arr.isArray` in place of `Array.isArray`.
- **Unchanged, as measured:** `follow`'s `Bool.not`, and `Clock`'s helpers, which run once a frame.

**Measured** with #618's PR 7 (the Renderer read once, M1, and Solid 2's `Reorder.Item`, M3, beside):
- **`bench:core --base main`:** every workload passed on Bun, Node and Chromium. `keyframesValues/loop` −2.3% on Node and −9.4% on Chromium; the rest within noise.
- **`bench:solid --base main`:** every gate passed. Warm mount −11.4% on Solid 1 and −4.7% on Solid 2, most of it M1's, whose work moves into the first frame (ADR-0067, *Note (#618, 2026-11-06)*); bytes per element −0.3% and −0.8%; Solid 2's Reorder item retained −3.0%; the layout scenes within noise.

## Amendment (#665, 2026-11-10): a Batch's change is a pass over its typed arrays, as its step is

A Batch (ADR-0069, decisions 10–18) keeps each member's keys in typed arrays. Its step runs over every moving member once a frame, so it's on the per-frame path, and `Batch.ts` joins lint's per-frame loop files. Its change, `Batch.retarget`, runs once a change, but over every member it's given, key by key: retargeting the whole Batch is the same walk over the same arrays as one frame, and it's what a Batch is for (1,000 elements retargeted in 0.1 ms against 12.2 ms, `.tmp/564-canvas/dom/`).

- **The change takes the per-frame forms:** counted loops over the slots it's given and each member's keys, plain index reads and writes, and statements. `Arr.forEach` over the slots called a closure of its own for each (Chromium profile, 1,000 members).
- **What it does once a change** follows the full rules: the transitions resolved (a `Match` built once), the delay checked by `internal/options.ts`.
- **The bindings' `createBatch`** (`packages/solid/src/batch.ts`) reads its members' targets the same way, a counted loop per member at creation and at each change, and is listed with the mount path's loop files.
- Rejected: `Arr` over each member's keys, which builds a closure per member per change.

## Amendment (#709, 2026-11-11): the Keyboard press's check is a mount-path site

`makeFocusable` (`@wardic/dom/KeyboardPress`, ADR-0056) runs once per pressable element as it mounts: every Wardic element with a press, and every member of a Batch with `whileTap` or a tap event. It built an array of every check at once (`Bool.some([...])`), reading `isContentEditable` and two attributes even for a `div`, and tested its target through `Predicate.hasProperty`'s `dual` call.

- **The check is statements,** the cheapest reads first, each only if the ones before it didn't settle it: the tag, a `tabindex`, a link's `href`, then `isContentEditable`. Its answers are the same (KA2 covers every case).
- **Its target's test** is `hasProperty`'s own (`Predicate.isObjectKeyword` and `in`), without the `dual` call.

**Measured** with a profile of `bench:solid`'s gesture page (1,000 members, 30 warm mounts), and `bench:solid --batch`: see #709's PR.

## Amendment (#712, 2026-11-11): a Batch Reorder group's item is a mount-path site

A `Reorder.BatchItem` (ADR-0072) mounts once per item of a list of thousands, and its group is gated on its mount: at most 0.3× a `Reorder.Group`'s (decision 11). On Solid 1 it rendered through `<Dynamic>`, its own props merged over the app's (`mergeProps`, then `splitProps` and `spread`'s `assign` reading each through the merge), its style an object written a key at a time, and an effect per item for the keyboard instructions' id. A profile of 5,000 items' mount had 51 of its 139 ms in `<Dynamic>`'s spread, 21 ms of it the style. `bench:solid --reorder-batch` measured it at 0.36–0.38× of `Reorder.Group`'s.

- **The item's element is made as `<Dynamic>` makes one,** in a component of its own so a hydrating item's key is the server's: `document.createElement`, or hydrating, Solid's `getNextElement`. Solid's `spread` takes the app's own props alone; the item's style, `draggable`, tab stop and `aria-describedby` are written on it directly, in statements, a mount-path site.
- **What every item shares is the group's:** its style, as a record and as one CSS text, written once as each item is made, before its `ref`s run, where the Batch draws it; its tab stop; and its instructions' id. The group keeps the items with none of their own, and writes a change on each of them: no computation per item. An item with its own `style`, `tabIndex` or `aria-describedby` keeps an effect for it, over the group's.
- **Solid 2's item** already rendered a static element; its instructions' id is the group's too, once for every item.

**Measured** with `bench:solid --reorder-batch`, 7 paired reps, the Batch group's mount to its first paint (its task and the microtasks it queues, then its first frame) against `Reorder.Group`'s: 1,000 items 27.3 → 11.9 ms in a column and 27.8 → 13.1 ms in a grid (0.37–0.38× → 0.16–0.18×), 5,000 items 123.4 → 51.4 ms and 130.7 → 57.1 ms (0.36–0.38× → 0.15–0.17×). A frame while dragging stays 0.43–0.52× at 1,000 items and 0.25–0.46× at 5,000.
