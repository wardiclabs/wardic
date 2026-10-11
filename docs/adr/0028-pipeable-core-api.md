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
     2. `dual` and `pipe` run when a machine is built, never in a step. A step allocates only the Frame it returns, and only when it changes it: a seam re-stamps one Frame, and `holdAfter` re-stamps the settled Frame once and returns that object on every held tick. Since #111 a leaf may rewrite its Frame in place: *Amendment (#111)*.
     3. Defaults add no layer: `delay(0)`, `holdAfter(0)` and a one-segment `concatAll` return their input when the machine is built.
     4. Stepping in place stays deferred (ADR-0027, decision 4), to #83's part D, which measures allocation first. `springValues` steps in place since #111: *Amendment (#111)*.
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
    | `Velocity` | `velocity` → `.between`, `velocityOf` → `.of`, which went with #25 (*Amendment (#25)*), reorder's `trailingVelocity` → `.trailing`, `TimedPoint` | plain |
    | `Stagger` | `stagger` → `Stagger.make`, its option types | plain |
    | `Wave` | `wave` → `.sine`, `pulse`, `noise` | plain |
    | `Recognizer` | `hover`, `press`, `focus`, `inView`, `drag`: CONTEXT's Recognizer | Stream constructors |
    | `Drag` | `DragSample` → `Drag.Sample`; `axisLock` and `withinBounds`, now `dual`; `DragBounds`, `AxisRange`; `withMomentum` → `Drag.fling`, CONTEXT's Fling | plain, Stream combinators |
    | `Reorder` | the group, `make` and `dual` `register`, `resolveAxis`, `dragStart`, `dragMove`, `dragEnd`, `move` in place of its methods; `checkReorder`, `detectAxis`, `moveItem`, the item types | data type |
    | `AutoScroll` | `autoScrollStep` → `.step`, `autoScrollAxis` → `.axis`, `AutoScrollState`, its two constants | plain |
    | `ReducedMotion` | `respectReducedMotion` → `ReducedMotion.respect` | Stream combinator |
    | `Microtask` | `nextMicrotask` → `Microtask.next`, for the Clock and dom's projection | Effect |
    | the services | decision 11, with `applyTo` → `Renderer.applyTo`, `dual`, the stream first, and `delay` → `Clock.delay`, which went with #109 (*Amendment (#109)*) | services |

    - **Gone:** `group`, `onFrame`, `onSettle` and `wait`, which effect's modules each say in one call (`Effect.all`, `Stream.tap`, `Stream.runDrain` and `Effect.andThen`, `Stream.takeUntil` and `Stream.runDrain`): the maintainer's "Effect's pipeable modules wherever they fit". None has a caller outside core's tests. And the aliases `draggable` and `animateFrom`.
    - **Found, not acted on here:** CONTEXT.md's *Flagged ambiguities* say the bindings apply `respectReducedMotion` by default, and solid never imports it: #98. #98 removed `ReducedMotion.respect` and made the module the policy and the Snap (ADR-0029).
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

## Implementation in #94 (slice 1): the `Machine` module

- **`packages/core/src/Machine.ts`** holds decisions 3 to 6: the data type (`TypeId`, a prototype with `pipe` and `Inspectable.BaseProto`, `toJSON` `{ _id: "Machine", span, settles }`, `make`, `isMachine`, `Span`), the combinators, the two drivers, the ten constructors with their blenders, the option bags and `MAX_DT`. Nothing is shared with another module yet, so `src/internal/` stays empty. `machine.ts`, `scalar.ts`, `chase.ts` and `multi.ts` go, and `Machine.ts` takes `multi.ts`' place among lint's per-frame loop files.
- **The exports:** `"./*": "./src/*.ts"` and `"./internal/*": null` beside `"."`, and the root gains `export * as Machine`. Its flat `export *`s stay for #95.
- **Core imports the module relatively** (`withMomentum`'s `import * as Machine from "../Machine.ts"`), not as `@wardic/core/Machine`. The bench copies a core's `src` without its `package.json`, so a self-reference there would resolve to the working tree's core, on both sides. #95 decides the specifier inside core with the rest of its imports.
- **Which combinators are `dual`** follows rule 4: `map`, `concat`, `delay`, `clampDt`, `withSpan` and `run` take a machine and more. `concatAll` takes an array of machines, and `forever` the machine alone, so neither is.
- **Seams.** A seam re-stamps `{ ...frame, done: false }`, keeping a physics Frame's `velocity`, and allocates nothing between seams. `forever` re-stamps only its restart's Frame, where `cycle` re-stamped every Frame: `animateRepeat`'s steps allocate 26% less (below).
- **A segment that never settles ends the sequence,** as an endless `Stream` does in `Stream.concat`: `concatAll` drops the segments after it, so `concat(chase, that)` and `forever(chase)` are `chase` itself. `forever`'s `settles` is `false`; its Frames never settle.
- **`delay`'s hold** returns the Frame its machine starts at (its step at 0, re-stamped if settled), the same object every held tick, then steps the time left over on the tick the hold ends. A negative `delay` starts that far in, as the stepper's does. That's the hold decision 9 measured, and `machines.test.ts`' oracle holds the same way.
- **The harness across the rename** needed the Stream workloads shimmed too, not only the loop ones (decision 7): main's Stream functions are gone from head. Each workload takes `core.Machine` when it's there, else main's `xMachine` or Stream function of the same name.

### The per-frame contract: the clamp stays inline (amends decisions 5 and 7)

- **The gate on the module as designed failed in V8** (`d0f03fd`, `bench:core --base main`, 11 paired reps on the bench server, every noise control valid). Every `Stream` workload ran faster on every engine, and Bun passed everything. Three loop workloads failed, head / base, median [p25–p75]:

  | Workload | Bun | Node | Chromium |
  |---|---|---|---|
  | `springValues/loop` | −5.0% [−11.0, −0.0] | +1.4% [+0.6, +1.6] | +10.0% [+3.1, +10.0], fails |
  | `chase/loop` | −12.9% [−24.3, −7.4] | +13.6% [+9.6, +14.0], fails, and bytes 0.17 → 0.18 | +20.0% [+0.0, +20.0], fails |
  | `animateRepeat/loop` | +7.0% [−4.2, +11.5] | +8.6% [+4.5, +9.0], fails | +14.5% [+5.0, +19.0], fails |

- **Why:** a combinator's step is one function shared by every machine, so the call inside it sees several steps and V8 doesn't inline it. Each layer is a real call per element per frame, which shows where the step is cheap: `chase`'s is about 50 ns. JSC didn't show it. The `clampDt(MAX_DT)` layer over each leaf was that call for the springs and `chase`.
- **Three throwaway variants,** measured the same way (median head / base for Bun / Node / Chromium):

  | Variant | `springValues/loop` | `chase/loop` | `animateRepeat/loop` |
  |---|---|---|---|
  | as designed | −5.0 / +1.4 / +10.0% | −12.9 / +13.6 / +20.0% | +7.0 / +8.6 / +14.5% |
  | A: the leaves clamp inline, and the hold counts each tick at most `MAX_DT` | −3.9 / +0.0 / +0.0% | −24.4 / −3.6 / +0.0% | −0.5 / +9.1 / +15.3% |
  | A, and `forever(concatAll(…))` cycling its segments in one step | −3.5 / −0.1 / +0.0% | −23.0 / −1.4 / +0.0% | +8.6 / +7.6 / +13.1% |
  | A, and `animate`'s delay back in its first segment's stepper | −2.1 / −0.2 / +1.6% | −24.7 / −3.7 / −0.0% | −2.3 / +7.0 / +8.1% |

- **Decided (the maintainer, 2026-10-09):**
  - **The clamp stays inline, as variant A.** Each leaf's step clamps with `Math.min(dt, MAX_DT)`, once, as at `7967900`, and `delay`'s hold counts each tick at most `MAX_DT`, as a step does, so a stall can't skip the rest of a hold. No constructor has a `clampDt` layer. `clampDt` stays, for a machine built with `make`. So #78's fix is in each leaf, not in a combinator: the one place this slice departs from *Consequences*.
  - **`animateRepeat/loop`'s depth is accepted and declared:** +9.4% in Node and +11.9% in Chromium at the gate below, about +0.03–0.04 ms per frame at 1,000 elements. Its `Stream` form runs 62–69% faster, and its steps allocate 26% less. Neither the cycle nor the delay in the stepper got it under +5% in V8, and the delay in the stepper is decision 9's rejected option.
- **The depth of a step,** as landed:

  | Run | At `7967900` | Designed | Landed |
  |---|---|---|---|
  | `springValues` | the leaf, `Math.min` inline | `clampDt` → leaf | the leaf, `Math.min` inline |
  | `springBlend` | `mapFrames` → leaf | `map` → `clampDt` → leaf | `map` → leaf |
  | `animateValues`, one segment, no `delay` | `mapFrames` → `inSequence` → tween | `map` → `clampDt` → tween | `map` → tween |
  | `animate`, `repeat: Infinity`, `yoyo`, a `delay` | `inSequence` → `cycle` → tween | `clampDt` → `delay` → `concat` → `forever` → `concatAll` → tween | `delay` → `concatAll` → `forever` → `concatAll` → tween |

- **The rule is in `docs/agents/pipeable.md`:** a layer is a call per element per frame, so a constructor keeps a per-step concern inline in its leaf.

### The declared changes, as landed

- **Tier 2:** one span and one `Clock.ticks` subscription per `Stream` run, named after the outermost Primitive; a fractional `repeat` settles on its last segment; a Frame after a `delay` hold (`animate`, `keyframes`) can differ from main's in its last bit. On `machines.test.ts`' dts, against the stepper's own `delay`: tween −5 → 20 over 2 s with 0.05 / 0.1 / 0.3 differs in 47 / 49 / 63 of 63 / 65 / 74 Frames, by at most 3.6e-15 / 7.1e-15 / 2.1e-14; a 0.2 s tween in 3 of 6 (2.8e-17); a spring with 0.05 in 3 of 26 (1.8e-15) and with 0.3 in none. Every `done` and Frame count is the same.
- **Logs:** a `<name>: subscribe` log is annotated with its span's attributes, so `springValues`', `animateValues`' and `springBlend`'s `keys` is a count where it was the key names.
- **`withMomentum`'s fling** runs `Machine.toStream(Machine.decayVec(…))`, so it gains a `wardic.decayVec` span and log under `wardic.momentum`, which `decayVec`'s `Stream` didn't have.

### Tests

- **`packages/test/test/machines.test.ts`:** `animate` (eight cases), `keyframes` (three), `animateValues` and `springBlend` against an oracle, their `Stream`s as they were before #94: the leaves' `toStream` under `Stream.concat`, `Stream.forever` and `Stream.map`, with the hold written as `Machine.delay`'s. Then every constructor and every combinator through both drivers on the uneven dts, and `Machine.delay` against the steppers' own `delay` (within 1e-12, every `done` and count equal). All exact.
- **`packages/test/test/combinators.test.ts`,** at 1/16 s ticks through both drivers: `concat`'s seam and a `self` that never settles; `concatAll`; `forever`; `delay` (its hold, the time left over, one held Frame object, a negative delay, a stall counting at most `MAX_DT`); `clampDt`, and a 30 s dt stepping `MAX_DT` through a constructor; `map`; `withSpan`, read by a recording Tracer on both drivers; and the defaults returning their input.
- **`packages/core/test/machine.test.ts`:** TS2739 on an object literal as a `Machine` and TS2322 on an Effect-returning sink, each a `@ts-expect-error`; both forms of every `dual` operation giving one type; an inline sink's `frame` typed by the machine in a pipe and under `Effect.flatMap`; `isMachine` (false for a spread), `pipe`, `toJSON`.
- **`observability.test.ts`:** an `animate` run is one `wardic.animate` span and one subscribe log. **`delay-once.test.ts`** and **`spring-values-max-dt.test.ts`** keep their Frames through both drivers. The other `Stream` calls in `packages/test/test` became `Machine.toStream(Machine.x(…))`; core's and dom's hand-built machines became `Machine.make`.

### The bench

- **The new workloads first** (`6b14ca7` against itself, 11 paired reps): every workload passed. `animateRepeat` read +0.6% / −0.5% in Node / Chromium and +3.5% in Bun (a rerun: the first run's noise control was −3.3%); `animateRepeat/loop` −0.7% / −3.2% / −0.5%. One false failure on identical code: Node's bytes for `animateValues/loop`, 0.69 → 0.76 MB (+10.1%); a Node rerun read 0.76 → 0.76.
- **The gate run** (`92a46aa`, `bench:core --base main`, 11 paired reps). Noise controls: Bun −0.2%, Chromium −0.5%, and Node +2.1% on a Node-only rerun, its first at −3.1%. Head / base, median [p25–p75]:

  | Workload | Bun | Node | Chromium | Node MB per frame |
  |---|---|---|---|---|
  | `springValues` | −2.8% [−4.4, +0.6] | −0.7% [−1.9, +0.5] | −2.4% [−4.2, −1.1] | 4.95 → 4.95 |
  | `animateValues` | −29.0% [−30.4, −27.3] | −37.1% [−38.0, −35.5] | −30.4% [−31.8, −29.4] | 6.75 → 4.76 |
  | `springBlend` | −23.9% [−25.2, −22.1] | −23.8% [−24.5, −23.6] | −16.5% [−17.8, −16.3] | 6.18 → 5.11 |
  | `chase` | −6.2% [−7.5, −4.5] | −3.4% [−3.6, −3.2] | −2.0% [−4.0, −1.7] | 4.13 → 4.13 |
  | `animateComplex` | −27.9% [−30.4, −27.2] | −25.1% [−27.1, −24.8] | −27.5% [−28.4, −26.6] | 8.27 → 6.32 |
  | `animateRepeat` | −69.4% [−72.2, −67.7] | −66.1% [−66.5, −65.9] | −61.8% [−63.1, −61.6] | 11.19 → 4.76 |
  | `springValues/loop` | −4.7% [−9.4, −4.5] | −0.5% [−1.3, −0.1] | −1.5% [−3.4, +0.0] | 0.92 → 0.92 |
  | `animateValues/loop` | −4.7% [−9.2, +1.4] | +4.1% [−5.5, +7.3] | +2.1% [−0.0, +2.2] | 0.76 → 0.80 |
  | `springBlend/loop` | −9.7% [−13.7, −7.3] | +2.0% [−1.5, +7.7] | +4.4% [−1.4, +7.7] | 1.12 → 1.12 |
  | `chase/loop` | −28.6% [−42.2, −21.2] | −2.3% [−5.4, −1.6] | +0.0% [+0.0, +0.0] | 0.17 → 0.17 |
  | `animateComplex/loop` | −1.6% [−2.0, +2.1] | −1.0% [−1.6, +0.1] | +0.8% [−0.8, +0.8] | 2.30 → 2.30 |
  | `animateRepeat/loop` | +3.2% [−6.5, +10.4] | +9.4% [+6.9, +12.7], fails | +11.9% [+4.7, +14.8], fails | 0.80 → 0.80 |

  - **The `Stream` workloads run faster on every engine:** 1–6% for `springValues` and `chase`, which were one layer already, and 17–69% for the composites, whose Node bytes per frame fall 17–57%. Each runs one `Stream` layer where a composite nested a `Stream.concat`, a `Stream.map` and a span per segment.
  - **`animateRepeat/loop` fails as declared** (above).
  - **Node's bytes flag `animateValues/loop` (+5.1% and +5.4% in both Node runs), and it's the GC's timing, not allocation.** Its step is `map` → tween, one layer fewer than main's, allocating the same objects. On identical code it read 0.69 and 0.76. A steps-only probe (`.tmp/94-bytes/`: 1,000 machines stepped by hand over 2,000 frames, the bench's heap hook, 7 fresh Node processes per side) reads the same floor on both: main 640,347–736,355 bytes per frame, head 640,338–704,383, each process landing on 640 KB or about 10% above it. On the same probe, `animateRepeat`'s steps allocate 26% less (983,939 → 723,820 bytes per frame) and take 11% longer (0.426 → 0.474 ms).
- **The probes** (report-only, on the bench server, 11 reps, fresh processes or pages):
  - **Building** (`.tmp/93-build/`), µs to build 1,000, main's `xMachine` → `Machine.x`, medians:

    | Constructor | Bun | Node | Chromium |
    |---|---|---|---|
    | `tween` | 86 → 216 | 61 → 150 | 55 → 90 |
    | `spring` | 145 → 222 | 148 → 167 | 45 → 100 |
    | `chase` | 95 → 112 | 99 → 158 | 30 → 85 |
    | `animate` | 304 → 587 | 168 → 557 | 180 → 650 |
    | `animate`, `repeat: Infinity`, `yoyo`, a `delay` | 318 → 908 | 309 → 814 | 275 → 960 |
    | `keyframes` | 276 → 637 | 344 → 793 | 300 → 655 |
    | `springValues` | 61 → 136 | 134 → 206 | 40 → 100 |
    | `springBlend` | 2,945 → 3,204 | 2,965 → 3,217 | 2,525 → 2,875 |
    | `animateValues` | 2,454 → 3,046 | 2,886 → 3,436 | 2,480 → 2,985 |

    `dual`, `pipe` and `Object.create` add about 0.02–0.7 µs per machine. Starts aren't gated, and the gate run's moved both ways: the `Stream` workloads' fell up to 43 ms per 1,000 (one subscription per run, Chromium's `animateRepeat` 68.4 → 25.7), and the loop workloads' rose 0–4 ms per 1,000 (Bun's `animateRepeat/loop` 11.7 → 15.8), more than building accounts for. That isn't investigated here.
  - **`dual` per call** (`.tmp/93-dual/`), ns per call, ratio to positional [p25–p75]:

    | Shape | Form | Bun | Node | Chromium |
    |---|---|---|---|---|
    | `lerp` (three numbers) | positional | 0.73 | 0.47 | 0.39 |
    | | data-first | 2.12, ×2.92 [2.90, 3.83] | 0.47, ×1.00 | 0.39, ×1.00 |
    | | data-last | 3.77, ×5.24 [5.17, 6.77] | 8.14, ×17.4 | 6.10, ×15.7 |
    | `applyAxisDelta` (two objects in, one out) | positional | 1.29 | 1.24 | 1.32 |
    | | data-first | 1.22, ×0.94 | 1.26, ×1.02 | 1.32, ×0.99 |
    | | data-last | 4.34, ×3.36 | 6.85, ×5.52 | 5.59, ×4.22 |

    Decision 1's positional per-frame functions stand. V8 inlines a data-first `dual` call, but JSC doesn't for `lerp`'s shape (×2.9), and a data-last call allocates its closure (×3–17).

## Implementation in #95 (slice 2): every export in its module, and the lint

- **29 modules at `packages/core/src/<Module>.ts`:** `AutoScroll`, `BaseValue`, `Box`, `Clock`, `Drag`, `DragActivity`, `Easing`, `Flip`, `Frame`, `FrameLoop`, `InputSource`, `Interpolator`, `InterpolatorRegistry`, `Machine`, `Microtask`, `Override`, `Point`, `Probe`, `Projection`, `Recognizer`, `ReducedMotion`, `Renderer`, `Reorder`, `Scalar`, `Spring`, `Stagger`, `Values`, `Velocity`, `Wave`. The folders and their barrels go, and the root is 29 `export * as X from "./X.ts"` lines.
- **`src/internal/`** holds what two modules share: the tween's and decay's steppers, `valueOr` and the step results (`internal/stepper.ts`, for `Machine` and `Spring`), and the Frame loop's shape and `make` (`internal/frameLoop.ts`, decision 11). Core's own `frame-loop.test.ts` reaches it by path.
- **The services, as decision 11 has them,** and decision 12's renames, as tabled. The presets are six constants, `Spring.gentle` … `Spring.bouncy`. The `dual`s are `Drag.axisLock` (arity 2), `Drag.withinBounds` (told apart by `Stream.isStream`, since its options are optional) and `Renderer.applyTo` (an `Effect.fn` inside `dual`, its span still `wardic.applyTo`). `group`, `onFrame`, `onSettle`, `wait`, `draggable` and the `easings` object go.
- **Decided with the maintainer (2026-10-09), where decisions 2, 10 and 12 left it open:**
  1. **Core's modules import each other relatively, as namespaces:** `import * as Clock from "./Clock.ts"`. This amends decision 2's "core's modules among themselves write `@wardic/core/Machine`". The bench copies a core's `src` without its `package.json`, so a self-reference there would resolve to the working tree's core, on both sides of a run.
  2. **`Spring.step` takes the resolved spring,** one stepper: dom's projection pass writes `Spring.step(state, dt, 1, Spring.resolve(options()))`, the work `springStep` did. `springStep`, `tweenStep` and `decayStep`, the options forms, go. `Spring.Resolved` is public beside `Spring.State`.
  3. **`VERSION` goes.** Core's version is its `package.json`'s, which `exports` already serves. The example reads it there; dom's and solid's `VERSION` wait for #69.
  4. **A name that repeats its module drops the repeat:** `Box.mix`, `Projection.KEY` and `.Value`, `Flip.Transform` and `.IDENTITY`, `Stagger.Options` and `.Origin`, `Drag.Bounds` and `.FlingOptions`, `DragActivity.Shape`, `AutoScroll.State`, `.THRESHOLD` and `.MAX_SPEED`, `Reorder.check`, `.Axis` and `.ItemData`, `Interpolator.Entry`, `Easing.SpringOptions`, `InputSource.HeldPointerOptions`. The module's own type keeps its name (`Box.Box`), and the Reorder group's names wait for #96. The rule is in `docs/agents/pipeable.md`.
- **The call sites,** 98 files in dom, solid, test, the bench and the example, were moved by a codemod over TypeScript's checker. It rewrote each identifier bound to an `@wardic/core` import to `Module.name`, gave a shorthand property its key, and left a local that shadows one alone. solid's `reorder.tsx` and its test harness already have a `Reorder`, the Solid component, so they import core's as `CoreReorder`.
- **The lint** (decision 10):
  - in `src/index.ts`, `no-restricted-syntax` on `ExportAllDeclaration[exported=null]` and `ExportNamedDeclaration`;
  - in dom, solid and test (src and test) and the bench, `ImportDeclaration[source.value='@wardic/core']`, in a block holding only that rule, with `bun run lint` widened to those packages;
  - `PER_FRAME_LOOPS` names `Spring.ts`, `internal/frameLoop.ts`, `Machine.ts`, `Interpolator.ts`, `Scalar.ts` and `Projection.ts`;
  - solid's code carries eslint-plugin-solid's `solid/reactivity` directives, for an editor that runs the plugin. The block names that rule as a no-op and doesn't report its directives as unused.
- **Tests:**
  - the four for the removed helpers go;
  - `smoke.test.ts` pins the root as namespaces only, PascalCase each, with no `VERSION`;
  - `dual.test.ts` pins both forms of each new `dual`, by type and by what they emit.
  - Every other outcome is unchanged: 596 node tests and 615 browser tests pass.
- **The gate run** (`3d9feee`, `bench:core --base main`, 11 paired reps on the bench server; noise controls Bun +0.8%, Node +0.6%, Chromium −0.9%). The harness reads the services and the easing through a shim across the rename, and #94's shim goes. Head / base, median [p25–p75]:

  | Workload | Bun | Node | Chromium | Node MB per frame |
  |---|---|---|---|---|
  | `springValues` | −1.9% [−3.7, +1.2] | −0.8% [−1.2, +0.3] | −0.3% [−1.1, +2.2] | 4.95 → 4.95 |
  | `animateValues` | −0.6% [−3.1, +4.3] | −0.1% [−1.8, −0.0] | +0.3% [−1.3, +1.4] | 4.75 → 4.76 |
  | `springBlend` | −3.3% [−6.8, +2.4] | +0.1% [−1.8, +1.4] | +0.8% [+0.0, +3.2] | 5.11 → 5.11 |
  | `chase` | +5.5% [−9.4, +6.8] | −0.2% [−1.9, +1.7] | +1.1% [−2.0, +2.1] | 4.13 → 4.13 |
  | `animateComplex` | +0.1% [−0.6, +1.1] | −0.3% [−1.2, −0.0] | +0.7% [−1.3, +1.7] | 6.32 → 6.32 |
  | `animateRepeat` | −4.3% [−6.9, −2.2] | +1.1% [+0.4, +2.0] | +0.5% [−0.5, +1.8] | 4.76 → 4.76 |
  | `springValues/loop` | +3.7% [−2.8, +5.6] | +0.6% [+0.0, +1.0] | −9.2% [−10.9, −3.3] | 0.92 → 0.92 |
  | `animateValues/loop` | +1.2% [−4.7, +3.3] | −0.3% [−1.4, +3.1] | −2.0% [−2.1, +4.3] | 0.80 → 0.80 |
  | `springBlend/loop` | +0.5% [−14.4, +2.0] | +2.5% [−1.3, +4.0] | +3.2% [+1.6, +12.1] | 1.05 → 1.12 |
  | `chase/loop` | −13.5% [−18.6, +9.4] | −1.5% [−5.3, +3.2] | +0.0% [+0.0, +0.0] | 0.17 → 0.17 |
  | `animateComplex/loop` | −0.5% [−2.8, +1.3] | −0.7% [−1.7, +0.5] | +0.0% [−4.1, +3.4] | 2.30 → 2.30 |
  | `animateRepeat/loop` | −0.3% [−4.4, +4.3] | −1.9% [−3.5, −0.3] | +0.0% [−7.5, +3.0] | 0.80 → 0.80 |

  - **Every workload passes the time gate on every engine.**
  - **Node's bytes flag `springBlend/loop`** (1.05 → 1.12 MB, +6.4%): the GC's timing, the pair of readings it gave on identical code in #94. The steps-only probe (`.tmp/94-bytes/`, 7 processes per side) reads 872,589 bytes per frame on both sides for its steps, and 610,027 for `springValues`'.
- **Found, not from #95:** core's "a run retrying against a Clock that dies at once" test (2,000 retries) takes about 2.6 s alone against its 5 s timeout, on main and here alike. It timed out once in a full parallel `bun run test`, and passed in the reruns.

## Implementation in #96 (slice 3): the Reorder group as a data type

- **`Reorder.Group<V>`, on `Machine`'s pattern:** a `TypeId` (`"~@wardic/core/Reorder"`), invariant in `V`, since a group both reads and takes values; a prototype with `pipe` and `Inspectable.BaseProto`, whose `toJSON` is `{ _id: "Reorder.Group", registered, dragging }`; `Reorder.make(options)`; `Reorder.isGroup`. The value holds what `makeReorderGroup` closed over: its options, the sources by value, the one gesture, and the direction's points. The module's operations alone change them.
- **The operations, the group first:**
  - `register(group, value, source)` still returns its remover;
  - `dragStart`, `dragMove`, `dragEnd` and `move` are `dual`;
  - `resolveAxis(group)` takes nothing besides, so it isn't.

  Their bodies are the methods', unchanged, so the Crossover, the axis, Auto-scroll and every reorder log are too. They run per input event, not per frame, so there's no bench run. dom calls the data-first forms, which allocate nothing.
- **The names drop their repeat,** per #95's rule: `Reorder.Group`, `Reorder.GroupOptions`, `Reorder.ItemSource`.
- **The call sites:**
  - dom's reorder controller makes six calls;
  - dom's inert server controller now holds a real group with no values, so every operation on it finds nothing to do, where its literal's methods each did nothing;
  - solid's ward's `move` calls `Reorder.move`.
- **solid's `use:reorderItem` changes its group's type.** It typed the group as `ReorderGroupWard<never>`, which accepted any group only because the old group's value type appeared in parameters alone. An invariant `Group` ends that, so the directive now takes what an item reads: its controller's `item` and the group's `axis`, as `ItemGroup<never>`. Every group satisfies it, so the directive accepts the same groups as before.
- **Tests:**
  - `reorder-group.test.ts` calls the operations, and pins the data type: `@ts-expect-error` on an object literal as a `Group`, `isGroup` (false for a spread), both forms of each `dual` operation giving one type, `pipe`, and `toJSON`;
  - dom's controller test calls `Reorder.dragMove`;
  - the Reorder browser tests pass unchanged.

## Implementation in #97 (slice 4): `Values`' operations

- **`Values.split(values)`** returns `{ numbers, strings }`, a value-map's keys by kind: two `Rec.filter`s with the named `Predicate.isNumber` and `Predicate.isString`, where decision 12 suggested `Rec.partition`. Effect 4's `partition` takes a function returning a `Result`, not a predicate, and a key whose value is neither kind (an `undefined` at run time) should land in neither half, as presence's own loop skipped it. Two filters do both.
- **`Values.pick(self, keysFrom)`, `dual`:** the keys of `keysFrom` read out of `self` with `Rec.get`, own keys only, skipping a key `self` lacks or holds `undefined` for.
- **The call sites:** solid's spine calls `Values.split` where `splitTarget` was. Presence's exit calls `Values.split` for its target and its from-values and `Values.pick` for its strings' start, where its loop, `numericOf` and `pick` were. All three go.
- **They run when a leg is built,** at a Retarget, never per frame: the full Effect-first rules apply, and no bench run is needed.
- **Tests:** `packages/core/test/values.test.ts` covers numbers, strings, a mix, an empty map, an `undefined` value, a key missing from the source, and `pick`'s two forms. solid's spine and presence tests pass unchanged.
- **#93's slices have all landed but #91,** the combinator slice, which builds on the API rather than being part of it.


## Implementation in #91: `Machine.holdAfter`, with its first caller, `repeatDelay`

- **`Machine.holdAfter(seconds)`, `dual`,** as #91's grill decided. After `self` settles, its settled Frame is re-stamped `done: false` once. That object is returned on the tick `self` settles and on every held tick, until the held time reaches `seconds`; on that tick the hold settles with `self`'s own settled Frame.
  - The held time counts each tick at most `MAX_DT`, as `delay`'s does. It starts on the tick after `self` settles, so no leftover carries over, as at every seam.
  - `holdAfter(0)`, a negative hold, and a `self` that never settles return their input. The step allocates nothing per held tick.
- **`repeatDelay` joins `Modifiers`,** so solid's tween transition takes it as is. `animate` wraps every segment but the last in `holdAfter(repeatDelay)`, and an infinite `repeat` holds after every segment. With `yoyo`, each segment holds its own end value, its turning point. `delay` still holds once, before the first segment. `keyframes` has no `repeat`, so nothing changes there. `animate`'s span gains a `repeatDelay` attribute.
- **Motion's Frames,** checked against its source (motion-dom `animation/JSAnimation.ts:176-177`, `:257-306` at 16c61222c). `repeat-delay.test.ts` ports its iteration math, including `repeatType: "reverse"`'s fold of the gap into the odd iterations. Our Frames match it at 1/16 s ticks: `repeat`, `yoyo`, an infinite `repeat` with a `delay`, and a gap longer than a run. On ticks that don't divide the run, a seam can come a tick later than Motion's iteration boundary, as every seam can (ADR-0027, decision 4).
- **The hold as a layer, measured** against the same hold built into the tween's step (identical Frames on 1/16 s and uneven ticks; `bench:core --base <layer> --head <in the step>`, 11 paired reps, valid noise controls):

  | Workload | Bun | Node | Chromium |
  |---|---|---|---|
  | `animateRepeatDelay/loop` | −5.5% [−10.9, +1.5] | −2.1% [−5.5, −2.0] | −1.6% [−3.2, +0.0] |
  | `animateRepeatDelay` (Stream) | +1.9% | −0.9% | +0.5% |
  | `animateRepeat/loop` (identical code) | +2.0% | −3.0% [−4.0, −1.8] | +0.0% |

  The layer costs about 2% in V8, at the noise floor: `animateRepeat/loop` moved 3% in Node on identical code in the same run. It costs nothing on the Stream path. It's cheap where #94's `clampDt` layer wasn't because it wraps only the tween segments, and its held ticks skip the tween's math. The maintainer kept the combinator (2026-10-09).
- **The gate run** (`d184089`, `bench:core --base main`, 11 paired reps; noise controls Bun +2.3% then +0.2% on a Bun-only rerun, Node −0.7%, Chromium +0.9%). Main ignores `repeatDelay`, so its `animateRepeatDelay` runs without holds. Head / base, median [p25–p75]:

  | Workload | Bun (first) | Bun (rerun) | Node | Chromium | Node MB per frame |
  |---|---|---|---|---|---|
  | `springValues` | −0.3% [−1.4, +0.6] | +0.4% [−2.0, +1.8] | −1.1% [−1.5, −0.1] | +1.1% [−0.3, +1.7] | 4.95 → 4.95 |
  | `animateValues` | +0.1% [−4.7, +2.6] | +0.7% [−3.1, +1.4] | −0.3% [−0.9, −0.2] | +0.0% [−2.1, +0.3] | 4.76 → 4.76 |
  | `springBlend` | +0.5% [−3.1, +3.3] | −3.3% [−3.7, +1.4] | −0.6% [−3.9, +0.6] | −0.5% [−1.4, −0.2] | 5.07 → 5.11 |
  | `chase` | +2.7% [−6.3, +3.7] | +1.4% [−6.1, +7.9] | +0.1% [−2.7, +0.9] | −0.0% [−1.4, +1.0] | 4.13 → 4.13 |
  | `animateComplex` | +1.1% [−3.0, +1.4] | +2.1% [−3.3, +3.9] | +0.0% [−2.3, +0.2] | −0.2% [−3.7, +0.9] | 6.32 → 6.32 |
  | `animateRepeat` | +1.0% [−2.3, +2.4] | +0.5% [−4.6, +2.2] | +0.3% [−0.8, +0.5] | −0.8% [−1.8, +0.5] | 4.76 → 4.76 |
  | `animateRepeatDelay` | −0.3% [−1.4, +2.5] | +3.5% [−4.5, +4.8] | −2.4% [−4.5, −0.8] | −2.0% [−2.3, −1.6] | 4.76 → 4.65 |
  | `springValues/loop` | +7.3% [−1.6, +14.7] | −2.5% [−6.8, +11.6] | −0.1% [−0.6, +0.0] | −1.5% [−7.6, +10.9] | 0.92 → 0.92 |
  | `animateValues/loop` | +1.2% [−3.9, +2.8] | +1.2% [−4.2, +6.0] | −0.6% [−5.9, +1.2] | −2.2% [−6.3, +0.0] | 0.80 → 0.80 |
  | `springBlend/loop` | +0.5% [+0.1, +6.2] | +2.5% [−4.1, +3.5] | −0.1% [−2.7, +2.3] | −3.2% [−4.6, −1.6] | 1.12 → 1.12 |
  | `chase/loop` | +2.9% [−7.1, +6.8] | −3.3% [−9.7, +0.9] | −1.2% [−2.9, −0.4] | +0.0% [−10.0, +0.0] | 0.17 → 0.17 |
  | `animateComplex/loop` | −0.5% [−1.6, +1.7] | +0.1% [−0.9, +0.8] | +0.0% [−1.6, +0.8] | +1.7% [−2.4, +3.4] | 2.30 → 2.30 |
  | `animateRepeat/loop` | +6.7% [+1.1, +13.4], fails | +7.2% [+2.8, +9.4], fails | −1.1% [−2.4, +1.6] | +0.0% [−1.5, +2.9] | 0.80 → 0.80 |
  | `animateRepeatDelay/loop` | −3.5% [−5.7, −0.8] | −5.5% [−9.1, +0.4] | −8.9% [−9.5, −7.3] | −6.2% [−11.8, −6.0] | 0.80 → 0.70 |

  - **Node and Chromium pass every workload.** `animateRepeatDelay/loop` runs 6–9% faster than main's run of the same options without holds, and Node's bytes fall 0.80 → 0.70 MB: a held tick skips the tween's math and allocates nothing.
  - **Bun fails `animateRepeat/loop` twice, and that's declared** (the maintainer's call, 2026-10-09). That run's per-frame code is unchanged without a `repeatDelay`, since `holdAfter(0)` is its input. A Bun run with the two `animateRepeatDelay` workloads taken out of the harness passes it: +2.6% [−3.7, +5.8]. The cost comes from the bench's one process: once an `animateRepeatDelay` workload has run `holdAfter`'s step, JSC's shared `concatAll` and `forever` call sites see one more step type, and the plain repeat stack loses about 7%. It reaches only JSC (Bun, and Safari likely), only repeat animations, and only on a page that also uses `repeatDelay`. Building the hold into the tween's step would add a new step type at the same call sites (the layer-or-step run reads `animateRepeat/loop` level).
- **Tests:**
  - `repeat-delay.test.ts`, every Frame exact at 1/16 s ticks through both drivers: `repeat`, `yoyo`, `reverse`, an infinite `repeat` with and without `yoyo`, `delay` with `repeatDelay`, no repeat, `animateValues`, and the Frames against Motion's math;
  - `combinators.test.ts`: `holdAfter`'s hold, its one held Frame object, a stall counting at most `MAX_DT`, `concat` after it, and its defaults returning their input;
  - `machines.test.ts`: parity on the uneven dts;
  - `machine.test.ts`: both `dual` forms.
- **#93's slices have all landed.**

## Amendment (#111, 2026-10-11): a leaf may rewrite its Frame

ADR-0030's decision 11 changes decision 7's contract, items 2 and 4.

- **Item 2 holds for the combinators,** which still allocate only the Frame they return, and only when they change it. A leaf may now rewrite one Frame per run in place, as `springValues`' does. So a combinator that keeps a Frame across ticks keeps one its leaf no longer steps:
  - `concat`'s seam re-stamps the settled Frame, and the settled segment never steps again;
  - `holdAfter`'s held Frame is the settled one's re-stamp, after the last step;
  - `delay`'s held start Frame is the leaf's own, returned while nothing steps, and no longer returned once the first step after the hold rewrites it;
  - `map`'s function reads its tick's Frame;
  - `forever` restarts with a new run, which has its own Frame.

  `machines.test.ts` pins each over `springValues` against the same combinator over Frames that are fresh each tick.
- **Item 4 is done for `springValues`:** stepping in place came back from #83's part D measured (ADR-0030, decision 11), and the other leaves wait for a measurement that asks.
- **The contract a sink keeps,** in `pipeable.md` since ADR-0030's commit and now on `FrameLoop.Sink` and `Machine.run`: a Frame handed to a sink is the run's until the next tick, so a sink that keeps one copies it, and `run`'s settled Frame is stable. `Machine.toStream` copies a record Frame before it emits.

## Amendment (#109, 2026-10-11): `Clock.delay` goes

ADR-0030's decision 1 changes decision 12's services row.

- **`delay` → `Clock.delay` is gone,** with no alias. A run held in frame time is `Machine.run(b.pipe(Machine.delay(seconds)), sink)`: its sink gets its start value, `done: false`, through the hold.
- **The Clock's shape is `{ ticks, tick }`:** its `time` and `dt` Atoms went too (ADR-0030, decision 12), so `Clock.fromRefreshFrames` needs a `Scope` only.

## Amendment (#52, 2026-10-11): `RefreshFrameSource` is a service in its own module

ADR-0031's decision 2 changes decision 11's table, and #122 lands it.
- **`Clock.RefreshFrameSource` → `RefreshFrameSource.RefreshFrameSource`,** a `Context.Service` whose shape is the old interface, with `RefreshFrameSource.layer(source)`. No alias.
- **`Clock.layer`** builds the Clock from the member. `Clock.fromRefreshFrames(source)` stays.

## Amendment (#25, 2026-10-11): `Velocity.of` goes

#25 changes decision 12's `Velocity` row.

- **`velocityOf` → `Velocity.of` is gone,** with no alias, and its test (`util-effect.test.ts`) with it. Nothing outside that test called it: the reason decision 12's *Gone* gives, and ADR-0030's for `Clock.delay`. `pipeable.md`: a combinator needs a caller.
- **Why not reshaped:** it zipped its values with `Clock.ticks`, which cost 2 dispatcher tasks per element per frame and paired a value with an older tick's `dt` when the values skipped a tick (ADR-0017, *Amendment (#25)*). A shape with neither takes its values from the tick, through a per-tick read or a machine, and nothing called it to choose between them. A Physics primitive's velocity is already on its Frames (`Frame.Physics`). A `createVelocity`, the v0.1 plan's, chooses its shape when it's built.
- **`Velocity.between` stays,** a plain helper like `Scalar`'s and `Point`'s, on the per-frame path (`effect-first.md`). The module is `between`, `trailing` and `TimedPoint`.
