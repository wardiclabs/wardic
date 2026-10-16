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
5. **Pure helpers become `dual` functions over plain records** (Q5), as Effect's `Record` module does, read left to right on cold paths. For example, `mergeStyle` becomes `pipe(user, Style.over(animated), Style.over(defaults), Style.over(base))`. That's PR 3.
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
| `FlushGate` | `FlushGateRuntime` | `FlushGate.Runtime` |
| `ProjectionSystem` | `makeProjectionSystem` | `ProjectionSystem.make` |
| `ProjectionSystem` | `ProjectionSystem` | `ProjectionSystem.ProjectionSystem` |
| `ProjectionSystem` | `ProjectionSystemOptions` | `ProjectionSystem.Options` |
| `ProjectionSystem` | `ProjectionRuntime` | `ProjectionSystem.Runtime` |
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
| `ReorderController` | `makeReorderController` | `ReorderController.make` |
| `ReorderController` | `INERT_REORDER_CONTROLLER` | `ReorderController.inert` |
| `ReorderController` | `ReorderController` | `ReorderController.ReorderController` |
| `ReorderController` | `ReorderControllerOptions` | `ReorderController.Options` |
| `ReorderController` | `ReorderItemDriver` | `ReorderController.ItemDriver` |
| `ReorderController` | `DEFAULT_REORDER_INSTRUCTIONS` | `ReorderController.DEFAULT_INSTRUCTIONS` |
| `ReorderController` | `REORDER_GROUP_STYLE` | `ReorderController.GROUP_STYLE` |
| `Style` | `startingStyle` | `Style.starting` |
| `Style` | `resolveInitial` | `Style.resolveInitial` |
| `Style` | `InitialConfig` | `Style.InitialConfig` |
| `Style` | `toValues` | `Style.toValues` |
| `Style` | `mergeStyle` | `Style.merge` |
| `Style` | `fallbackStyle` | `Style.fallback` |
| `Style` | `heldTouches` | `Style.heldTouches` |
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

## Implementation in #132's PR 1: modules and the root

- **The moves:**
  - 25 implementation files moved to `packages/dom/src/internal/` unchanged, `culori.d.ts` with them;
  - 17 module files re-export their members;
  - the root became 17 namespaces plus `DomLive` and `VERSION`;
  - `package.json`'s `exports` gained `"./*"` and `"./internal/*": null`, as core's has.
- **The call sites** moved with a TypeScript-syntax-tree codemod. It rewrites only references to an imported binding, and a shorthand property becomes `key: Module.member`. One test's arrow parameter, `color`, shadowed the import and was restored by hand; a scan of every rewritten file found no other.
- **The lint exemption for the Clock's `requestAnimationFrame`** follows `clock.ts` into `internal/`.
- **Gates:** typecheck, lint, unit (920), browser (996), the lab's tsc and vitest (208), and the lab's drives.
