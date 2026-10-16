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
   - **The Measure pass's `leftover`,** the next task's pass after the round cap, becomes `Effect.sleep(Duration.zero)`. Effect's Clock sleeps with `setTimeout` whatever Scheduler is installed, so it stays a next-task hop under a microtask Scheduler (Foldkit's, #208), which `Effect.yieldNow` wouldn't.
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
