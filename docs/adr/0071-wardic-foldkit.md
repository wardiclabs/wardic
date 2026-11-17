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

## Amendment (#672, 2026-11-14): the lift, grilled again for its build

The lift's move plan was read at `15f723d` (2026-11-09). By 1.1.0, #665, #712, #706, #746, #516, #680 and #240 had changed 96 files in `packages/solid/src`. Two audits read it again: nothing that moves imports Solid, but the modules bound for core reached 7 that nothing placed (+3,891 lines), `spine.ts` and `member-hold.ts` imported each other, and four type imports would point from core into dom. #672's build grill (Q1–Q24, [issuecomment-6885943992](https://github.com/wardiclabs/wardic/issues/672#issuecomment-6885943992)) settled them; [`lift-672-move-plan.md`](../research/lift-672-move-plan.md) is the plan it left.

1. **Decision 4, the placement, refined** (Q12–Q14):
   - **The rule:** a module moves only if a moved module imports it, or Foldkit's decided API needs it. Solid-free code that only Solid calls stays.
   - **`imperative.ts` goes to dom,** not core (Q13): since #665 and #746 it's the DOM's `animate`, its Subjects elements, selectors and Batches of elements, and it handles Batch calls. Its Imperative track splits out into core when a scene's `animate` needs it (ADR-0069's *Amendment (#672)*).
     - Rejected: the split now, reshaping code for a caller two milestones away.
   - **To dom too:** `batch.ts` (as `BatchMembers`, beside core's `Batch`) and `batch-handoff.ts`, which `imperative`, `layout-member` and the hold import; `features/*` and `press.ts`; `layout-member.ts` and `layout-group.ts`; `ProjectionOptions`.
   - **Staying in solid:** the Batch's gestures and its Reorder group, `gesture-callbacks.ts`, `runtime.ts`'s provider half, `messages`, `spans-check`, `ward-keys` and the instance modules.
   - **`member-hold.ts` splits** (Q14): its slot goes to core beside the spine, page-wide module state as it was; its filler goes to dom beside `BatchMembers`. This refines ADR-0067's PR 7 note ("the lift makes it a port"): the slot moves into core rather than becoming a port.
     - Rejected: an optional `Context.Reference` filled where `createBatch` is. A Layer's Reference lands in the Features' Context, not the runtime's, so each element would look it up as it does `Timelines`.
2. **Decision 7, the ports, refined** (Q11, Q15, Q19, Q20):
   - **Required members of `WardicServices`,** each a `Context.Service`: `DomLive` gives the DOM's, `TestLive` headless ones, and a server render dom's as constants, beside `SERVER_POSITIONAL_KEYS`. They reach the spine through its options from the provider's record; an exported helper that reads one takes it as a parameter.
     - Rejected: `Context.Reference`s with neutral defaults, under which an Environment that forgets one animates from identity with no error.
   - **Drag defaults and subject resolution go** (Q11, Q20): `makeElementSpine` never reads the drag defaults, and the bindings call its two helpers, which go to `@wardic/dom/unstable/DragDefaults`. Once `imperative.ts` is dom's, nothing that moves to core checks a Subject's kind; `Subject` stays, as a type.
   - **Where an import would point from core into dom,** core names what it calls and dom's type satisfies it: `SpineDrag { takeRelease }`, `SpineConfig` (which dom's `WardConfig` extends), the gate's timeline calls, and `Timelines`' key.
3. **Core's config types are built on an empty `ValueKeys`** (Q24, at the build; Q25 at the review renamed the sketch's `Values`, core's values record's name): `interface ValueKeys {}` in core's `Config`, every type (`WardicTransition`, `WardicVariant`, …) keeping its name and shape over it, and dom's `WardConfig` filling it by declaration merging with the DOM's keys, as solid's `declare module "solid-js"` augments Solid for its directives. Core names no CSS (#609); with dom in the program, each type is exactly what it was. The controls' interface and mark, which `WardConfig` names, go to core's `Config` with it, ahead of `animation-controls.ts`, which imports the spine's `Snapshot`.
   - Rejected: open shapes in core, which hand a binding back looser types than it gave; a type parameter on every config type, threaded through nearly every moved signature.
4. **Decision 8, the PRs and their gates, refined** (Q2–Q4, Q16, Q21, Q23):
   - **Six PRs, one at a time off `main`:** foundations; the ports in place; the leaves to core; the spine and what imports it (`animation-controls`, `variant-tree` and `appear`'s handoff, which import the spine's `Snapshot` in turn, found at the build); the Batch, `animate` and presence to dom; the Features to dom.
   - **Every commit** passes typecheck, lint, `test`, `test:browser` and `size`; **every PR** also `bench:solid` (paired), `bench:core` and `pack:check`.
   - **A move commit changes imports, in the form the new home asks (a core module as a namespace), and its files' headers for their new home:** core's lint (`BOOL_OPERANDS`, 15 sites), a rename, a port or a retype is a commit of its own before it.
   - **`patch` changesets** until the 1.2 Foldkit release.
   - **Size:** if PR 2's ports cross a budget, it rises by exactly what was measured, recorded in ADR-0067; a move fits the 0.5 KB room.
5. **The Features across bindings** (Q8–Q10):
   - **Each binding keeps its own gesture start:** Solid 1's computation reporting to its config callbacks, Solid 2's reporting to its Lifecycle, Foldkit's sending Messages. Only the Features' services (`watch`, `drive`) move to dom. This answers ADR-0067's *Amendment (#746)*: "the lift is where each binding's gesture glue takes its final shape".
     - Rejected: one start in dom with a host per binding, which #746 prototyped at 0.1–0.7% on the apps with a gesture, and which isn't a move.
   - **Which Features take props is the Features' fact:** dom's `Feature` names `PropFeature` (`hover`, `press`, `focus`, `inView`, `pan`, `drag`, `layout`), and each binding's props map is checked against it.
   - **The Feature registry runs on `Runner & { memoMap }`** and the provider's own `dispose`, which stays its provider's.
6. **Solid's tests stay in solid** (Q17). A test moves only if it uses no Solid and tests one moved module, as the runner's did.

**The *Note (#746)*'s second item, corrected:** none of #746's seams became a port. The Imperative track went to `imperative.ts`, its one caller (ADR-0067's PR 6); a Batch member's hold kept its module slot (PR 7); the presence seed, the Timeline hooks with the gate's book, and the `while*` layers were measured under #746's bar and dropped. The move plan had no port to add.

**Refined at PR 2's build** (PR2-Q1 to PR2-Q3, 2026-11-15): of item 2's ports, only three are built, **Own values**, **Measured pairs** and **Variable values**, as `@wardic/core/unstable/OwnValues`, `MeasuredPairs` and `VariableValues`, each an optional Environment member (PR2-Q4): `@wardic/test`'s `testLayer` gives headless ones, `DomLive` gives none, and a DOM binding's element code falls back to dom's `unstable/DomValues`. Through `DomLive`, an app with no Wardic element, a Batch app's, shipped the DOM's port code (+2.0–3.2%, measured). The rest of item 2's DOM reads go to dom with the code that makes them, by Q11's rule: a helper only the bindings call needs no port. A `Handoff` carries what the spine reads of its animation, and development's match stays the binding's; the server's Starting style and the Transform template are the bindings' helpers' (`element-setup.ts`, for dom's `unstable/ElementSetup`); the gate takes its two DOM edges from `FlushGate.make`.
  - Rejected: item 2's six ports, three of them read only from binding code, which can import dom; the three as required members `DomLive` gives (Q19 as decided), which a type error would hold, at 2.0–3.2% on every Batch app.

**Refined at PR 3's build** (PR3-Q1, 2026-11-15): `live-style.ts` goes to dom (`@wardic/dom/unstable/LiveStyle`), not core: it is the DOM's `style` prop, Live values routed through it, its CSS text and Motion's will-change, whose accelerated keys are CSS properties. The spine names the nine members it and the Timelines' keys call (`LiveRoutes`), among them `turnsWillChangeOn`, which the Live style gives. Core gains `Subject`, a type (Q20), which the presence protocol's shapes take as a parameter; solid names them over `Element`, so its public presence types are unchanged.
  - Rejected: splitting it, core keeping the routing and dom its CSS, with the DOM's will-change policy passed in as options; core describing a `style` all the same.

**Refined at PR 6's build** (PR6-Q1 to PR6-Q3, 2026-11-16):
- **The Features keep their folder,** `@wardic/dom/unstable/features/<Name>`, each its own module, as lazy loading and tree-shaking need. Rejected: flat names with a suffix (`HoverFeature`).
- **Service ids are `"@wardic/dom/unstable/<Service>"`,** as core's unstable services are. Rejected: the plan's `"@wardic/dom/<Service>"`, written before `unstable/` was.
- **Solid's shims go when nothing imports them;** pointing the importers that stay at core and dom is a follow-up, so the lift closes on the lift. Rejected: every importer re-pointed in PR 6, a diff across most of solid's remaining files.

**Refined at PR 5's build** (PR5-Q1 to PR5-Q3, 2026-11-15):
- **The Runner runs an effect to its Exit** (`runSyncExit`): what `OwnerScope.close` needs, so a Batch's env and every Scope a binding closes run on a Runner, and dom names no binding's runtime. A `ManagedRuntime` meets it as it is. Rejected: the env typed by effect's `ManagedRuntime` in dom, which left a Foldkit runtime out; the close catching a suspending finalizer's throw.
- **The rest of `appear.ts` is one dom module, `AppearAnimations`:** its server sampler, the key that matches a server's to a client's, and the DOM's Handoff reads, most importers using more than one. Rejected: two modules split in place first; `AppearSampler`, a name for half of it.
- **The DOM's presence types are `PresenceController`'s:** core's protocol over `Element`, which the DOM's presence and Batch name, solid re-exporting them. Rejected: a module of their own; the protocol over `Element` written inline in dom.

**Refined at PR 4's build** (PR4-Q1 to PR4-Q4, 2026-11-15):
- **Will-change is the DOM's.** `LiveRoutes` has `started(legs)`: the spine tells an element's Live routes the legs each Retarget starts, and dom's `LiveStyle` decides whether to turn its will-change on. Core names no will-change. Rejected: neutral names for the same two members, which would keep the DOM's policy in the spine; Motion's name in core.
- **The spine's DOM-only helpers go to dom with `element-setup`,** as PR2-Q3's: a drag's will-change and claim, the dropped `transform` warning, the hydration check, the server's Appear entry.
- **`appear.ts` splits at what core reads,** about 80 lines (`AppearHandoff`): a mount animation's description and the Handoff's start. Its server sampler and the DOM's Handoff reads stay in solid until their importers go to dom (PR 5). Rejected: `AppearSampler` to dom in PR 4, with reads that aren't a sampler's.
- **The variant context carries the server's Appear group opaque** (`unknown`): core passes it on, and the one helper that writes it reads it back. Rejected: a variant context generic over its group's type; a binding-side `WeakMap`.
- **No cast for presence:** the spine holds a record over its Subject, which a record over `Element` is, since no member takes the element as an argument.

**Built in PR 1:** `Report`, `Stops`, `WardicServices` with the Runner, `Reactivity`, the Runner retype of the modules leaving solid, and the config split with `GestureInfo`, `DragControls` and `DragConstraints`; the site's reference keeps documenting what dom's Tier 2 faces re-export from core's `unstable/` modules. Every app's size flat; `bench:solid` and `bench:core` pass (the move plan's *Built in PR 1*).

## Amendment (#791, 2026-11-16): slice 1, grilled for its build

The lift (#672) is in; #561's five slices are filed (#791–#795). Slice 1's build grill (Q1–Q27, all accepted) settled what the decisions above leave open for the package, the element and `animate`. PR 1 (the element) builds these; PR 2 (the tree) and PR 3 (values and Effects) refine their own at their builds, in this section.

1. **The Handle** (Q1–Q3, Q9, Q18): `Wardic.make({ env, features, config })`. `env` is required, as a Solid provider's is; `features` is typed as Solid's `createWardic` takes them, from PR 1, so the Handle is `Handle<F>` from the start (the Amendment (#516)); `config` is `w.Config`'s record (PR 2). In PR 1 the Handle exposes `html(h)` and the raw Mounts `Provider` and `Element` (decision 36); the `Wardic` service tag and `resources` (decision 9) come in PR 3 with `Wardic.animate`, the first thing that needs the Handle by type. **The provider is implicit** (refined at PR 1's build, at the user's ask): the first `w.*` element to mount while none is live builds the Layer, on its Mount's fiber (Foldkit's scheduler inherited, decision 11), inside the patch (P2: about 3 ms in a development build), into a Scope the Handle owns, and completes the Handle's `Deferred`; every element counts itself in at mount and out at release, and once the last has left the Handle closes the Scope at the end of the task, so a patch that swaps every element keeps the runtime. `w.Provider(options)` stays, optional, as the root the subtree options hang on (decision 30's trigger, decision 35's chunk, slice 2's `layoutTrigger`); a second one while the first's element is mounted is reported and ignored. The no-provider warning is moot. The package is `private` with `privatePackages.version: false`, so it joins the Changesets fixed group in slice 5 (decision 5); each slice-1 PR adds an empty changeset for its own changes.
   - Rejected: `env` defaulting to `DomLive`; a required provider attribute (the grill's Q3), one more line in every view for the common case, where Foldkit mounts a child before its parent anyway, so the element that builds is the deepest first one either way.
2. **The Delivery** (Q4, Q14, Q25): one `wardic` property carries the whole folded config, minted by one `CustomElement.define` spec with `Schema.Unknown` (decision 14's exception), so each element gets one setter call per render that built a fresh record. The setter Retargets at once, inside the patch, parent first (P6, P20); the `Reactivity` port's watches re-read in one microtask per patch (decision 17), queued by the patch's first setter call or first Mount insert, whichever element's, since the element carrying `w.Provider()` gets no delivery when its config is the same reference. The microtask runs the watches first, then (PR 3) the held-frame hint (decision 32).
   - Rejected: a property per Motion prop; deferring every Retarget to the microtask.
3. **The builder** (Q5–Q8, Q17): `w` holds `h`'s element factories, `keyed`, the bundle and Wardic's attribute factories, built once per `h` with no Proxy; Foldkit's own attributes stay on `h`. Wardic's attributes are a type of their own (`Ward.Attribute`), since Foldkit's `Attribute<Message>` is a closed `Data.TaggedEnum`: a `w.*` element takes both, `h.div` takes Foldkit's alone, and the last of a repeated one wins, Foldkit's rule for a second `h.Style`. A `w.*` element renders one `h.Style`: the user's `h.Style`, `w.Style`'s base values and the Starting style, projected together; a key in both `h.Style` and `w.Style` is an error in development. Every `w.*` element is stamped with one constant identity, `"@wardic/foldkit"`. Each attribute is typed on its own: nothing is inferred across attributes, where Solid's `wardic.*` infers its value keys (#305).
   - **The bundle is the builder's,** `w.attributes(config)` rather than decision 18's `Ward.attributes(config)`: its Mount needs the Handle and its attributes need `h`'s Message, both of which `w` has. `@wardic/foldkit/Ward` holds its types.
   - Rejected: `w` mirroring `h`'s attributes; a development error on a repeated attribute; a `w.div` generic over its attribute tuple for one typed sink.
4. **The Mount** (Q15, Q26): a `w.*` element runs one Mount. Without a user Mount it's named `Wardic.Provider` when the element carries `w.Provider()` and `Wardic.Element` otherwise, what a Scene test resolves by; with a user `h.OnMount` the fused Mount is `{ ...userAction, f }` (decision 31), so it keeps the user's name and args. Callback Messages (PR 2) leave through a per-element Queue, made the first time the element's config carries a Message callback.
   - Rejected: Wardic's name always, which breaks a Scene test written for the user's Mount; one Queue on the provider.
5. **`w.Provider(options?)`** (Q16) takes an optional record, empty in PR 1, so slice 2's `layoutTrigger` joins it without changing its shape.
6. **The development flag** (Q10): a `development` export condition on one internal subpath (`@wardic/foldkit/internal/dev`), as Solid's `DEV` is Solid's own condition. Vite's dev server and the repo's vitest configs resolve it; a production build doesn't, so the no-provider warning (once per Handle, after about a frame) and the spine's diagnostics are dropped from it.
   - Rejected: `process.env.NODE_ENV`, a Node global in a browser package; Foldkit's `import.meta.hot`, which is how Foldkit decides its own development mode and holds only under HMR.
7. **The tree** (Q19, Q20; PR 2): a child's Mount finds its variant parent by DOM ancestry at mount, walking `parentElement` to the nearest element carrying a delivered config, which Foldkit's props module wrote at `create`, before the children exist. Foldkit runs a child's Mount before its parent's, so the parent's variant node is made by whichever needs it first and adopted by the parent's Mount. **Decision 21's builder-time walk moves to slice 4** (#794), the server's need: on the client nothing observes its absence, since a Mount writes a child's inherited Starting style inside the patch, before paint (P2). The app-wide config is `Wardic.make`'s `config`, the record `w.Config(…)` takes, laid under a subtree's.
8. **Values and Effects** (Q21–Q24; PR 3): `Wardic.animate(subject, values, transition?)` takes dom's subjects (an element, a selector resolved under the provider's element, a list), succeeds with `AnimationEnd { landed: true }` when every key lands and `{ landed: false }` when a later animation takes its keys, fails with `AnimationFailed` only when the subject finds nothing or the Handle has no provider, and stops when its Command's fiber is interrupted. Sequences and the animation scope get a follow-up issue in 1.2, after slice 3. `Wardic.provide(effect)` turns an Effect needing Wardic's services into one needing `Wardic` alone, run on the provider's runtime from a Command: how an app makes `LiveValue.spring`, `follow`, `velocity` and `scroll`. `w.Text(atom)` owns its element's text, children beside it a development error; `w.OnUpdate(atom)` sets the atom to the element's values each frame they change.
   - Rejected: `landed: false` as a failure, a `crash`-bound error in an app that doesn't catch it; the Handle exposing its services as a Layer for the app's `resources`, which can't exist before the provider mounts.
9. **Tests and gates** (Q11, Q12, Q27): the fixtures are Foldkit programs run with `Runtime.embed` in a container of their own, their Model changed through inbound ports and their interactions through real clicks, with replay through `foldkit/devtools-host`; a Scene test of the documented pattern ships in PR 1; the package joins `pack:check` while private, with a fifth fixture, `foldkit-vite`. The tests import `packages/solid/test/browser-helpers.ts`, as the layout lab does.

**Built in PR 1:** `packages/foldkit` (`@wardic/foldkit`, private), its `Wardic` and `Ward` modules, the seams `internal/services.ts` and `internal/mount.ts` (`commands.ts` comes with PR 3), the Delivery and the `Reactivity` port, the `foldkit-browser` project in the root `test:browser` tier with the fixtures above, the pack:check fixture, and the glossary's five entries (Handle, Provider attribute, Bundle, Identity stamp, Raw Mount). Merged as #796.

**Refined at PR 2's build** (the tree, 2026-11-17):
- **The variant node is Solid's over getters** (`internal/variant-node.ts`, item 7): what Solid keeps in memos is read on each ask, and what a Solid effect did at a trigger (the stagger slots marked stale, a list's names waiting again, `beforeChildren` waiting again) is done on the first read after the trigger key changes, so a child Retargeting in the same patch reads a fresh slot. A settle that changes a gate (`beforeChildren`'s, `afterChildren`'s) calls the port's `notify`, which re-checks every watch: a child waiting on a gate watches `canStart` and Retargets as it opens; a Variant child also watches the name its ancestor hands down, for a config delivered by reference (P17). Rejected: a watch on the trigger key, whose re-check comes after the patch, when the children's Retargets have read their slots.
- **A Variant child's inherited Starting style is written at its mount** (item 7's premise), inside the patch, before paint: the view can't render it until slice 4's walk, and the first commit switches it as any Starting style. Verified by the first fixture: every child at `opacity: 0` on the first read.
- **`w.Config(options)` is an attribute of the subtree's root** (decision 22), found as the variant parent is: the nearest ancestor carrying one, over the Handle's `config`, each setting read when an animation starts. Only `transition`, `reducedMotion` and `skipAnimations` in slice 1; `isValidProp` and `transformPagePoint` come with the gestures (slice 3).
- **Callbacks are Messages through the element's own Mount Stream** (decision 23, item 4): `w.OnAnimationStart` and `w.OnAnimationComplete` take a Message or `(definition) => Message | Option<Message>`, kept in the config as handlers and wrapped into the spine's functions per delivery; `Queue.offerUnsafe` on the Mount's queue. The mount's Retarget is told too when `Initial` and `Animate` are equal maps, as Solid's is (#448 keeps quiet only the same entry).
- **`transitionEnd` is the target's key** (Motion's; #428), not an attribute: `w.Animate({ …, transitionEnd })` and a variant's carry it, and a Variant child's Starting style carries its `initial`'s. Verified against Solid's TE1.

Merged as #797.

**Refined at PR 3's build** (values and Effects; grilled 2026-11-17, Q1–Q13, all accepted):
- **The `Wardic` service is the Handle** (decision 9, item 1): `Wardic.Wardic`, a `Context.Service` whose value is the Handle's mark; `wardic.resources` is `Layer.succeed(Wardic)(handle)` for a program's `resources`. `Wardic.animate` and `Wardic.provide` are module functions over it, not Handle members.
- **`Wardic.animate(subject, values, options?)`** (decision 26, item 8) takes dom's subjects, a selector resolved under the `w.Provider()` element, else the document, and dom's options less `onComplete`, which the Effect's success is. It succeeds with `AnimationEnd { landed }`, fails with `AnimationFailed` only when the subject finds nothing, and stops when its fiber is interrupted. A `w.*` element registers its spine with dom's `Imperative` at mount, so it animates through its own spine, latest wins.
- **`Wardic.provide(effect)`** (the grill's Q23) gives Wardic's services and passes the Scope through: a derived Live value's lifetime is its caller's, a `ManagedResource`'s `acquire` or an `Effect.scoped`. Rejected: the provider's Scope, which leaks each call and ends none.
- **An imperative use builds the provider and counts as a member** while it runs, so a plain element animates with no `w.*` element on the page, and the provider doesn't close under a running animation. The Handle's state is reached through a `WeakMap` by the Handle.
- **Live values are Atoms alone** (decision 16): a function in `w.Style` is a development error. A Live key's Starting style reads the Atom through the provider's registry when it's live, else a scratch one (`LiveStyle.serverRegistryOf()`), as a server render does. `w.Text(atom)` writes `String(value)` through the registry's subscription, children beside it a development error at the build; `w.OnUpdate(atom)` sets a copy of each committed frame's values (the gate reuses its object, and an Atom set with the same reference notifies no one); `w.TransformTemplate(fn)` is followed by reference, as Solid's.
- **A Command's animation runs under the Handle's `config`** (decision 22): its `reducedMotion` and `skipAnimations`, read as the animation starts, as Solid's `createAnimate` reads its provider's; no `w.Config` reaches it, since it hangs on no element. A subject that finds nothing leaves the provider it joined at once, so a failed `animate` on a page with no `w.*` element keeps no provider up.
- **The root re-exports `LiveValue` and `stagger`**, so an app imports nothing from `@wardic/core`.
- **The hint is one core Frame loop member** (decision 32, revised): `FrameLoop`'s `hint(frameTime)`, not `ProjectionSystem.inFrame()`. A setter calls it with `document.timeline.currentTime` before its Retarget, after the patch's microtask is queued, so the loop's window microtask runs after it. The loop opens #680's Late window when a burst's last tick was this frame's (`Clock.frameAt`, a member the Clock gains) or no burst runs; the runs the patch adds after it take their Late step in that microtask, at the last tick's dt, or a nominal frame before any, and a queued Measure pass reads `inLateWindow()` as it does. Not from a Mount's insert (a mount animation's origin is its Starting style) and not under DevTools replay, whose patch runs in a task (P6). Core's `frame-loop.test.ts` HT1–HT3 pin the rule; the binding's held-frame fixture pins P20's case.
- **Animation controls, sequences and the animation scope** are one follow-up issue, after slice 3.

**Refined at slice 2's build** (presence; grilled 2026-11-17, Q1–Q28, all accepted; PR 1):
- **The key rides in the delivered config** (decision 29, revised): `w.keyed(tag)(key, …)` puts `key` in the element's config, told to its presence as the element mounts (the controller's `made`), so a child back under a leaver's key takes over from it (#286). No WeakMap and no DOM attribute. An unkeyed child still exits in place; only the take-over needs a key.
- **A child under a presence starts in the presence's delivery**, not in its own Mount. Foldkit runs a child's Mount before its parent's and before the patch ends, so take-overs and `wait`'s holds, which the controller decides as it's told what's shown, aren't known at the child's Mount. The child enrolls its start with the presence it finds by DOM ancestry (as the variant parent); the delivery, a microtask after the patch (P8), asks the controller what goes on the page, starts the enrolled children (one `wait` holds starts once it's shown), and tells the controller what's present. The first delivery is the presence element's own Mount's, inside the patch; `initial: false` covers the children it starts (`mounted` after it).
- **The delivery puts back each known child the patch took out** (P8's rule: before the node after it, if still a child; else after the one before; else at the end), so the controller finds every leaver on the page where it was, and `popLayout` measures it there. Foldkit's children are tracked as the known ones kept plus the records' added, less the removed: a leaver the controller retains or removes is never reported present again.
- **`mode="wait"` hides the held child** (Q5, revised by P23): `display: none`, its own `display` restored when it's shown; not detached. P23 ran both holds through seven scenarios and a 100-step fuzz, in both browsers: each held, no held child painted, every final order the Model's. But Foldkit re-inserts a detached known node when it moves it (a reverse re-held it in the same delivery) and skips its removal silently (the binding would learn of it from the node's Mount release alone), so detaching needs placement bookkeeping of the binding's own; hiding needs none, since Foldkit keeps the held node's place.
- **`presence` is a Feature of the binding's own** (Q9): `Features.presence`, over dom's controller, since `w.Presence` sits on the shared builder and a static import would ship the controller to every app; `Features.layout` is dom's. The root re-exports both as `Features`, for `Wardic.make({ env, features: [Features.presence] })`. A `w.Presence` without it warns once in development and does nothing. The Handle's given Features are built at the first ask; loads come with slice 3.
- **The presence's delivery gives the hint** (decision 32; Q7) before its work, not at the mount and not under replay, so a leaver's first exit step paints in the patch's frame (the held-frame fixture pins it). `onExitComplete` is a Message through the presence element's Mount queue, none under replay (decision 34). The Mount is a raw Mount named `Wardic.Presence` (decision 36), `wardic.Presence` for a Scene test; `w.Presence` goes on the element's first render, since a Mount doesn't change on a kept element.
- `mode`, `custom`, `initial`, the anchors and `presenceAffectsLayout` are read from the delivered config as dom's controller asks for them; `propagate` once, as the presence is made, under the presence found above by DOM ancestry.

**Refined at slice 2's build** (layout; PR 2):
- **The trigger options are the Handle's** (decision 30, revised; Q10, Q17): `Wardic.make({ layoutTrigger: "patch" | "declared", layoutAttributes })`, since the provider builds without an element; `w.Provider()` keeps its root role. The observer is made as the `layout` Feature builds, at the first layout element's mount, on the `w.Provider()` element if one is mounted then, else the document's body (a root mounting later doesn't move it; the DevTools overlay's mutations under the body are a development-only cost, Q24), and disconnected as the provider ends. It watches the child list, the text and `class`, `hidden` and `layoutAttributes`, subtree-wide; never `style`, which the passes write (P13's guard), so an element an inline style moves animates only under a `w.LayoutDependency` change or `Wardic.animateLayout`. Each delivery gives the hint, unless replay has a view (the provider counts its Mounts' paused views, decision 34), and asks for one pass. The observer is made a microtask after the first layout element's mount, so a `w.Provider()` root mounting in the same patch, after its children as Foldkit mounts, is the root it watches. A presence told not to affect layout (`presenceAffectsLayout: false`) is quiet to it: a change of that presence's child list, its own moves and Foldkit's among them, asks for no pass, whichever observer fires first. The provider's end disposes its Feature registry, which disconnects the observer.
- **One projection node per element** with `Layout`, `LayoutId`, `LayoutScroll` or `LayoutRoot`, registered through dom's `ProjectionNodes` (`layoutOptionsOf`, `registrationOf`) as Solid's is, after the spine is made and seeded, disposed at the release; a `LayoutId` names a twin to its presence (`made`). With a layout built, every element registers its values by element, for a twin's flight to follow. The `layout` Feature comes through `Features.layout`, dom's; a layout attribute without it warns once in development and does nothing.
- **`w.LayoutDependency` is compared per delivery** with `Equal.equals`, where Motion compares by reference: a view rebuilds its values each render, so a fresh literal equal to the last asks for nothing, as the Reactivity port's watches do (P17). A change asks for the node's measure, or, on an element with no node of its own, the whole tree's, as Solid's `LayoutGroup`'s does.
- **`w.LayoutGroup({ id, inherit })`'s id is read once**, as the first `LayoutId` under it mounts, from the group above it by DOM ancestry (`layoutGroupIdOf`); the `LayoutId` goes through `layoutIdIn`.
- **The layout callbacks**: `w.OnLayoutAnimationStart` and `w.OnLayoutAnimationComplete` are Messages through the element's Mount queue, told nothing (decision 23); `w.OnBeforeLayoutMeasure` and `w.OnLayoutMeasure` are the config's plain functions, as dom reads them (decision 24). Under replay no callback Message leaves an element, the animation callbacks' included (decision 34).

**Refined at slice 2's build** (declared changes and View Transitions; PR 3):
- **`Wardic.animateLayout(options?)`** (decision 26, item 1; Q12, Q20) takes dom's `AnimateLayoutOptions` less `onSettled`, which the Effect's success is: it succeeds once every layout animation its pass started has ended, at once if none. Its `from` is `"lastPass"` by default: the Command runs after the Model change that moved the elements, and waits for the render's commit (Foldkit's `Render.afterCommit`, which holds inside a View Transition too), so the change is on the page and the boxes the last pass kept are where the elements were. It gives the hint before its pass (decision 32), builds the provider when none is live and is a member while it settles, as `animate` is; it fails with `LayoutFailed` (`reason: "no-layout-feature"`) when the Handle has no `layout` Feature. Under `"patch"` it's harmless beside the observer; under `"declared"` it and `w.LayoutDependency` are the triggers.
- **`wardic.viewTransition(decide)`** (decision 33; Q13, Q18) wraps the app's predicate and passes its decision through. Every render decides afresh: a transitioning decision (`true` or `{ types }`) arms the Handle's next Measure pass, whichever asks for it: the observer's delivery of the app's own changes (a foreign change under the body consumes no arming, and a render that changed quiet lists alone consumes it and asks for nothing), a `w.LayoutDependency` change, or `Wardic.animateLayout`, so a `"declared"` app transitions too. The pass runs as an Instant change of the layout (`projection.instant`): every node at its new box, nothing started, so layout moves and `layoutId` handovers land at once and the View Transition's morph carries the motion (P10); Retargets in that render animate as usual. The wrapper feature-detects `document.startViewTransition` once, at the first decision, as Foldkit's runtime does once as it's made: without it, Foldkit renders plainly and nothing is armed, so Wardic animates the moves itself. A transitioned render that changes nothing of the layout's leaves no arming behind, since the next render's decision replaces it.

**Refined at slice 3's build** (the gestures; grilled 2026-11-17, Q1–Q20, all accepted; PR 1):
- **The four gestures are attributes** (decisions 18 and 23): `w.WhileHover`, `WhileTap`, `WhileFocus` and `WhileInView` are entries in the Override stack; `w.OnHoverStart`, `OnHoverEnd`, `OnTapStart`, `OnTap` and `OnTapCancel` take a Message or `(event, info) => Message | Option<Message>` (ADR-0047's pair, the DOM's event first, the info's point in the viewport), `w.OnViewportEnter` and `OnViewportLeave` the browser's entry alone; `w.Propagate({ tap: false })` claims a press (#439), `w.Viewport({ once, margin, amount, root })` says what in view means. Solid 2's hover-move event has no Motion counterpart and stays out.
- **A function handler runs at the event**, inside the recognizer's dispatch, so `stopPropagation()` and `preventDefault()` do what they say (ADR-0047 decision 3); its Message goes through the element's Mount queue and reaches `update` a microtask later, as every callback Message does. Under DevTools replay the recognizers keep running (a hover still shows its `WhileHover`), every Message is silenced (decision 34), and a release lands at once.
- **A recognizer starts when a delivery wants it** (ADR-0047 decision 5, Motion's features): its `While*` or any of its callbacks in the config while its Feature is built; once, in a Scope of the element's own on the provider (dom's `OwnerScope`), closed at the release. So a callback a later render adds starts its recognizer then. A press makes its element focusable, as dom's does, for the **Keyboard press** (#427). A gesture wanted without its Feature is inert and warned once per provider in development, in Foldkit's words (`Wardic.make({ env, features: [Features.hover] })`), not dom's.
- **Gesture states go through the stack and down the tree** (#291): the element keeps its `Active` (hovered, pressed, focused, in view) and a flip re-resolves its Override stack (`resolutionOf`) and Retargets, compared by `sameResolution`; its variant node is bound to the same states, so its hand-down carries them, and the flip re-checks the Reactivity port's watches, where a Variant child watches its parent's trigger key (the variant name and the gestures handed on), not the name alone. Rejected: a gesture setter on the spine, which has none.
- **`w.Viewport`'s `root`** (Q16) is `"parent"`, the element's parent, or a selector resolved under the `w.Provider()` element, else the document, as the recognizer starts (as `Wardic.animate`'s subject and PR 2's `DragConstraints` resolve). `WhileFocus` follows the keyboard's focus alone (dom's `visible: true`).
- **The gesture Features are dom's**, re-exported as `Features.hover`, `press`, `focus` and `inView` with the presets `domAnimation` and `domMax` (Q2). A gesture attribute on a Handle without its Feature is a type error (the *Amendment (#516)*): the builder's factory is typed `NeedsFeature<"hover">` through dom's `PropFeatureNames<F>`, so calling it says which Feature is missing. The layout and drag attributes take the same typing in PR 3, with Reorder.
- **Loads** (Q2, Q15): a function in `Wardic.make({ features })` is a load (`() => import(…)`). The provider starts each as it builds, on the client; a Feature's arrival builds it into the registry and calls every mounted element's hook directly (no patch ran, so not through the port's watches), where a wanted recognizer, a layout node and the element's values registration join then; no missing-Feature warning fires while any load is pending; a failed load is reported once and its Features left out. A provider that builds again (the last element left) calls each load again, and `import()` answers from the browser's module cache: no once-per-Handle bookkeeping of the binding's own. dom's `Feature.ownOf` and `joinOwns` give the services and the pending flag.
- **The test tier registers Solid's real-input commands** (Q13) and the gesture fixtures pin the binding's own behaviour with the browser's mouse and keyboard; the recognizers are Solid's tests' concern.

