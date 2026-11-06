# dom's API

`@wardic/dom` gets the API pass core had in #93 (ADR-0028), for the binding authors who build on it (#132). It's a module per concept, imported as a namespace, and the root keeps what an app imports.
- **The DOM's implementations of core's services** take Effect's platform prefix and hold their Layer (`DomRenderer.layer`).
- **dom's own concepts** take the glossary's names (`FlushGate`, `ProjectionSystem`).
- **The gate and the projection system become services built by Layers** and ended by their Scope.
- **A server keeps cheap stand-ins:** values, plus a Layer for a binding whose server runs an Effect program.
- **Pure helpers become `dual` functions over plain records.**

It lands in three PRs, the shape first, and #69 then converts the internals inside it.

## Why

- **dom never had an API pass.** Its surface is what arrived over time:
  - the flush gate, moved from solid as it was (#123, ADR-0031);
  - the Starting-style helpers (ADR-0021);
  - the projection engine, the Reorder controller and the auto-scroller, each written as its feature landed.
- **On main `74fb80b`, the root had 90 flat named exports** for two audiences: `DomLive` and its Layers for an app, and factories, helpers and constants for a binding. About half were used by nothing outside dom.
- **Lifetime was by hand:**
  - the long-lived parts were factories over a `ManagedRuntime` with a manual `dispose`;
  - solid tore them down in order (`projection.dispose(); gate.dispose(); runtime.dispose()`);
  - that teardown had no test until #51's LZ4.
- **Pure helpers were positional,** up to four arguments (`mergeStyle(user, animated, defaults, base)`).

## Decisions (grilled 2026-10-16, all A)

1. **dom is for binding authors** (Q1): ADR-0008's Tier 2, Wardic's own bindings first. The bindings it serves from the start are:
   - **Foldkit:** an Effect-native framework on the Elm architecture, with no components or hooks, which uses Effect's services, Streams and scoped resources, and renders on a server and hydrates;
   - **Solid 1;**
   - **Solid 2.**

   Its public surface is what any binding needs, designed and documented as such. What only dom's own tests use is internal.
   - Rejected: Wardic's own bindings only, with everything else internal; an app-facing API, since apps use their binding.
2. **The gate and the projection system become services built by Layers** (Q2), each with a scoped `make`. That's PR 2.
   - **What they take:** what they need comes from the context (the Renderer, the Refresh frame source, the Frame loop), not a `ManagedRuntime` argument.
   - **Per-frame members stay plain functions** (ADR-0034, decision 2).
   - **Closing the Scope ends them,** the projection system before the gate.
   - **How each binding uses them:**
     - Solid's provider makes one runtime from `ProjectionSystem.layer(…)`, `FlushGate.layer(…)` and `env`, still built on first need (ADR-0021, *Amendment (#51)*).
     - A Foldkit binding provides the Layers in its program.
     - Solid 2's possible difference is only the gate's `batch` option (`(apply) => { apply(); flush() }`; `docs/plans/upgrade-targets.md`, ADR-0031).
   - Rejected: scoped constructors only, which leaves every Effect-native binding writing the same `Layer.effect`; keeping the factories.
3. **A server's stand-ins come in both forms** (Q3), named in their modules: values (`FlushGate.inert`, `ReorderController.inert`) and an inert Layer (`FlushGate.layerInert`).
   - **The values** serve a binding whose server builds no runtime: Solid's stays at ADR-0021's 0.92 µs.
   - **The Layer** serves a binding whose server runs an Effect program, such as Foldkit's.
   - **The projection system** has no inert form until a binding needs one.
   - Rejected: values only; Layers only, which would build a runtime per server render (against ADR-0021, decision 3).
4. **A module per concept, as core's rule has it** (Q4).
   - **Each module** is at `@wardic/dom/<Module>`.
   - **The root** re-exports each one as a namespace, and keeps `DomLive` and `VERSION` for an app.
   - **Repo code** imports the subpaths. `internal/` isn't exported (`package.json`), and lint holds both.
   - Rejected: subpaths only, with a bare root; regrouped files under a flat root.
5. **Pure helpers become `dual` functions over plain records** (Q5), as Effect's `Record` module does, read left to right on cold paths. For example, `mergeStyle(user, animated, defaults, base)` becomes `pipe(animated, Style.over(user), Style.over(base), Style.over(defaults))`, read from the top layer down. That's PR 3.
   - **Corrected in PR 3:** the example as first written, `pipe(user, Style.over(animated), Style.over(defaults), Style.over(base))`, listed the layers in `mergeStyle`'s argument order, not their precedence (defaults < base < user < animated), so it was wrong under either reading of `over`. PR 3's Q1 settled what `over` means (*Implementation in #132's PR 3*).
   - **No wrapper type:** a style stays a plain object.
   - **Per-frame helpers stay positional,** such as `project` and the SVG split inside a flush.
   - Rejected: a `Pipeable` `Style` data type, which adds a wrapper and an unwrap at every binding edge; keeping them positional.
6. **Shape first, in three PRs, then #69** (Q6):
   1. modules and the root, as pure moves;
   2. the gate and the projection system as services built by Layers, with the inert forms and solid's provider on them;
   3. the `Style` helpers and the Reorder controller, with solid's call sites.

   Rejected: one PR; #132 and #69 in one pass.
7. **Names: Effect's platform convention, and the glossary's** (Q7).
   - **A module that implements a core service for the DOM** is `Dom`-prefixed and holds its Layer, as `@effect/platform-browser` has `BrowserRuntime`: `DomRenderer`, `DomInput`, `DomProbe`, `DomClock`, `DomAnnouncer`, `DomInterpolators`, `DomPositionalKeys` and `DomKeyRules`.
   - **dom's own concepts take the glossary's names:** `FlushGate`, `ProjectionSystem` (a new glossary term, replacing "projection engine"), `ReorderController`, `Style`, `Svg`, `Color`, `Variables`, `OwnValues` and `Report`.
   - **No dom module repeats a core module's name.** Core has `Renderer`, `Announcer`, `Projection`, `Reorder` and `AutoScroll`.
   - **Inside a module, a member drops the module's noun:** `makeFlushGate` becomes `FlushGate.make`, `INERT_GATE` becomes `FlushGate.inert`, and `startingStyle` becomes `Style.starting`.
   - Rejected: plain names with an alias at every clash; a `Dom` prefix on every module.
8. **Checks** (Q8).
   - **Every PR:** tests and lab drives.
   - **PR 2:**
     - Scope teardown (the projection system, then the gate), the inert forms, and one build per runtime;
     - mutations;
     - `bench:solid` and the page probes for the gate's flush and the projection pass, paired with an A/A.
   - **PR 3:** the `dual` helpers pinned equal to the positional ones over a table, written before those go.
   - **PR 1:** pure moves, with no performance checks.
9. **This ADR** (Q9). `docs/agents/pipeable.md` has a dom section, and ADR-0008, ADR-0021, ADR-0031 and ADR-0034 point here. Each PR adds an *Implementation in* section.

Defaults stated, not asked:
- the gate's `batch` is an option of `FlushGate.layer` (decision 2);
- an element's sink hooks stay arguments to `register`.

## The export table

Every root name on `74fb80b` and its home now:
- **Four names in it weren't root names before:** `DomInput.keyOf`, `kindOf`, `buttonOf` and `toPointer`, dom's mappings, now public for a DOM-based Environment.
- **`measureLayoutBox`** moved from the root into `ProjectionSystem`.
- **The auto-scroller, the scale correctors, the complex codec and `dashCase`** are internal: no binding used them.

| Module | Was (root name) | Now |
|---|---|---|
| `DomClock` | `ClockDomLive` | `DomClock.layer` |
| `DomInput` | `InputDomLive` | `DomInput.layer` |
| `DomInput` | `keyOf` | `DomInput.keyOf` |
| `DomInput` | `kindOf` | `DomInput.kindOf` |
| `DomInput` | `buttonOf` | `DomInput.buttonOf` |
| `DomInput` | `toPointer` | `DomInput.toPointer` |
| `DomProbe` | `ProbeDomLive` | `DomProbe.layer` |
| `DomRenderer` | `RendererDomLive` | `DomRenderer.layer` |
| `DomRenderer` | `project` | `DomRenderer.project` |
| `DomRenderer` | `ownScaleOf` | `DomRenderer.ownScaleOf` |
| `DomRenderer` | `ownRotateOf` | `DomRenderer.ownRotateOf` |
| `DomRenderer` | `ownOpacityOf` | `DomRenderer.ownOpacityOf` |
| `DomAnnouncer` | `AnnouncerDomLive` | `DomAnnouncer.layer` |
| `DomAnnouncer` | `ANNOUNCER_ATTRIBUTE` | `DomAnnouncer.ATTRIBUTE` |
| `DomAnnouncer` | `documentOf` | `DomAnnouncer.documentOf` |
| `DomAnnouncer` | `instructionsId` | `DomAnnouncer.instructionsId` |
| `DomAnnouncer` | `prepareAnnouncer` | `DomAnnouncer.prepare` |
| `DomAnnouncer` | `announceIn` | `DomAnnouncer.announceIn` |
| `DomInterpolators` | `InterpolatorRegistryDomLive` | `DomInterpolators.layer` |
| `DomInterpolators` | `interpolators` | `DomInterpolators.all` |
| `DomPositionalKeys` | `PositionalKeysDomLive` | `DomPositionalKeys.layer` |
| `DomPositionalKeys` | `isPositional` | `DomPositionalKeys.isPositional` |
| `DomKeyRules` | `keyRules` | `DomKeyRules.all` |
| `DomKeyRules` | `visibility` | `DomKeyRules.visibility` |
| `DomKeyRules` | `animatableNone` | `DomKeyRules.animatableNone` |
| `FlushGate` | `makeFlushGate` | `FlushGate.make` |
| `FlushGate` | `INERT_GATE` | `FlushGate.inert` |
| `FlushGate` | `FlushGate` | `FlushGate.FlushGate` |
| `FlushGate` | `FlushSink` | `FlushGate.Sink` |
| `FlushGate` | `FlushGateOptions` | `FlushGate.Options` |
| `FlushGate` | `FlushGateRuntime` | none since PR 2: the gate takes `FlushGate.Services` from its context |
| `ProjectionSystem` | `makeProjectionSystem` | `ProjectionSystem.make` |
| `ProjectionSystem` | `ProjectionSystem` | `ProjectionSystem.ProjectionSystem` |
| `ProjectionSystem` | `ProjectionSystemOptions` | `ProjectionSystem.Options` |
| `ProjectionSystem` | `ProjectionRuntime` | none since PR 2: the engine takes `ProjectionSystem.Services` from its context |
| `ProjectionSystem` | `ProjectionSink` | `ProjectionSystem.Sink` |
| `ProjectionSystem` | `RegisterNodeOptions` | `ProjectionSystem.RegisterNodeOptions` |
| `ProjectionSystem` | `ProjectionNodeHandle` | `ProjectionSystem.NodeHandle` |
| `ProjectionSystem` | `DragProjectionHandle` | `ProjectionSystem.DragHandle` |
| `ProjectionSystem` | `AnimateLayoutOptions` | `ProjectionSystem.AnimateLayoutOptions` |
| `ProjectionSystem` | `LayoutTransition` | `ProjectionSystem.LayoutTransition` |
| `ProjectionSystem` | `DragTransition` | `ProjectionSystem.DragTransition` |
| `ProjectionSystem` | `DEFAULT_LAYOUT_TRANSITION` | `ProjectionSystem.DEFAULT_LAYOUT_TRANSITION` |
| `ProjectionSystem` | `DEFAULT_DRAG_TRANSITION` | `ProjectionSystem.DEFAULT_DRAG_TRANSITION` |
| `ProjectionSystem` | `measureLayoutBox` | `ProjectionSystem.measureLayoutBox` |
| `ReorderController` | `makeReorderController` | `ReorderController.make`, a scoped constructor since PR 3 |
| `ReorderController` | `INERT_REORDER_CONTROLLER` | `ReorderController.inert` |
| `ReorderController` | `ReorderController` | `ReorderController.ReorderController` |
| `ReorderController` | `ReorderControllerOptions` | `ReorderController.Options`, without `runtime`, `projection` and `announce` since PR 3 |
| `ReorderController` | `ReorderItemDriver` | `ReorderController.ItemDriver` |
| `ReorderController` | `DEFAULT_REORDER_INSTRUCTIONS` | `ReorderController.DEFAULT_INSTRUCTIONS` |
| `ReorderController` | `REORDER_GROUP_STYLE` | `ReorderController.GROUP_STYLE` |
| `Style` | `startingStyle` | `Style.starting` |
| `Style` | `resolveInitial` | `Style.resolveInitial` |
| `Style` | `InitialConfig` | `Style.InitialConfig` |
| `Style` | `toValues` | `Style.toValues` |
| `Style` | `mergeStyle` | `Style.over` since PR 3: `pipe(animated, Style.over(user), Style.over(base), Style.over(defaults))` |
| `Style` | `fallbackStyle` | `Style.over` and `Style.without` since PR 3: `pipe(user, Style.over(base), Style.over(defaults), Style.without(held))` |
| `Style` | `heldTouches` | `Style.heldTouches`, the style first since PR 3 |
| `Style` | `dragDefaultStyle` | `Style.dragDefaults` |
| `Style` | `DragDefaultStyle` | `Style.DragDefaults` |
| `Style` | `DRAG_DEFAULT_ATTRIBUTES` | `Style.DRAG_DEFAULT_ATTRIBUTES` |
| `Style` | `reorderTouchAction` | `Style.reorderTouchAction` |
| `Svg` | `isSvgRoot` | `Svg.isRoot` |
| `Svg` | `isSvgInner` | `Svg.isInner` |
| `Svg` | `isSvgInnerTag` | `Svg.isInnerTag` |
| `Svg` | `setSvgAttrs` | `Svg.setAttrs` |
| `Svg` | `splitPatch` | `Svg.splitPatch` |
| `Svg` | `splitPatchForTag` | `Svg.splitPatchForTag` |
| `Svg` | `SplitPatch` | `Svg.SplitPatch` |
| `Color` | `color` | `Color.interpolator` |
| `Color` | `cssColor` | `Color.css` |
| `Color` | `Color` | `Color.Color` |
| `Color` | `ColorString` | `Color.FromString` |
| `Color` | `COLOR_TOKEN` | `Color.TOKEN` |
| `Variables` | `isVariableValue` | `Variables.isValue` |
| `Variables` | `resolveVariable` | `Variables.resolve` |
| `Variables` | `variableValues` | `Variables.values` |
| `OwnValues` | `ownValues` | `OwnValues.of` |
| `OwnValues` | `styleValueOf` | `OwnValues.styleValueOf` |
| `OwnValues` | `valueLike` | `OwnValues.valueLike` |
| `OwnValues` | `OwnValue` | `OwnValues.OwnValue` |
| `Report` | `reportFailure` | `Report.failure` |
| internal | `cssComplex` | `internal/complex.ts` |
| internal | `VARIABLE_REFERENCE` | `internal/complex.ts` |
| internal | `borderRadiusCorrector` | `internal/scale-correction.ts` |
| internal | `boxShadowCorrector` | `internal/scale-correction.ts` |
| internal | `ScaleCorrector` | `internal/scale-correction.ts` |
| internal | `SCALE_CORRECTORS` | `internal/scale-correction.ts` |
| internal | `dashCase` | `internal/svg.ts` |
| internal | `makeAutoScroller` | `internal/auto-scroll.ts` |
| internal | `AutoScroller` | `internal/auto-scroll.ts` |
| root | `DomLive`, `VERSION` | `DomLive`, `VERSION` (unchanged) |

## Consequences

- **Nothing changes in behaviour,** and dom's own code is the same. The implementations moved to `src/internal/`, and each module re-exports its members under module-relative names. PR 2 and PR 3 restructure what's behind the gate's, the projection system's, the Style's and the Reorder controller's modules.
- **Solid, the lab, `@wardic/test` and dom's tests import the subpaths,** as `import * as FlushGate from "@wardic/dom/FlushGate"`, and dom's tests reach `internal/` relatively. Solid's own public API keeps its names (`FlushGate`, `FlushSink`, `measureLayoutBox`), re-exported from the new subpaths: renaming it is #193's.
- **Lint** (`SUBPATHS` in `eslint.config.js`) rejects a non-root name or a namespace imported from `@wardic/dom` itself, and any import of `@wardic/dom/internal/…`.
- **The glossary** has **Projection system**, which replaces "projection engine".
- **A missing value at dom's surface is an `Option`,** in its returns and in the callbacks a binding passes in, as core's is (ADR-0025, *Amendment (#69)*, decision 1).

## Implementation in #132's PR 1: modules and the root

- **The moves:**
  - 25 implementation files moved to `packages/dom/src/internal/` unchanged, `culori.d.ts` with them;
  - 17 module files re-export their members;
  - the root became 17 namespaces plus `DomLive` and `VERSION`;
  - `package.json`'s `exports` gained `"./*"` and `"./internal/*": null`, as core's has.
- **The call sites** moved with a TypeScript-syntax-tree codemod. It rewrites only references to an imported binding, and a shorthand property becomes `key: Module.member`. One test's arrow parameter, `color`, shadowed the import and was restored by hand; a scan of every rewritten file found no other.
- **The lint exemption for the Clock's `requestAnimationFrame`** follows `clock.ts` into `internal/`.
- **Gates:** typecheck, lint, unit (920), browser (996), the lab's tsc and vitest (208), and the lab's drives.

## Implementation in #132's PR 2: the gate and the projection system as services

- **`@wardic/dom/FlushGate`:**
  - **The service:** `FlushGate` (a `Context.Service` keyed `@wardic/dom/FlushGate`) with its `Shape`, the gate without `dispose`.
  - **`make(options)`:** an `Effect<Shape, never, Services | Scope>`.
  - **`layer(options)`** wraps `make`.
  - **`inert` and `layerInert`.**
  - **`Sink`, `Options` and `Services`.**
- **`@wardic/dom/ProjectionSystem`:**
  - **The service:** `ProjectionSystem` with its `Shape`.
  - **`make(sink, options)`:** over any sink, so a binding, or a test, can hand it its own.
  - **`layer(options)`:** takes the Environment's `FlushGate` as its sink. Built after the gate, it ends before it.
- **The internals keep their factories** (`internal/gate.ts`' `makeFlushGate`, `internal/projection.ts`' `makeProjectionSystem`), now over a two-method runtime, `{ runSync, runFork }`, in place of a `ManagedRuntime` type. `make` builds that runtime from its Layer's context:
  - `Effect.runSyncWith(context)`;
  - a fork into a `FiberSet` in the Scope, so its forks end with the Scope, as a `ManagedRuntime`'s ended with its `dispose` (`makeRunner`, below);
  - and it registers the factory's `dispose` as the Scope's finalizer.

  dom's own tests build the engine and the gate with the factories, on a test `ManagedRuntime`, as before.
- **The runner drops the building call's scheduler** (`internal/runner.ts`, found through DR1 in CI; since #208, only a sync one: *Amendment (#208)*). A binding's first read builds the Layers inside a `ManagedRuntime.runSync`, whose fiber carries a sync `MixedScheduler`. The first draft captured the build's context, scheduler and all, through `FiberSet.makeRuntime`, so every later fork by the gate and the engine resumed its yields on a microtask, where a `ManagedRuntime`'s forks resume on a macrotask (ADR-0027, decision 6).
  - **`Context.omit(Scheduler.Scheduler)` alone wasn't enough:** `FiberSet.runtime` reads `Effect.context()` again in the current fiber, and `Effect.provideContext` merges into that context instead of replacing it.
  - **The fix:** `makeRunner` forks with the trimmed context itself (`Effect.runForkWith`) and adds each fiber to a `FiberSet` in the Layer's Scope.
  - **Pinned by** `test/runner.node.test.ts`:
    - RN1: built inside a `runSync`, a fork resumes on a macrotask; it fails on the first draft;
    - RN2: a fork still running when the Scope closes is interrupted.
- **`make` returns the factory's object, not a copy.** The engine's `onPassEnd` keys its listeners on the system object in a WeakMap. A first draft returned `{ ...system }` without `dispose`, which would have silently dropped the Reorder controller's pass-end hook. The type check that caught it (`onPassEnd` wanted the full type) is why `make` returns the object itself, typed as the `Shape`. Mutation M8 pins it (KB9, RO15).
- **Solid's provider** makes one runtime from `ProjectionSystem.layer(…)`, `FlushGate.layer({ batch })` and `env`.
  - **The first context read builds it** (ADR-0021, *Amendment (#51)*): `runtime.runSync(FlushGate.FlushGate)` builds the Environment, the gate and the engine together.
  - **Unmount is `runtime.dispose()` alone,** whose Scope ends the engine, then the gate.
  - **The engine's `reducedMotion` option** reads the provider's built inputs, which exist before any layout animation starts.
  - **The server keeps `FlushGate.inert`.**
- **The types:** solid's public `FlushGate` type is `FlushGate.Shape`, re-exported under its old name (#193 renames solid's API). The Reorder controller's `projection` option and `onPassEnd` take the `Shape`.
- **Checks:**
  - **New tests, `services.browser.test.ts` DS1–DS4,** on the real `DomLive`:
    - one runtime builds each once, and the engine writes through that gate;
    - closing the Scope ends the engine (its `resize` listener goes) before the gate (its pending frame is cancelled), and nothing is written after;
    - `make` over a binding's own sink ends with its own Scope;
    - `inert` and `layerInert`.
  - **The existing tests** pass unchanged, LZ1–LZ4 included. SV13 calls `release` on the inert gate in place of the gone `dispose`.
  - **Mutations:** 8, of which 6 are caught: either Scope finalizer gone, `layerInert` a different object, the provider's teardown gone, the engine on the inert gate, and a copied system (M8).
  - **Two survive at the module level:** forking outside the Scope's `FiberSet` (M3, M4). The engine ends its long-lived fibers (its end-of-task holds, the coordinator) through its own internal Scope anyway. The runner's own test, RN2, now pins what the `FiberSet` adds: a fork still running ends with the Scope.
  - **`bench:solid`** (11 paired reps against `272f427`): mount +1.7%, mid-flight Retarget +2.0%, at rest −1.3%, unmount −1.7%. The control read +4.3%. Exit 0.
  - **The gate's flush, per Refresh frame** (`.tmp/132-flush`, #79's probe ported). The whole frame's JS, flush included, against main, with main against itself as the A/A, 11 reps. Every difference is within the A/A's spread:

    | Workload | Change | A/A |
    |---|---|---|
    | transform | −2.1% | −1.0% |
    | mixed | 0.0% | +0.4% |
    | flip | +2.6% | 0.0% [−4.8, +8.9] |
    | styled | +3.3% | +2.6% |
    | partial | −0.3% | +0.3% |

    The probe's flush-only rows read 0 on all three variants: since ADR-0033 the gate flushes inside the tick and calls `batch` only for Starting-style switches, which the probe's `batch` wrapper no longer sees.
  - **The projection pass, per frame** (`.tmp/132-proj`, #27's probe ported). The median rAF ms at 1,000 nodes, 9 reps, against main, with main against itself as the A/A. Every change is within the A/A's spread:

    | Workload | main | A/A | This PR |
    |---|---|---|---|
    | glued | 1.11 ms | 1.08 (−3%) | 1.07 (−4%) |
    | delay | 1.73 | 1.72 (−1%) | 1.68 (−3%) |
    | flip | 1.77 | 1.73 (−2%) | 1.71 (−3%) |
    | scaled | 2.33 | 2.20 (−5%) | 2.23 (−4%) |

    The per-frame members are the same plain functions, so this is what was expected.

## Implementation in #132's PR 3: Style's `dual` helpers and the Reorder controller

Grilled 2026-10-16, both A.

**Q1. What `Style.over` means, and which helpers are `dual`.**
- **`Style.over(self, that)` lays `self` over `that`:** `self`'s keys win and `that`'s others stay. A chain reads from the top layer down:
  - before the first commit, `pipe(starting, Style.over(user), Style.over(base), Style.over(defaults))` (was `mergeStyle(user, starting, defaults, base)`);
  - after it, `pipe(user, Style.over(base), Style.over(defaults), Style.without(held))` (was `fallbackStyle(user, held, defaults, base)`).
- **Its inputs:** a side given as CSS text is parsed. A side that's `undefined` leaves the other as it is, the same object, which was `mergeStyle`'s fast path.
- **The `user-select` pairing moved into `over`:** whatever `self` sets for `user-select` or `-webkit-user-select` it sets for both, whenever there's a `that` to override (one property in Chromium). That's where `mergeStyle` applied it, so the result is key for key what `mergeStyle` gave, in the same key order.
- **`Style.without(self, held)`** drops the keys the flush gate holds, matched by CSS property.
- **`Style.heldTouches` takes the style first:** `pipe(style, Style.heldTouches(prev, next))`.
- **Types:** `Style.Input` (a record, CSS text or nothing) and `Style.Style` (a record).
- **The constructors keep their shape:** `starting(tag, values)`, `toValues`, `resolveInitial`, `dragDefaults` and `reorderTouchAction`. Like Effect's `Record.fromEntries`, they make a record rather than transform one, and `starting`'s optional tag would leave `dual` unable to tell its two forms apart by argument count.
- **Solid's Reorder group** lays the user's style over `ReorderController.GROUP_STYLE` with `over`, where it spread the two.
- Rejected: `Style.under`, read from the bottom layer up; `dual` constructors.

**Q2. The Reorder controller is a scoped constructor**, like `FlushGate.make`:
```ts
ReorderController.make(options): Effect<ReorderController<V>, never, ProjectionSystem | Announcer | Scope>
```
- **It takes what it needs from its context:** the projection system and the Environment's `Announcer`. The `runtime`, `projection` and `announce` options are gone.
- **Its logs** (`wardic.reorder:`) go through the context's Logger, forked into its Scope by dom's runner (`internal/runner.ts`, PR 2's).
- **Closing its Scope ends it:** it stops listening to Measure passes, resets its Auto-scroll and clears a pending announcement. `dispose` is gone from `ReorderController.ReorderController<V>`.
- **No Layer:** there's one per group, not one per Environment.
- **Its items' drivers stay plain,** each with its own `dispose`, as the gate's `register` returns its unregister: there's one per element, on the mount path.
- **`inert` stays a value** for a server render.
- **Each binding:**
  - Solid's `<Reorder>` builds it in a Scope of its own and closes it on cleanup. The provider's runtime is typed by the app's Environment, without the projection system, so the group provides the one it reads from context (`useWardicProjection()`) with `Effect.provideService`.
  - A Foldkit binding would run it in a Mount action's Scope.
- **The internals keep their factory** (`internal/reorder.ts`' `makeReorderController(wiring, options)`), with what the controller runs on (its runner, the projection system, `announce`) apart from what a binding hands its group. dom's RC tests drive the factory.
- Rejected: a plain factory minus `runtime`, with a `log` hook and `dispose`; leaving it as PR 1 left it.

**Checks:**
- **The table** (`test/style-dual.node.test.ts`, SD1–SD5): 19 merges, 11 fallbacks and 9 held checks. Each case's result was recorded from `mergeStyle`, `fallbackStyle` and the positional `heldTouches` on main `4c22cfb`, key for key and in key order. The first commit (`cb40fd0`) checked old and new against it; the next removed the old.
- **New tests:**
  - `services.browser.test.ts` DS5–DS7, on the real `DomLive`:
    - DS5: `make` speaks a move through the context's Announcer and logs an axis change through its Logger;
    - DS6: closing its Scope ends it, with no axis reported or logged after;
    - DS7: `inert` does nothing.
  - solid's `element-style.browser.test.tsx` ES1–ES3, a Reorder item's layering:
    - ES1: before the first commit, the user's `touch-action` over the base's, the base's over the drag defaults';
    - ES2: after it, the fallback without the held keys and the Starting style;
    - ES3: a held-keys change re-runs `style` when it touches a key the base or the defaults set, not only the user's.
  - KB11: a group unmounted while a held arrow's last place waits to be spoken never speaks it.
- **Mutations:** 12. The first run caught 9, and the three survivors were in solid: the base laid over the user's style before the first commit, the held check without the base, and a group whose Scope never closes. ES1, ES3 and KB11 catch them, so all 12 are caught.
- **`bench:solid`** against main `4c22cfb`, 11 paired reps, warm medians [p25 – p75]. It passes its gate on every run. Unmount reads 2–3% slower, though, while main against itself reads −0.7%:

  | Run | mount | Retarget | at rest | unmount | control |
  |---|---|---|---|---|---|
  | main against main (A/A) | +1.4% | +0.7% | | −0.7% [−3.1, −0.6] | +0.3% |
  | this PR | +1.3% | +0.5% | −0.6% | +2.6% [+0.9, +5.0] | |
  | this PR, again | +0.9% | +0.6% | | +2.3% [+1.0, +2.7] | +1.7% |
  | `cb40fd0` (helpers added, call sites not switched) | +1.8% | +1.9% | −0.4% | −1.0% [−3.3, −0.3] | too noisy |
  | `edd6667` (solid's call sites on `over` / `without`) | +0.2% | −0.5% | −4.0% | +4.2% [+1.7, +5.4] | too noisy |
  | `a6f5cdd` (the controller) | +0.4% | −0.7% | +1.9% | +2.5% [+2.1, +2.6] | +2.2% |

  - **The cause isn't found.** The unmount difference arrives with the call-site switch (`edd6667`), but none of what that changes runs during an unmount: the client's `over` / `without` run at render and at the first commit, and an instrumented run counted 0 `onHeld` calls in a 1,000-element unmount (1,000 in the first frames, where the gate first holds each element's keys).
  - **The new held check is slower per call:** 120 ns against the positional one's 54 ns (`.tmp/132-pr3/held-micro.ts`), about 66 µs across 1,000 elements' first commits, in frames `bench:solid` doesn't time.
  - **A variant of `over` with statement `if`s** in place of `UndefinedOr.match` and `Match` read unmount +0.5% [−11.9, +1.5] and then +1.9% [+0.2, +3.4]. That's no clear fix, so the rules' form stays.
  - About 0.5 ms across 1,000 elements' unmount, 0.5 µs each, within the gate.
- **A Reorder group's mount and unmount** (`.tmp/132-reorder`, `bench:solid`'s runner over 200 `Reorder.Group`s of two items each, 11 paired reps): mount +1.4% [−0.5, +4.7], about 7 µs a group at the median, the Scope and the `runSync`s; unmount −1.2% [−2.9, −0.3]. The control read −0.5%.
- **Lab** (5173, restarted on this branch):
  - smoke 0 errors;
  - crossfade board 54 runs, 0 fails;
  - held 30 runs, 0 off;
  - scenario 15's gestures clean;
  - scenario 7 `passes 1 (1 seeding)`;
  - scenario 17 clean;
  - keyboard reorder announced;
  - real-mouse drags 0.00 px, 0 frames behind.
- **Gates:** typecheck, lint, unit (963), browser (1007), the lab's tsc and vitest (208).

## Amendment (#208, 2026-10-17): the runner keeps a host's async scheduler

The runner dropped every `Scheduler` from the context a service's Layer was built in. That was aimed at `ManagedRuntime.runSync`'s sync `MixedScheduler`, but it also dropped one a host installs on purpose. Foldkit (`foldkit@0.168.0`) runs its program under `new Scheduler.MixedScheduler("async", microtaskSetImmediate)`, to avoid `setTimeout`'s 4 ms clamp on fiber yields. A Foldkit binding hands Wardic's Layers to Foldkit's `resources`, where they're built under that scheduler. Wardic's forks would then have resumed their yields on Effect's default `setTimeout`, beside Foldkit's own fibers on microtasks.

Grilled 2026-10-17 (A, A):
- **The runner drops only a sync scheduler.** The `Scheduler` interface exposes `executionMode`:
  - **A `"sync"` one is `runSync`'s draining scheduler,** and is dropped as before (RN1).
  - **Any other is the host's choice,** and Wardic's forks inherit it, as ADR-0027 decision 6 says a fork inherits the scheduler it's forked under.
  - **With none stored,** the context already has Effect's default.
  - **A host that provides a sync scheduler is overridden too.** A sync scheduler exists to drain a `runSync`, and the runner's JSDoc says so.
  - Rejected:
    - a `scheduler` option on `FlushGate.layer` / `ProjectionSystem.layer`: new Tier 2 surface, which every binding author would have to know to pass;
    - dropping all of them, written down as the rule.
- **Recorded as this amendment.**

Solid's provider installs no scheduler, so Solid's apps, `bench:solid` and the lab run as before. Solid's `onBrowserScheduler` tests provide a `setTimeout(0)` async scheduler, and now their gate's and projection system's forks follow it too, as those tests intend.

**Pinned by** `test/runner.node.test.ts`:
- RN3: built under a host's async scheduler, a microtask `MixedScheduler` provided as a Layer, a fork resumes from a yield on that scheduler. It fails on the old rule.
- RN4: a host's sync scheduler is dropped like `runSync`'s, so a fork resumes on Effect's default. It fails with no drop at all, as RN1 does.

## Amendment (#37, 2026-10-17): the Shared source helpers move to core

dom's `internal/shared.ts` held the two helpers an Environment meets CONTEXT.md's **Shared source** contract with: `makeSharedByTarget` (`RcMap`) and `makeSharedGlobal` (`RcRef`). Nothing in them is DOM-specific, and any Environment must meet the contract, so a native or canvas one would have written them again. #31's rule is that Wardic ships what makes a new Environment little work, the rule that put `InputSource.heldPointer` in core (ADR-0019).

Grilled 2026-10-17 (A, A, A, A):
- **A module, `@wardic/core/SharedSource`,** Tier 2 for Environment authors (ADR-0008), named after the glossary's term:
  - `makeSharedByTarget(lookup, options)` → `SharedSource.byTarget(lookup, options)`;
  - `SharedOptions` → `SharedSource.Options`;
  - `TargetKey`, the identity key, stays private;
  - the spans and logs follow the module: `wardic.dom.shared.*` → `wardic.sharedSource.*`.

  dom's `internal/input.ts` and `internal/probe.ts` build on it, and `internal/shared.ts` is gone.
  - Rejected:
    - a function inside `InputSource` (Probe's observers use it too);
    - a module named for the mechanism.
- **The keyless helper stays,** as `SharedSource.make(acquire, options)`. It mirrors `RcRef.make` beside `RcMap.make`, for a page-wide feed. It had no production caller, but the window's resize, which #45 is about, is the kind of source it's for.
  - Rejected:
    - dropping it, since `byTarget` with a fixed key does the same;
    - `SharedSource.global`.
- **Core's tests are on the node tier; dom keeps one browser test.**
  - `packages/core/test/shared-source.test.ts` holds SS1–SS8:
    - the seven from dom's old `shared.browser.test.ts`, keyed by plain objects;
    - SS2, new: a key Effect's structural `Hash` throws on (a throwing getter) is keyed by identity, so the lookup runs. It fails when `byTarget` keys a target as it is.
  - dom's `shared-source.browser.test.ts` keeps SSD1, the lone first subscriber keyed by a real DOM element.
  - Rejected:
    - all of them on dom's browser tier;
    - dropping the DOM-element test.
- **Recorded as this amendment,** with a line in the glossary's Shared source entry.

## Amendment (#384, 2026-10-28): the projection system is an `Inspectable`, its tree as plain data

#384 gives the layout lab a picture of the projection tree. The engine holds its nodes in its own scope, so it has to hand them out. Grilled 2026-10-28, Q1–Q4 each A.

- **Q1: `toJSON()` on the service.** `ProjectionSystem`'s service implements Effect's `Inspectable`, as core's Reorder group does.
  - **What it gives:** `toJSON()` returns `ProjectionSystem.Snapshot`, `{ _id: "ProjectionSystem", nodes }`, in registration order. Each `NodeSnapshot` has:
    - its id and tag, and its `layoutId`;
    - its parent's id, by the last Measure pass's DOM ancestry;
    - `layoutRoot`;
    - its twin's part, Lead or Follower, and a Follower's Lead's id;
    - whether it's animating, dragging, releasing or leaving.
  - **What it doesn't:** it holds no element and no box, so it serializes as written, and `console.log(system)` shows it.
  - **A diagnostic read:** it changes nothing. It doesn't rebuild the depth order (#383); it walks the node set.
  - **Cost:** +466 bytes minified and +138 bytes gzipped, measured for an app that imports `DomLive` and `ProjectionSystem.layer` (112,630 → 112,768 bytes gzipped, Effect included).
  - **Rejected:** B, a named `snapshot()` method; C, lab-only access to `internal/`.
- **Effect's `Graph` stays out of the library (#377):** `toJSON()` gives data, and the lab builds the `Graph`.
- **How the lab reaches it:** through the binding's existing `useWardicRuntime()`, read with a cast. The provider's runtime is built with the engine over the Environment, and `WardicRuntime`'s type lists the Environment's services only. Neither binding gained API.
  - The issue's plan was a capture Layer in the lab's Environment. It can't see the engine, which the binding builds on top of that Environment.
- **The lab's side (Q2–Q4)** is in its README, *Projection tree*:
  - it records a snapshot after each painted frame while Wardic's Clock runs, and draws only after a recording ends (Q2);
  - Mermaid is a lab-only dependency, loaded the first time the panel draws (Q3);
  - both lab builds have the panel (Q4).
- **Pinned:**
  - SN1–SN3 (`packages/dom/test/projection-snapshot.browser.test.ts`): the parents, tags, `layoutRoot`, a Lead and its Follower; the flags through a layout change, a drag and its release; `String(system)`;
  - TR1–TR4 (`examples/layout-lab/test/tree.test.ts`): the labels, the Mermaid text, the separate trees and what a recording changed, and the cycle check.

*Note (#511, 2026-11-01):* `Color.FromString`, a Schema codec, is `Color.parse` and `Color.format` now: Schema left Wardic's runtime (ADR-0067, decision 9; ADR-0026, *Amendment (#511)*).

## Amendment (#511, 2026-11-01): `DomLive` builds no `InputSource`

`DomLive` no longer merges `DomInput.layer`, and its type no longer lists `InputSource` (ADR-0067, decision 14). A binding's gesture Features build `DomInput.layer` with the first one an app uses, unless the Environment gives an `InputSource` of its own, as `@wardic/test`'s `TestLive` does. An app with no gesture ships no input code.

`DomInput.layer` itself is unchanged, and still `@wardic/dom/DomInput`'s. Code that runs core's recognizers straight on `DomLive` provides it beside: `Layer.merge(DomLive, DomInput.layer)`, as dom's own `dom-live` test now does.

## Amendment (#548, 2026-11-04): the projection engine is `DomProjectionSystem`'s

`ProjectionSystem.make` and `ProjectionSystem.layer` move to a new module, `@wardic/dom/DomProjectionSystem`, the name decision 5 gives the DOM's implementations. `ProjectionSystem` keeps the service key, its types, the default transitions and the measure helpers.

**Why:** every element's code reads the key, and with `make` beside it the projection engine was reachable from code every page runs, so it landed in the chunk every page loads once any page used `layout` (ADR-0067, *Amendment (#548)*). For the same reason:
- the default layout and drag transitions move from `internal/projection.ts` to `internal/projection-defaults.ts`;
- `scrollersOf` and the scroll-style reads move from `internal/measure.ts` to `internal/scrollers.ts`.

`ProjectionSystem` and `measure.ts` re-export them.

**Callers:** solid's `layout` Feature builds the engine with `DomProjectionSystem.make`. dom's services tests (DS1–DS3) use the new module.

## Amendment (#586, 2026-11-04): the root re-exports core's `CheckFrames` for an app

Decision 2's root keeps `DomLive` and `VERSION` for an app. An app turning on the dev check for non-finite Frames (`FrameLoop.CheckFrames`, ADR-0030 decision 7) had to import it from `@wardic/core`, which it doesn't install: the install line is `@wardic/solid @wardic/dom effect`, and a strict package manager won't resolve a package an app doesn't list. It was the only thing an app imported from core.

**Grilled on #586: re-export the reference.** The root re-exports core's `CheckFrames` itself, beside `DomLive`: `Layer.succeed(CheckFrames, true)` merged into `env`, as Effect's own references are set (`References.MinimumLogLevel`). Rejected: a ready Layer (`checkFrames`), a second name for the same thing and a new shape; and leaving it in core, with the Observability guide telling apps to install it.

Pinned by EX1 (`packages/dom/test/exports.node.test.ts`: the root's `CheckFrames` is core's) and by the Observability guide's recipe, typechecked in `error-reporting.browser.test.tsx` and in the site's samples. The site no longer lists `@wardic/core`.

## Amendment (#618, 2026-11-05): `DomProjectionSystem.make` gives a context

ADR-0020's *Amendment (#618)* moves the Reorder controller's pass-end hook into an internal service. `DomProjectionSystem.make` gives back a `Context` holding the engine as `ProjectionSystem` beside that `PassEnds`, and `layer` provides both (`Layer.effectContext`). The note above that `make` returns the factory's object itself, for the WeakMap's sake, no longer applies. `ReorderController.Services` names `PassEnds`; a binding builds a controller with the layout Feature's whole context (solid's `useLayoutServices`), not the engine alone.

*Note (#618, 2026-11-06):* `toJSON()`'s types are `ProjectionSystem.Tree` and `ProjectionSystem.TreeNode`, no longer `Snapshot` and `NodeSnapshot`. The glossary's **Snapshot** is a binding's seed of an element's values, so the tree took a name of its own (A3).

*Note (#618, 2026-11-06):* decision 7 listed `DomKeyRules` with the services' implementations that each hold a `layer`. It holds none: it's the DOM's Key rules, which `DomInterpolators.layer` installs and a hand-built registry takes (`InterpolatorRegistry.make(DomInterpolators.all, DomKeyRules.all)`). It keeps the `Dom` prefix as the DOM's own rules; dom's index and `pipeable.md` now say so (A3).
