# Core's API is pipeable: a module per data type, `Pipeable` values, `dual` operations

Core's API moves to the way Effect organises its own (#93): every export lives in a module, the data types core builds are `Pipeable`, and the operations on each are `dual`, so `Machine.map(m, f)` and `m.pipe(Machine.map(f))` both work. It starts with a `Machine` module, ADR-0027's machines as a first-class data type and the extension point for Primitives, and sets the rule for the rest of core. A Primitive is its machine, and its `Stream` is `Machine.toStream`, so the sequencing ADR-0027 kept twice exists once. Breaking changes are taken outright: core is unpublished and has no users, so old names and positional signatures go with no deprecated aliases. The working rules are in [`docs/agents/pipeable.md`](../agents/pipeable.md). This amends ADR-0001, ADR-0008, ADR-0025 and ADR-0027.

## Why

- **The direction (#93, from #83's part B):** `pipe` as the way to compose anything in core, with Effect's pipeable modules wherever they fit and modules of core's own for its data types. The maintainer's comment on #93 (2026-10-09) asks for more of core's API to be pipeable, not less, and for the rule to be set before more surface is written the old way.
- **Fixes waiting on a combinator:** #91 (`repeatDelay`) needs a trailing hold inside each segment; #77 (`delay` once) and #78 (`springValues`' clamp) were fixed by hand, in `animatePlan`'s `optionsFor` and in each leaf's step, where a `Machine.delay` and a `Machine.clampDt` would hold each once by construction.
- **Where core stood at `7967900`:**
  - `src/index.ts` is a flat `export *` of every folder, so ADR-0008's Tier 3 curation never landed: dom imports the steppers (`springStep`, `initSpring`, `SpringState`) for its projection pass.
  - `machine.ts`' combinators (`mapFrames`, `inSequence`, `cycle`) each take a span as a required positional argument, and nothing in core is `Pipeable`.
  - Since #74, nothing outside core uses a Primitive's `Stream`: solid and dom build machines only (`springValuesMachine`, `springBlendMachine`, `animateValuesMachine`, `decayVecMachine`, and dom's hand-built `coordinatorMachine`). The Streams' callers are tests, the bench and `withMomentum`.

## Decisions (grilled 2026-10-09 against effect 4.0.2's `dist`)

1. **Four kinds of export, and every export lives in a module.**
   - **A module per data type or CONTEXT term,** as Effect's are. The root stops exporting loose functions.
   - **A data type core builds, which callers never write as a literal,** is `Pipeable`, with a `TypeId`, an `isX` guard and Inspectable, built by its constructors (`effect/Option`, `Chunk` and `Duration` are the pattern). Today: `Machine`, and the Reorder group's handle, which becomes a value with `dual` operations in place of its methods.
   - **A plain shape callers write, or that a step allocates per tick, stays plain:** a plain object or function type with no prototype. Its module holds the type, its guards and its operations, as `effect/Record` does over plain records. A prototype on `Frame` would be an `Object.create` per Frame per tick, and would stop callers writing `{ value, done }` or `(t) => t * t`.
   - **Operations are `dual`** when they take the module's type first and more arguments besides: the Machine combinators, and the Stream combinators (`axisLock`, `withinBounds`, `applyTo`). **Functions on the per-frame path stay positional:** `dual` and `pipe` run at construction only, never per step (ADR-0025, decision 3; ADR-0027, decision 8).
   - **Services keep Effect's shape,** a `Context.Service` and its `Layer`, which already composes through Effect (decision 11).
   - **Decision 12 applies this to every export** of core at `7967900`.
   - **Rejected: modules only for the data types and the dual operations,** with plain values left flat at the root. Less churn, but it leaves two ways to find an export, and lint couldn't hold the root to namespaces only.
2. **Subpath modules, as Effect's are, with namespaces from the root as well (amends ADR-0008).**
   - **One file per module, `packages/core/src/<Module>.ts`,** in PascalCase, holding the module's public API and its docs. Implementation two or more modules share lives in `src/internal/`. The folders (`primitives/`, `interpolate/`, `layout/`, …) go.
   - **`package.json`'s `exports`:** `"."`, `"./*": "./src/*.ts"` and `"./internal/*": null`, the shape of effect's own. NodeNext resolves all three.
   - **The root is namespaces only:** `src/index.ts` is `export * as Machine from "./Machine.ts"` and its siblings, for a user who writes `import { Machine } from "@wardic/core"`.
   - **The repo imports subpaths:** dom, solid, test, the bench, and core's modules among themselves write `import * as Machine from "@wardic/core/Machine"`, as core writes `effect/Option`.
   - **Measured** (a throwaway probe: one `Option.getOrElse(Option.some(1), …)`, minified, bytes and gzipped):

     | Bundler | `import { Option } from "effect"` | `import * as Option from "effect/Option"` |
     |---|---|---|
     | Vite 6's production build (Rollup) | 12,293 (3,925) | 12,293 (3,924) |
     | esbuild 0.28 | 18,565 (6,821) | 13,652 (5,072) |
     | Bun 1.3's bundler | 18,060 (6,619) | 12,816 (4,762) |

     Rollup shakes a root namespace as well as a subpath, and esbuild and Bun keep about 5 KB more (1.9 KB gzipped). A subpath is the form whose size doesn't depend on the consumer's bundler.
   - **ADR-0008's Tier 3 lands:** `internal/` can't be imported from outside core. The steppers dom's projection pass calls per node per frame (`springStep`, `initSpring`, `SpringState`) stay public in the `Spring` module, marked Tier 3 in their JSDoc, since dom is a real caller and an `internal/` it imported anyway would hold nothing.
   - **Rejected:**
     - **Root namespaces only,** `exports` left at `"."`: a consumer on esbuild or Bun pays the measured gap per module, and nothing fences off `internal/`.
     - **Subpaths only:** the root's re-exports cost nothing, and `import { Machine } from "@wardic/core"` is the form an Effect user expects.
3. **`Machine` is a data type: `Duration`'s pattern.**
   - **Its fields are ADR-0027's:** `start: () => (dt) => F`, one run per call; `settles`; and `span`, today's `MachineSpan` as `Machine.Span`. The Frame loop and `toStream` read all three once per run, never per tick, so the prototype costs nothing per frame.
   - **Its shape:**
     ```ts
     const TypeId = "~@wardic/core/Machine"

     export interface Machine<out F extends Frame.Frame<unknown>> extends Pipeable, Inspectable {
       readonly [TypeId]: { readonly _F: Covariant<F> }
       readonly start: () => (dt: number) => F
       readonly settles: boolean
       readonly span: Span
     }
     ```
     A prototype holds `[TypeId]`, `pipe` (`pipeArguments`) and `Inspectable.BaseProto`, with a `toJSON` of `{ _id: "Machine", span, settles }`. `make(fields)` is `Object.assign(Object.create(Proto), fields)`, and `isMachine` checks `TypeId` (`hasProperty`).
   - **Built by constructors and `make` only.** `[TypeId]` and `pipe` are required, so an object literal doesn't typecheck as a `Machine` (TS2739, checked under TypeScript 6 `--strict`). dom's `coordinatorMachine` becomes `Machine.make({ … })`.
   - **Never spread one.** `{ ...machine, span }` typechecks, but a spread copies own properties only: the result has no prototype, so no `pipe`, and `isMachine` says false. `keyframesMachine`'s one-stop case does this today; `Machine.withSpan` replaces it. Lint can't see the type behind a spread, so the rule's docs name the pitfall.
   - **No `Equal` or `Hash`:** a machine holds closures, so it compares by reference, Effect's default.
   - **`Pipeable`, not `Effectable`** (#93's reasoning): a machine has two drivers and needs a sink, and `machine.pipe(Effect.map(f))` would typecheck beside `Machine.map` and mean something else. Nothing on the per-frame path is an Effect, which keeps ADR-0027's decision 8 checkable by types.
   - **No `R` in the type.** A machine that needs a service to be built is an `Effect<Machine<F>, E, R>`, as `springBlend`'s and `animateValues`' are.
   - **`settles` stays a field.** Rejected: a settling `Machine` and an endless one as two types, which would type-check that `FrameLoop.run` on an endless machine never succeeds, at the price of two overloads on every combinator.
4. **A Primitive is its machine, and its `Stream` is `Machine.toStream` (amends ADR-0001 and ADR-0027).**
   - **One constructor per Primitive,** in the `Machine` module. The Stream functions (`tween`, `spring`, `animate`, …, `chaseCore`, `animateFrom`, `decayVec`'s Stream) go.
   - **`Machine.toStream(m)`** runs the machine over `Clock.ticks` under its one span (`m.span`), with the `<name>: subscribe` debug log annotated with its attributes: today's `fromClock`, for every Primitive. `FrameLoop.run` opens the same span with its `<name>: start` log, so both drivers trace a Primitive alike.
   - **The sequencing exists once,** in the combinators: `scalar.ts`' `segmentsInSequence`, `segmentOfRun`, `withDone` and the composites' Stream code go. ADR-0027's *Implementation in #68's first PR* ("the sequencing exists twice, and the parity tests pin it") is reversed.
   - **ADR-0027's rejected option is taken:** "Primitives return a machine, and `Stream` becomes an adapter (`toStream(spring(…))`)", rejected because "every Tier 2 caller changes, for nothing a user has asked for". Breaking changes are now fine, and since #74 nothing outside core's tests and bench calls a Primitive's Stream (about 75 call sites in `packages/test/test`, and `withMomentum`).
   - **Declared Tier 2 changes:**
     - **One span per Stream subscription,** named after its outermost Primitive, as on the loop (ADR-0027, decision 3). The nested `wardic.animate › wardic.tween`, `wardic.keyframes › wardic.tween`, `wardic.animateValues › wardic.animate › wardic.tween` and `wardic.springBlend › wardic.springValues` go;
     - **one `Clock.ticks` subscription and one subscribe log per run,** where a composite had one per segment. The seam's Frames don't change: the parity tests pin the machine's seam against `Stream.concat`'s;
     - **a fractional `repeat` settles** on its last segment through the Stream too, as the machine already did: the one difference between the drivers (ADR-0027, *Implementation in #68's first PR*) goes.
   - **Tests:**
     - **driver parity stays:** every constructor and combinator through `toStream` against `FrameLoop.run`, on `machines.test.ts`' uneven dts;
     - **the composites against an oracle:** today's composite Stream code (re-stamped segments under `Stream.concat`, `Stream.forever`) moves into `machines.test.ts`, built from the leaves' `toStream`, and pins the combinators' seams against `Stream.concat`'s and `Stream.forever`'s. The duplication lives in a test, as an oracle, not in core;
     - `observability.test.ts`' "animate composes tween spans" pins one `wardic.animate` span;
     - `delay-once.test.ts` and `spring-values-max-dt.test.ts` keep their exact Frames through both drivers.
   - **Rejected: a Stream function per Primitive** as sugar for `Machine.toStream(Machine.tween(…))`: every Primitive's signature twice, for one call's convenience, in a module of its own, since a `Stream` isn't a core data type.
5. **The names: Effect's word where the meaning is Effect's, core's term where Effect has none, and nothing without a caller.**
   - **The combinators,** each `dual` with the machine first:

     | Name | Replaces | What it does |
     |---|---|---|
     | `map(f)` | `mapFrames` | each Frame mapped by `f`, which runs per frame |
     | `concat(that)` | `inSequence`, two segments | `that` starts on the tick after `self` settles, and `self`'s settled Frame is re-stamped `done: false`: `Stream.concat`'s seam |
     | `concatAll(segments)` | `inSequence` | the same seam over N segments, flat: one step through them, not N nested `concat`s per step. Effect v3's name; v4 has no `Stream.concatAll` |
     | `forever` | `cycle` | restarts on the tick after it settles, every Frame `done: false`: `Stream.forever`'s. `cycle(rest)` is `forever(concatAll(rest))` |
     | `delay(seconds)` | `animatePlan`'s `optionsFor` (#77) | a hold before the first step: `Effect.delay`'s word |
     | `holdAfter(seconds)` | (#91) | after it settles, holds the settled value, `done: false`, for `seconds`, then settles. Effect has no hold after; #91's name |
     | `clampDt(max)` | each leaf's `Math.min(dt, MAX_DT)` (#78) | `dt` clamped before each step |
     | `withSpan(name, options)` | the span arguments | decision 6 |
     | `toStream` | `toStream` | the Stream driver (decision 4) |
     | `run(sink)` | `FrameLoop.use((loop) => loop.run(m, sink))` | the loop's driver, `Effect<F, never, FrameLoop>`. solid's `runOnLoop` becomes `Effect.flatMap(build, Machine.run(sink))` |

   - **The constructors:** each `xMachine` becomes `Machine.x`: `tween`, `spring`, `decay`, `chase`, `animate`, `keyframes`, `springValues`, `decayVec`, and `springBlend` and `animateValues`, which return `Effect<Machine<…>, never, InterpolatorRegistry>`. With `make` and `isMachine`; `MachineSpan` is `Machine.Span`. Being `dual`, the combinators compose under an Effect too: `Machine.springBlend(a, b).pipe(Effect.map(Machine.delay(0.1)))`.
   - **How the constructors use them:** `animate` is `concatAll(segments)`, or `concat(first, forever(concatAll(rest)))` for an infinite `repeat`, then `delay(options.delay)`, so the delay holds once by construction and `optionsFor` goes; `keyframes` is `concatAll`, then `delay`. Each constructor's outermost layer is `clampDt(MAX_DT)`, and the leaves' inline `Math.min` goes.
   - **The steppers keep their own `delay`.** dom's projection pass calls `springStep` with a layout transition's options (`toSpringOptions(transition())`), `delay` included, so a leaf's `delay` stays in its stepper, and `Machine.delay` holds around more than one leaf.
   - **The last bit after a hold changes:** `delay` subtracts the hold from the elapsed time at a different point than `stepTween` does. Measured, accepted and declared in decision 9.
   - **Rejected:**
     - **`andThen`,** #93's sketch: Effect's passes a value or flattens an Effect, so `m.pipe(Machine.andThen(n))` would read like `Effect.andThen` and mean `Stream.concat`.
     - **`timeScale` and `zip`:** no caller. Each is one combinator to add when a caller comes.
6. **Spans: a default from each constructor, and `withSpan` replaces it.**
   - **A machine's span is data** until a driver opens it, once per run (ADR-0027, decision 3), so only the outermost is ever opened, and nesting means nothing.
   - **Every constructor sets its Primitive's span,** with today's names and attributes (`wardic.tween { from, to, duration }`, `wardic.springValues { keys }`, …), so a run on either driver is traced with no extra step.
   - **`Machine.withSpan(name, { attributes })` replaces it:** the name, and the attributes as given. That's Effect's wrapping wherever a machine has a span to open: the outermost wins. The composites use it (`animate(0, 1).pipe(map(blend), withSpan("wardic.animateValues", { attributes: { keys } }))`), and an app names its own (`m.pipe(Machine.withSpan("app.bounce"))`).
   - **Effect's options object,** `{ attributes }`, for today's positional `MachineSpan`. Only `attributes`: `links`, `root` and `kind` wait for a driver that honours them. It's `dual` the way `Stream.withSpan` is, data-first told by `isMachine(arguments[0])` (`effect/Stream.js:7181`), since the options are optional.
   - **Every other combinator keeps `self`'s span,** `concat` the first machine's and `concatAll` its first segment's; `animate` and `keyframes` replace theirs.
   - **`make` takes a span,** required. dom's coordinator builds its machine per run, as now, so its `{ active }` is the count it started with: attributes are fixed when a machine is built.
   - **Rejected:**
     - **`withSpan` alone, no default:** every caller would have to name every run, or the loop's spans would go unnamed.
     - **Merging attributes:** two Primitives' attributes rarely share keys, so a merge mostly carries stale ones (a tween's `from` and `to` under `wardic.animateValues`).
     - **A span per segment:** the nesting decision 4 removes.
7. **The per-frame contract, and how it's measured (amends ADR-0025's decision 3 and ADR-0027's decision 12).**
   - **The contract:**
     1. A combinator's `start()` starts its inner machine and resolves everything once; its step makes plain calls only, in ADR-0025's per-frame forms (statement `if`s, `Math.min`, no `Option`, `Match`, Effect or new closure).
     2. `dual` and `pipe` run when a machine is built, never in a step. A step allocates only the Frame it returns, and only when it changes it: a seam re-stamps one Frame, and `holdAfter` re-stamps the settled Frame once and returns that object on every held tick.
     3. Defaults add no layer: `delay(0)`, `holdAfter(0)` and a one-segment `concatAll` return their input when the machine is built.
     4. Stepping in place stays deferred (ADR-0027, decision 4), to #83's part D, which measures allocation first.
   - **The depth of a step,** in calls:

     | Run | At `7967900` | With the module |
     |---|---|---|
     | `springValues` | the leaf, `Math.min` inline | `clampDt` → leaf |
     | `springBlend` | `mapFrames` → leaf | `map` → `clampDt` → leaf |
     | `animateValues`, one segment, no `delay` (the bench's) | `mapFrames` → `inSequence` → tween | `map` → `clampDt` → tween, with rule 3 |
     | `animate`, `repeat: Infinity`, `yoyo`, a `delay` | `inSequence` → `cycle` → `inSequence` → tween | `clampDt` → `delay` → `concat` → `forever` → `concatAll` → tween |

     The springs gain `clampDt`'s call per step; the bench says whether that's anything.
   - **The gate:** `bench:core --base main`, 11 paired reps, on the bench server, with Bun rerun alone when its noise control passes ±3%: every `Stream` and loop workload at ADR-0025's +5% median with its 25th percentile above 0, and Node's bytes at +5%. The `Stream` workloads now run `Machine.toStream`, one Stream layer where the composites had nested `Stream.concat` and `Stream.map`.
   - **The harness across the rename:** `harness.ts` is the working tree's and runs both cores, so for the slice that renames, each loop workload takes `core.Machine?.springValues ?? core.springValuesMachine`. The shim goes once main has the module.
   - **A workload for the deepest stack, `animateRepeat` and `animateRepeat/loop`:** `animateValues` with four keys, `repeat: Infinity`, `yoyo`, and a `delay` spread over the elements, so the seams fall on different frames, several of them inside the bench's 35. No workload had used `delay`, `repeat` or `keyframes`, so the bench never saw `concat`, `forever` or `delay`. Main builds the same machine, so it's gated from its first run, after one run of head against itself (ADR-0027, decision 12).
   - **Two throwaway probes, report-only:**
     - **building:** µs to build 1,000 of each constructor, main's `xMachine` against `Machine.x(…).pipe(…)`: the cost of `dual`, `pipe` and `Object.create`, which the bench's start column mixes with starting the run;
     - **`dual` per frame,** the record behind decision 1's positional per-frame functions: a `lerp`-shaped and an `applyAxisDelta`-shaped function, positional against `dual` data-first and data-last, ns per call, in Bun, Node and Chromium.
8. **The bindings change at their call sites, in the slice that changes each signature,** as #63's did. Tier 1 still hides Effect.
   - **solid's `runOnLoop` goes, for `Machine.run(sink)`:** `Machine.springValues(…).pipe(Machine.run(sink))` for a machine, and `Machine.springBlend(…).pipe(Effect.flatMap(Machine.run(sink)))` for one built with a service. The `Effect.succeed` wrappers `runOnLoop`'s one signature forced on the plain machines go (the spine's numeric leg, presence's numeric run, drag's two release runs), and its doc comment moves to `Machine.run`. In a pipe, an inline sink's `frame` takes its type from the machine, as `Effect.map((x) => …)` takes its from the Effect.
   - **dom's coordinator** is `Machine.make({ start, settles: true, span })`, run with `Machine.run(ignoreFrame)`.
   - **The other modules land the same way:** dom's reorder controller calls `Reorder`'s operations on the group where it calls the group's methods; solid's numeric / string split and `pick` (the spine, presence) call `Values`' operations once it has them; imports move to the subpaths.
   - **Not in #93:**
     - **the spine's stagger stays folded into the transition's `delay`** (ADR-0007, *Amendment (#77)*). As `.pipe(Machine.delay(extra))` it would read better, but it gains no behaviour and carries decision 5's last-bit risk onto every staggered leg; #69 rewrites solid's internals anyway;
     - **dom's and solid's own internals** (`Option` for `undefined`, loops): #69.
   - **Rejected: `runOnLoop` kept as a helper over `Machine.run`:** one `Effect.flatMap` saved at two call sites, for a second way to run a machine and the `Effect.succeed` wrappers at the others.
9. **Tests.**
   - **The last bit after a hold changes, and it's declared.** Measured (a throwaway script, core's steppers on `machines.test.ts`' uneven dts): a hold done as `Machine.delay` does it, held Frames and then the leftover to an undelayed step, against the stepper's own `delay`:

     | Case | Frames | Differing | Largest \|Δ\| |
     |---|---|---|---|
     | tween −5 → 20, 2 s, `delay` 0.05 / 0.1 / 0.3 | 63 / 65 / 74 | 38 / 36 / 50 | 1.2e-14 / 1.6e-14 / 2.5e-14 |
     | tween, 0.2 s, 60 and 30 Hz ticks | 12 / 14 / 23 | 2 / 5 / 5 | 7.1e-15 |
     | spring 0 → 100, `delay` 0.05 / 0.3, both dt sets | 26–67 | 0–16 | 1.4e-14 |

     Every `done` and every Frame count matched. At 1/16 s ticks the sums are exact, so `delay-once.test.ts` can't tell them apart.
     - The oracle (decision 4) defines a hold as the combinator does, held Frames and then the leftover, built with Stream ops, so the composites compare exactly.
     - One test runs `Machine.delay` against the stepper's `delay` on the uneven dts: values within 1e-12, every `done` and Frame count equal. It and this record are the declared change from main.
     - **Rejected: `animate`'s `delay` kept in its first segment's stepper,** as #77 did by hand: main's bits, for `optionsFor` kept and no hold "once by construction".
   - **Each combinator through both drivers, with exact Frames at 1/16 s ticks** (`delay-once.test.ts`' way): `concat`'s seam, and a `self` that never settles never reaching `that`, as `Stream.concat` after a `chase`; `concatAll`; `forever`; `delay`; `clampDt` (one 30 s dt steps `MAX_DT`); `map`; `holdAfter`, in #91's slice; `withSpan`, its name and attributes read by a recording Tracer on both drivers; and the defaults, `m.pipe(Machine.delay(0))` being `m` itself.
   - **Types, in `packages/core/test/machine.test.ts`,** checked by `bun run typecheck`, which runs every package's `typecheck:tests`: `@ts-expect-error` on an object literal as a `Machine` and on an Effect-returning sink through `Machine.run`; vitest's `expectTypeOf` for both `dual` forms giving one type, and for an inline sink's `frame` taking the machine's `F` in a pipe. With `isMachine`, `pipe`, and `toJSON` showing the span.
   - **Moved as they are:** about 75 Stream calls in `packages/test/test` become `Machine.toStream(Machine.x(…))`; `reorder-group.test.ts` takes `Reorder`'s operations; each `Values` operation gets its unit tests.
10. **The rule, where it lives, and what holds it.**
    - **Three places, as ADR-0025's:** this record; the working rules in [`docs/agents/pipeable.md`](../agents/pipeable.md), beside and linked with `effect-first.md`, a separate file because one is how code is written and the other the API's shape; and a pointer in `CLAUDE.md`, under *Agent skills*.
    - **The rule:**
      1. Every export lives in a module, `src/<Module>.ts`; the root re-exports namespaces only.
      2. A data type core builds is `Pipeable`, with a `TypeId`, an `isX` guard and Inspectable, built by its constructors: never written as a literal, never spread.
      3. A plain shape stays plain, and its module holds its type, its guards and its operations.
      4. An operation that takes its module's type first and more arguments besides is `dual`, unless it runs on the per-frame path, where it stays positional.
      5. Code in the repo imports subpaths.
    - **Its scope is `packages/core/src`.** The bindings' Tier 1 is Effect-free Solid API by definition (ADR-0025, decision 7), where `pipe` would be foreign to its users. dom's own Effect-typed exports (`DomLive`, the projection runtime) are left to #69. Rule 5 holds wherever code calls core.
    - **What holds each part:**

      | Part | Held by |
      |---|---|
      | the root re-exports namespaces only | **lint:** `no-restricted-syntax` on `ExportAllDeclaration[exported=null]` and `ExportNamedDeclaration` in `src/index.ts` (`VERSION` moves out of the root) |
      | the repo imports subpaths | **lint:** `ImportDeclaration[source.value='@wardic/core']` in dom, solid, test and the bench, in a `files` block holding only that rule, since the Effect-first rules there are #69's; `bun run lint` widens to those packages |
      | `internal/` stays inside core | **types:** `exports`' `"./internal/*": null`, so an outside import doesn't resolve |
      | a data type isn't a literal | **types:** `[TypeId]` and `pipe` are required (decision 3) |
      | an operation is `dual`; the data type's pattern; per-frame functions positional; no spread of a data type | **review**, with decision 9's type tests of each operation's two forms, and the bench for the per-frame path |

    - **Rejected:**
      - **a lint rule for PascalCase module files:** a plugin (`unicorn/filename-case`) for one check review sees at a glance;
      - **a type-aware rule against spreading a data type:** typescript-eslint has none built in, and a custom one would be the repo's first. The pitfall is in the rules' docs.
11. **A service's module holds its key, its types, its constructors and its `layer`: effect's convention.** Module `X` has the service key `X.X`, as `effect/reactivity`'s `AtomRegistry.AtomRegistry` and `AtomRegistry.layer` (`AtomRegistry.d.ts:137`, `:163`) and `effect/Path`'s `Path.Path` and `Path.layer` are.

    | At `7967900` | In the module |
    |---|---|
    | `Clock`, `RefreshFrameSource`, `makeRefreshFrameClock(source)` | `Clock.Clock`, `Clock.RefreshFrameSource`, `Clock.fromRefreshFrames(source)` |
    | `FrameLoop`, `FrameLoopLive`, `Sink`, `FrameLoopShape`, `makeFrameLoop` | `FrameLoop.FrameLoop`, `FrameLoop.layer`, `FrameLoop.Sink`; the shape and `make` to `internal/` |
    | `InterpolatorRegistry`, `makeInterpolatorRegistry`, `InterpolatorRegistryLive` | `InterpolatorRegistry.InterpolatorRegistry`, `.make(entries?)`, `.layer`; `InterpolatorEntry` is `Interpolator.Entry`, beside the entries and codecs (decision 1) |
    | `InputSource`, its event types, `makePointerLikeEvent`, `isPrimaryPointer`, `heldPointerSource` | `InputSource.InputSource`, its event types, `InputSource.heldPointer(…)` |
    | `Renderer`, `Patch`; `Probe`, `Bounds`, `Viewport` | `Renderer.Renderer`, `Renderer.Patch`; `Probe.Probe`, `Probe.Bounds`, `Probe.Viewport` |
    | `DragActivity`, `makeDragActivity` | `DragActivity.DragActivity`, `DragActivity.make` |

    - **The `xLive` names go, for `layer`.** Call sites read `yield* Clock.Clock` and `FrameLoop.FrameLoop.use(…)`.
    - **`Machine.run` imports `FrameLoop`, which needs only `Machine`'s type,** so their cycle is type-only on one side.
    - **Rejected: the service class as its module's one export** (`import { Clock } from "@wardic/core/Clock"`, `yield* Clock`). Shorter to read, but the constructors and layers would have to be statics on a `Context.Service` class, which no effect module does, and `import { X }` against `import * as X` would differ by module.
12. **Every other export's module,** read off core at `7967900`:

    | Module | Holds | Kind |
    |---|---|---|
    | `Machine` | decisions 3 to 6, with the option bags beside the constructors that take them (`TweenOptions`, `SpringOptions`, `DecayOptions`, `AnimateOptions`, `Modifiers`) and `MAX_DT` | data type |
    | `Frame` | `Frame`, `PhysicsFrame` → `Frame.Physics`, `MultiPhysicsFrame` → `Frame.MultiPhysics`, `isPhysicsFrame` → `Frame.isPhysics`. `NOMINAL_DT` is the Clock's: `Clock.NOMINAL_DT` | plain |
    | `Spring` | `springs`' presets (`Spring.gentle`, …); the stepper, `init`, `step`, `resolve`, `State`, Tier 3 for dom (decision 2). The tween's and decay's steppers go to `internal/` | plain, per frame |
    | `Easing` | the Penner easings, names kept; `cubicBezier`, `steps`, `springEasing` → `Easing.spring`; the `Easing` type. The `easings` object goes: the namespace is that object | plain, per frame |
    | `Interpolator` | `.number`, `.array`, `.color(mode)`, `.unit`, `.complex`, `defaultInterpolators` → `.defaults`, the three codecs, `unitOf`, `.Entry` | plain |
    | `Values` | `Values`, `Variant`, `Variants`; new, the numeric / string split and `pick` solid writes by hand | plain |
    | `Override` | `Override`, `resolveOverrides` → `Override.resolve`: CONTEXT's Override stack | plain |
    | `BaseValue` | `baseValueOf` → `.of`, `startValueOf` → `.start`, `transformIdentity`, `TRANSFORM_IDENTITY`, the source types | plain |
    | `Box` | `Box`, `Axis`, `calcLength` → `.length`, `boundsToBox` / `boxToBounds` → `.fromBounds` / `.toBounds`, `mixAxis`, `mixBox` | plain, per frame |
    | `Projection` | `Delta`, `AxisDelta`, the `calc*`, `apply*` and `*Relative*` geometry, `PROJECTION_KEY`, `ProjectionValue` | plain, per frame |
    | `Flip` | `flip` → `Flip.make`, `FlipTransform`, `FLIP_IDENTITY` | plain |
    | `Scalar` | `lerp`, `inverseLerp`, `clamp`, `wrap`, `remap`, `damp`, `snap`, `snapTo`. Not `Math`, which would hide the global | plain, per frame |
    | `Point` | `Point`, `distance`, `angle`, `lerpPoint` → `Point.lerp`; drag's `Vec2`, the same `{ x, y }`, merges into it | plain |
    | `Velocity` | `velocity` → `.between`, `velocityOf` → `.of`, reorder's `trailingVelocity` → `.trailing`, `TimedPoint` | plain |
    | `Stagger` | `stagger` → `Stagger.make`, its option types | plain |
    | `Wave` | `wave` → `.sine`, `pulse`, `noise` | plain |
    | `Recognizer` | `hover`, `press`, `focus`, `inView`, `drag`: CONTEXT's Recognizer | Stream constructors |
    | `Drag` | `DragSample` → `Drag.Sample`; `axisLock` and `withinBounds`, now `dual`; `DragBounds`, `AxisRange`; `withMomentum` → `Drag.fling`, CONTEXT's Fling | plain, Stream combinators |
    | `Reorder` | the group, `make` and `dual` `register`, `resolveAxis`, `dragStart`, `dragMove`, `dragEnd`, `move` in place of its methods; `checkReorder`, `detectAxis`, `moveItem`, the item types | data type |
    | `AutoScroll` | `autoScrollStep` → `.step`, `autoScrollAxis` → `.axis`, `AutoScrollState`, its two constants | plain |
    | `ReducedMotion` | `respectReducedMotion` → `ReducedMotion.respect` | Stream combinator |
    | `Microtask` | `nextMicrotask` → `Microtask.next`, for the Clock and dom's projection | Effect |
    | the services | decision 11, with `applyTo` → `Renderer.applyTo`, `dual`, the stream first, and `delay` → `Clock.delay` until #83 (A) replaces it | services |

    - **Gone:** `group`, `onFrame`, `onSettle` and `wait`, which effect's modules each say in one call (`Effect.all`, `Stream.tap`, `Stream.runDrain` and `Effect.andThen`, `Stream.takeUntil` and `Stream.runDrain`): the maintainer's "Effect's pipeable modules wherever they fit". None has a caller outside core's tests. And the aliases `draggable` and `animateFrom`.
    - **Found, not acted on here:** CONTEXT.md's *Flagged ambiguities* say the bindings apply `respectReducedMotion` by default, and solid never imports it: #98.
13. **How #93 lands.** Each slice adds an *Implementation in* section here, as ADR-0027's did.
    - **This record first,** docs only, with the rule in `docs/agents/pipeable.md`, its pointer in `CLAUDE.md`, and CONTEXT.md's Segment and Hold, so the rule holds before more API is written the old way.
    - **#94, the `Machine` module** (decisions 3 to 9): the data type, the combinators, the constructors, `Machine.toStream` in place of the Stream functions, `Machine.run` in place of solid's `runOnLoop`, and the `animateRepeat` workloads. It amends ADR-0001 and ADR-0027, and declares decision 4's and decision 9's changes.
    - **#95, every other export in its module, and the lint** (decisions 1, 2, 10, 11 and 12): mechanical and behaviour-neutral. It amends ADR-0008. Blocked by #94.
    - **#96, the Reorder group as a data type** (decision 1). Blocked by #95.
    - **#97, `Values`' operations** (decision 12). Blocked by #95.
    - **#91, `holdAfter` with its first caller, `repeatDelay`,** the combinator slice. Blocked by #94.
    - **Comments:** #83 (A, C and D against this record), #69 (the lint block, dom's own exports, the spine's stagger).

## Consequences

- **Breaking, for Tier 2 and the bindings:** every name and import path in core changes, the Stream functions go, and the services read `X.X`. No alias is kept: core is unpublished.
- **Tier 2's Streams trace and subscribe once per run** (decision 4), and a Frame after a `Machine.delay` hold can differ from main's in its last bit (decision 9).
- **The sequencing exists once,** in `Machine`'s combinators, and fixes like #77's and #78's land in a combinator, once, for both drivers.
- **ADR-0008's Tier 3 curation lands** with the subpaths (decision 2), and its "no subpath split yet" is reversed.
- **CONTEXT.md gains Segment and Hold.** A Primitive is still a Primitive: `Machine` is its code form, as the glossary's *Avoid* says.
- **#69 inherits** dom's own exports' shape and a lint block to extend (decision 10).
