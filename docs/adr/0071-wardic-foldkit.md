# `@wardic/foldkit`: a binding for Foldkit, on its public API, with the spine lifted into core

[Foldkit](https://www.npmjs.com/package/foldkit) is an Effect-native UI framework built on the Elm architecture: a Model, Messages, `update`, a view of `h` builders over a snabbdom fork, Commands, Mounts and Subscriptions. 1.2's milestone is a Wardic binding for it (#561).

**The grill read three things:**
- Foldkit 0.170.0's source;
- browser probes of its frame order, P1–P22 (Chromium 147, Firefox 148);
- its breaking "Blocks and Layers" preview (foldkit/foldkit#1655).

**The research is in four notes:**
- [`foldkit-binding.md`](../research/foldkit-binding.md): Foldkit, the frame order, Effect 4's rules, the API space, and Part G, the decisions round by round;
- [`foldkit-probes.md`](../research/foldkit-probes.md): the probes;
- [`foldkit-blocks-preview.md`](../research/foldkit-blocks-preview.md): the preview against every decision;
- [`foldkit-upstream-asks.md`](../research/foldkit-upstream-asks.md): drafts of the asks for Foldkit.

**What shaped the binding:**
- **A Mount can't reach `resources`.** A Mount's Stream is typed `R = never` and runs on the render's captured context, though Foldkit's docs say services "come from Foldkit `Resources`".
- **Foldkit has no hook for a re-render, a removal or a commit.** A Mount's args are captured at insert, removal is synchronous, and the patch runs inside Foldkit's own `requestAnimationFrame`.
- **Foldkit has no context,** so nothing passes down the tree implicitly.
- **The spine, presence, the variant tree and the Features live in `@wardic/solid`,** unexported, behind a `solid-js` peer.

## Decisions (grilled 2026-11-08 to 2026-11-09, #561)

### Scope

1. **Motion React parity** (R1 Q1), as 1.0 set for Solid. It's delivered in slices: elements and `animate`, then presence and layout, then the rest, with the storefront last (R8 Q34).
2. **Server rendering and hydration are in 1.2** (R1 Q2), Appear included (R2 Q4). Starting style alone would hold every element still until its script runs.
3. **Built on 0.170's public API** (R1 Q3, R8 Q37).
   - **Three pieces differ in the preview,** each behind one internal module (decision 31):
     - where elements get Wardic's services;
     - how Commands get them;
     - fusing the user's `OnMount`.
   - Rejected: targeting the preview now, a draft whose way of writing Blocks may change again (#1860), which can't be a published peer; Foldkit's internal hooks, which any 0.x minor may break.

### The lift (#672)

4. **The spine, the Flush gate and the Solid-free modules move out of `@wardic/solid`** (R2 Q5, R3 Q1), as ADR-0069 decision 2 decided, pulled forward from 1.5. Where each module goes (R6 Q21, R7 Q28):

   | Destination | Modules |
   |---|---|
   | core, `@wardic/core/unstable/<Module>` | spine, retarget-legs, variant-target, variant-tree, presence-record, live-style, imperative, animation-controls, frame-time, wardic-config-value; the `Reactivity` port; `Report`; the pure half of dom's `Style`; the Flush gate |
   | dom, `@wardic/dom/unstable/<Module>` | presence-controller, drag-track and its helpers (`drag-constraints`, `drag-controls`, `drag-transition`), feature and gesture-features, `instant`, `gesture-info`, `owner-scope` |
   | split | `config` (generic types to core, `WardConfig` to dom); `runtime` (`WardicServices` and the Runner to core, the `ManagedRuntime` provider stays in solid); `appear.ts` (its handoff to core, its server sampler to dom) |
   | stays in solid | `motion-props` |

   - Rejected: an interim lift into `@wardic/dom`, moving 3,400 lines twice.
5. **`unstable/` subpaths** (R3 Q2, R6 Q21): public, with no semver promise. ADR-0008 already allows the subpath. Wardic's own packages always match, through the Changesets fixed group, which `@wardic/foldkit` joins. Recorded as an *Amendment* to ADR-0069.
   - Rejected: Tier 2 modules, which would make nearly every Motion fix a semver-major of core; bundling core's internals into each binding.
6. **`Report` moves into core** (R6 Q22). The engine still doesn't report; the spine does, as a binding boundary, through Effect's `ErrorReporter`. Recorded as an *Amendment* to ADR-0030.
7. **The ports** (R7 Q29, Q30):
   - **ADR-0068's:** Own values, Measured pairs, Variables, Appear's handoff and subject resolution.
   - **Added here:** the Transform template, as a member of the Renderer port; the server's Starting style; drag defaults, filled by dom's drag Feature; and the gate's inline read, as a member of Own values.
   - **How they're reached:** each is a `Context.Service` in core, filled by `DomLive`. The provider resolves each once into `WardicServices`, so no element does a Context lookup.
   - Rejected: one catch-all service of DOM edges; a Context lookup per port per element.
8. **Five PRs, the ports put in place first** (R7 Q31), as [`lift-672-move-plan.md`](../research/lift-672-move-plan.md) lays out. Each commit passes, flat:
   - typecheck, lint, `test` and `test:browser`;
   - `bench:solid` and `bench:core`;
   - `size`;
   - `pack:check`.

   The two Amendments land in its first PR (R7 Q32). The lift starts once this ADR has merged (R7 Q33).

### Services and Effect semantics

9. **One Wardic runtime inside Foldkit's** (R1 Q6, R2 Q1).
   - **The handle:** `Wardic.make({ env, features })` runs at module scope and makes it.
   - **The provider:** a provider attribute on a `w.*` element at the top of the view builds Wardic's Layer with `Layer.buildWithScope` into its Mount's Scope, and completes the handle's `Deferred`. Elements await it.
   - **Commands:** `resources: wardic.resources` gives them the handle by type.
   - Rejected: building it in `resources`, which Mounts can't reach and Foldkit builds lazily; a provider found by DOM ancestry with no handle, which a Command can't get by type.
10. **The References and the Tracer** (R1 Q13, R2 Q2). Wardic's Layer inherits the building fiber's References, and `env` adds or overrides them. Mounts never see `resources`, so an app's Tracer reaches Wardic through `env`. That's a documented deviation until Foldkit gives Mounts services.
11. **Foldkit's microtask scheduler stays** (R1 Q7; P9), as #208's runner keeps a host's async scheduler.
12. **The fibers are split** (R1 Q8). An element's Mount Scope holds its registrations, and the provider's runner holds its Legs. That way an exit outlives `destroy`, which runs before removal.
13. **Failures are contained** at the binding's edge (R1 Q9). No defect reaches Foldkit, which would stop the whole app, and every Command answers with a Message.
14. **No Schema in `src`** (R1 Q10): hand checks shared across bindings. This is a deliberate deviation from the effect-4 skill (ADR-0067 decision 9). Schema appears only where Foldkit's API asks for it.
15. **Effect-typed where the app writes Effect** (R1 Q11): `Option` where a callback may give nothing.
16. **Live values are Atoms** (R1 Q12, R4 Q11), with the registry in Wardic's one Layer:
    - `w.Style({ opacity: fade })` takes them;
    - core's `LiveValue` helpers are made at module scope;
    - `w.Text(atom)` writes `textContent` outside the patch.
17. **`Reactivity` without a reactive graph** (R6 Q23, R10 Q23′).
    - **The accessors:** getters over the latest config each element received.
    - **When watches re-check:** once per patch, in one microtask queued by the provider's delivery, the first setter call of every patch. It runs after the whole patch and before the Measure pass, and fires on `!Equal.equals`.
    - **Its cost:** 0.48–0.60 ms for 1,000 elements × 3 watches (P17, Bun).
    - **Documented:** a config object mutated in place can read stale, since `Equal` caches its result per pair.
    - Rejected: re-reading after each delivery (P17: it fires values from partway through a patch, and it's quadratic); an Atom per watched key.

### The view

18. **The builder, plus the bundle** (R2 Q3).
    - **The builder:** `const w = wardic.html(h)` is cached per `h`, and makes `w.div(attributes, children)` and `w.keyed(tag)(key, attributes, children)`.
    - **Motion's props in PascalCase:** `w.Initial`, `w.Animate`, `w.Exit`, `w.Variants`, `w.Transition`, `w.WhileHover`, `w.Layout`, `w.LayoutId`, `w.Drag`, and the rest, with Motion's names kept (ADR-0042 decision 1).
    - **What `w.*` does underneath:** it merges the Starting style under the user's `h.Style`, and fuses its Mount with the user's `OnMount`.
    - **The bundle:** `Ward.attributes({ …, mount })` serves any other element. It takes the user's Mount and fuses it (R8 Q38), because a second `OnMount` throws in the preview and silently replaces the first on 0.170.
    - Rejected: Motion's props as one record, with a third positional argument.
19. **An identity stamp** (R5 Q16). Every `w.*` element stamps a Foldkit identity with `foldkit/brand`'s `brandViewResult`, so it never inherits a plain element's node.
    - **Why:** an `OnMount` added to a node Foldkit keeps never starts (P2; foldkit/foldkit#1497), which would leave its children at their Starting style.
20. **Re-renders reach the ward through a `CustomElement.define` property factory** (R5 Q15; P6).
    - **What the factory gives:** one setter call per fresh value, parent first. It's compared with `sameResolution` (#470) before a Retarget.
    - **The Mount's release,** not the setter, handles an element that stops being Wardic's.
    - Rejected: Foldkit's internal `Prop`.
21. **Variants down the tree** (R3 Q6). A builder-time walk over the children a `w.*` parent receives, copy-on-write, skipping mounted subtrees, plus DOM ancestry at mount. It's exact on the server. Thunk children are the fallback.
22. **Subtree settings are attributes,** found the way variant names are:
    - `w.Config(…)`, Motion's `MotionConfig` without a wrapper node, with app-wide defaults in `Wardic.make` (R4 Q10);
    - `w.LayoutGroup({ id, inherit })` (R6 Q25);
    - `w.Presence({ mode, initial, custom, onExitComplete, presenceAffectsLayout, propagate, anchorX, anchorY })`, on the leavers' parent (R6 Q24).

### Callbacks and imperative calls

23. **Event callbacks are Messages** (R4 Q3), in Foldkit's two handler shapes: a Message, or `(event, info) => Message | Option<Message>`. They reach `update` through the element's Mount Stream (P7).
24. **The four that aren't events** (R4 Q4):
    - `onMeasureDragConstraints` is a pure function;
    - `onUpdate` is an Atom sink, `w.OnUpdate(atom)`;
    - `onBeforeLayoutMeasure` and `onLayoutMeasure` are plain functions that can't dispatch.
25. **`onDrag` and `onPan` send a Message per pointer event** (R4 Q5), as Motion's and Foldkit's own `h.OnPointerMove` do. `Option.none()` skips one.
26. **Imperative calls are Effects with typed errors** (R3 Q9), the way Foldkit's `Dom` helpers work:
    - `Wardic.animateLayout: Effect<void, LayoutFailed, Wardic>`;
    - `Wardic.animate(target, values, transition): Effect<AnimationEnd, AnimationFailed, Wardic>`.

    The app wraps them in `Command.define`, or in `FeatureBlock.makeCommand` on the preview.
27. **Drag** (R4 Q12, Q13):
    - `w.DragConstraints` takes a box, `"parent"` or a selector, measured at each drag start;
    - `DragControls.make()` sits at module scope, with `w.DragControls(handle)` and `w.StartsDrag(handle)`;
    - the handle element's pointerdown is a Wardic Feature (ADR-0060), since a Foldkit handler never sees the event object.
28. **Reorder** is two attributes (R4 Q14): `w.ReorderGroup({ values, axis, onReorder })` and `w.ReorderItem(value)`. The order lives in the Model, and `onReorder` sends a Message per swap.

### Presence, layout and frames

29. **Presence re-inserts its leavers** (R5 Q17, R9 Q17′; P8, P19).
    - **How:** the presence's `MutationObserver` re-inserts each removed child and plays its exit.
    - **After every patch,** it re-places **every** leaver, walking `orderOf`'s order with a cursor.
    - **Keys** live in a WeakMap that `w.keyed`'s Mount fills.
    - **A key that re-enters during its exit** hands the leaver's values to Foldkit's fresh element.
    - **The controller's own moves** are dropped with `takeRecords()`.
    - Rejected: the Model-driven pattern Foldkit UI uses, which isn't `AnimatePresence`; an injected snabbdom `remove` hook, which is internal.
30. **A layout pass after every patch that changed the DOM** (R5 Q19, R9 Q19′, Q40; P13).
    - **How it's triggered:** a `MutationObserver` on the provider's subtree, watching the child list, text and `attributeFilter: ["class", "hidden"]`, which the app extends with `layoutAttributes`.
    - **What it costs:**
      - a render that changes nothing costs nothing;
      - one that does costs about 3.5 µs per layout node in Chromium and about 6.5 µs in Firefox.
    - **The opt-out:** `w.Provider({ layoutTrigger: "declared" })` uses Solid's triggers.
    - Rejected: Solid's triggers by default, where a keyed reorder jumps unless declared; watching every attribute, which makes a record for every style write.
31. **The pieces that differ in the preview** (R8 Q37, R10 Q43; P21) stay behind one module each.
    - **Services:** from `program.provide(Wardic.layer)`, read with `Effect.serviceOption` by a raw Mount, which needs no Block registration.
    - **The fused `OnMount`:** `{ ...userAction, f }`, which keeps the user Mount's registration.
    - **A Mount that restarts on a kept element** when its Block retires carries on with no `initial` replay. Its release does only the synchronous part, and the rest is decided in the patch's microtask.
32. **One held frame for starts caused by the Model** (R5 Q20; P1, P20).
    - **Why:** Foldkit patches inside its rAF callback, after Wardic's tick, so a layout move, a Retarget or a pointer-driven swap paints its origin and moves in the next frame.
    - **What it costs:** warm, about 14 ms more than Solid in Chromium and about 21 ms in Firefox; cold, 3–4 ms in Chromium. An interrupted motion doesn't stall.
    - Documented. #673 took core's half (ADR-0018, *Amendment (#673)*): a Measure pass that knows it runs after its frame's tick takes its nodes' first step. It knows from its trigger only: a trigger during Wardic's tick, or in the engine's observer delivery.
      - Foldkit's patch is app code in a later rAF callback to the engine, so it still holds one frame.
      - Its fix is a hint the binding gives from code it knows runs inside a frame, built with the binding. The rule it feeds is #673's: step if the last tick's frame time equals this frame's, or if the Clock has no request pending; otherwise step nothing, since a tick is still to come in this frame.
      - Starts on the Frame loop (a Retarget, a pointer-driven swap's legs) are #680. Since #680 a run added in the loop's Late window takes its first step there (ADR-0027, *Amendment (#680)*). Foldkit's patch runs in a later rAF callback, after the window's microtask, so it's still outside it: the binding's hint opens the window, on the rule above, and covers its passes and its runs both.
33. **`viewTransition`** (R5 Q18; P10). The app wraps its predicate with `wardic.viewTransition(…)`. In a transitioned render, layout moves and `layoutId` handovers land at once, and the View Transition animates.
34. **DevTools replay lands everything at once** (R2 Q7), through ADR-0063's `skipAnimations`: animations, layout, exits and Appear, with no callback Messages.

### Server rendering

35. **Appear's CSS** (R3 Q7; P14):
    - **On the server,** the provider renders `<style data-wardic-appear-chunk>` as its first child, since Foldkit's view has no head channel.
    - **On the client,** `Appear.adoptChunks(document)` moves it into `<head>` before `Runtime.hydrate`.
    - **The slots** are named by a stable identity, so a re-render never hands an element another element's animation.
    - **P14 found no flicker.**

### Tests, performance, package

36. **Scene tests** (R3 Q8). Raw Mounts are exported as `Wardic.Provider` and `Wardic.Element` and resolved by name, with no Schema.
37. **The binding's own browser suite** (R8 Q35):
    - Solid's binding-level scenarios ported as Foldkit fixtures;
    - a test for each Foldkit-specific finding: P1, P2, P14, P19, P20, the identity stamp, the `viewTransition` wrapper, and replay;
    - P15, P16 and P18 as tests;
    - a shared scenario suite across bindings becomes its own issue if they drift.
38. **`bench:foldkit`** (R8 Q36):
    - bench:solid's scenes, a render that changes nothing, and a Foldkit-without-Wardic baseline;
    - plus a `size` entry;
    - no target until the first numbers.
39. **Peers** (R6 Q26):
    - `foldkit ~0.170.0`, widened in a Wardic release for each minor the suites pass on, with a weekly CI run against `foldkit@latest`;
    - `effect ^4.1.1`, so the app has one Effect instance, shared with Foldkit.
40. **Examples and docs** (R8 Q34): a Foldkit storefront page for page with the others, deployed beside them, and a `@wardic/foldkit` section on the docs site, as 1.2's last slice.

## Consequences

**The order:**
1. This ADR.
2. #672's five PRs.
3. `@wardic/foldkit`'s slices.

**Asks for Foldkit,** drafted for review and posted only once approved (R8 Q39):
- **on #1655:** a library Mount usable in any Block (U1′), and Scene resolution and `emit` for library Mounts (U5);
- **as issues:** a public `Prop` (U2), a removal delay (U3), a commit Stream and a pre-commit moment (U4), and a head channel (U6).

**Follow-ups filed from the probes:**
- #673: a first step inside a pass that runs after the frame's tick (done for the engine's own triggers; Foldkit's hint comes with the binding);
- #674: a pass that finds nothing moved still writes 2N transforms;
- #675: Solid's presence lets a leaver drift on a reorder.

**Not decided:** what `features` defaults to when `Wardic.make` isn't given one. *Decided in Amendment (#516): none.*
- Every `w.*` element is a **Slim element**, whose Features are the handle's, so with none given, gesture and layout props would do nothing.
- Solid's `wardic.*` (**Complete**) has no Foldkit counterpart.

**Not measured:**
- a typed binding on the preview (P21's code ran untyped);
- WebKit;
- hydration on the preview;
- a tree-wide Measurement before the patch.

## Amendment (#516, 2026-11-13): the handle is a Wardic instance

ADR-0067's *Amendment (#516)* types a Solid **Wardic instance** (`createWardic(features)`): its `w.*` take only their Features' props, and a prop of a missing one is typed `NeedsFeature<"name">`.

1. **`Wardic.make`'s handle is typed the same way** (#516 Q11). Its `w.*` take its Features' props, through Foldkit's own map from a Feature's name to its props, since Foldkit's callbacks are Messages (decision 23). The lift (#672) and the binding's slices build it typed from the start.
2. **Without `features`, a handle has none** (#516 Q12 A): `Wardic.make({ env })` gives the base props alone. The *Not decided* above worried that gesture and layout props would do nothing. With the types, `<w.div drag>` is a compile error naming `drag`.
   - Rejected: `domMax` by default, every Feature shipped unless chosen; `features` required, `[]` written by every app without one.

## Note (#746, 2026-11-14): spans by default, and ports before the lift

ADR-0067's *Amendment (#746)* cuts the Slim element's apps.

1. **The handle gives `WardicSpans` by default.** A Solid app merges it to see Wardic's spans (that Amendment's decision 8). Foldkit opens a span for every Command (`Effect.withSpan` in its runtime), so a Foldkit app ships Effect's tracer anyway, and Wardic's animations show in its traces beside its Commands.
2. **The spine's and the gate's seams land before the lift** (its decision 10), each a port in core resolved once into `WardicServices`, as decision 7's are. Unlike decision 7's, each is optional: a `Context.Reference` whose default is none, filled by the Layer its Feature or component brings, not by `DomLive`. Each PR adds its port to [`lift-672-move-plan.md`](../research/lift-672-move-plan.md). The lift moves them unchanged.
3. **What the cuts save in a Foldkit app.** Foldkit ships Effect's `Stream`, `Match` and tracer itself, so only the fiber helpers' cut (`FiberHandle`, `FiberSet`, which it doesn't use) and Wardic's own cuts reach its apps.
