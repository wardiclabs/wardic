# Features and the Slim element: an app ships what it uses

An app with one `wardic.div` that fades in shipped 180.6 KB gzipped on Solid 1 (632.5 KB minified, Vite 6, production, tree-shaken), against 2.8 KB for the same app with a plain `<div>`. On Solid 2 it was 216.9 KB, against 13.4 (#511). Every part of the binding came with it: adding `whileHover`, `layout` or `drag` added nothing, because they were already there. By package, minified: Effect 225 KB (its runtime about 60, Schema about 54, atoms about 20, `PubSub`, `Queue` and `Channel` about 20), dom 121 (its projection engine, `projection.ts`, 65), solid 108, core 73, culori 61, solid-js 25. Effect's own floor, a `ManagedRuntime` with a `Layer` and a `Scope`, is 14.4 KB gzipped.

For scale, Motion's docs (*Reduce bundle size*, Rollup bundles): the `motion` component tree-shakes to no smaller than 43 KB; `m` with `LazyMotion` is just over 5 KB for the initial render, `domAnimation` adds 24 KB and `domMax` 38 KB. Solid's users weigh closely what a library adds.

## Decisions (grilled 2026-11-01, #511)

1. **Features are opt-in** (Q1: A). #460's bar, "pay for what you use", holds for bytes: an app ships only the code for the **Features** it uses.
   - Rejected: B, trimming what every app shares while every Feature still ships (≈140 KB); C, only `layout` opt-in (≈110 KB).
2. **Both elements, Wardic's names** (Q2, asked for: "provide both options"). `wardic.*` stays the **Complete element**, every Feature built in, as Motion's `motion`. `w.*` is the **Slim element**, as Motion's `m`: it animates values (`animate`, `initial`, `exit`, variants, transitions, Keyframes), and has the Features chosen above it. One implementation: the Complete element is the Slim element with every Feature.
   - **Where Features are chosen** (Q2b: A): `<WardicProvider features={[…]}>` for the whole app, and `<LazyWardic features={…} strict?>` for a section. A Slim element has the union of its provider's and every `LazyWardic`'s between them.
   - Rejected: Slim by default (every app setting up its Features); a prop loading its Feature by itself (asynchronously, so a first layout animation could be missed); Motion's `m` and `LazyMotion` as the names, or as aliases beside Wardic's.
3. **A Feature per gesture, `layout`, Motion's presets** (Q3, asked for finer than recommended). `hover`, `press` (a **Keyboard press** too), `focus`, `inView`, `pan`, `drag` (`dragControls` and the release's inertia with it), `layout` (`layout`, `layoutId`, projection), each its own import. `domAnimation` names the hover, press, focus and in-view Features, and `domMax` every Feature, as Motion's do. The gestures' shared input code ships with the first one an app picks.
4. **The Slim element's base app: about 105 KB gzipped** (Q4: A), Solid 1 included. It comes from the Feature split, colours on demand (5), and Schema out of the runtime (9). Effect's runtime, its atoms and its Streams stay.
   - Rejected: also taking atoms and Streams off the base (≈90 KB, reversing parts of ADR-0006 and ADR-0027); a base engine in plain TypeScript with Effect only in Features (≈40–50 KB, ending "Effect end to end", ADR-0030).
5. **Colours** (Q5: A). The base reads hex, `rgb()`, `hsl()` and CSS colour names, through `culori/fn` with those modes only. A `colors` Feature registers every other CSS colour space (`oklch()`, `lab()`, `color(display-p3 …)`, `hwb()` …). Blends don't change: Wardic blends every colour in sRGB (ADR-0026, *Amendment (#156)*). Without `colors`, a wide-gamut colour isn't read as one, and development warns naming the import.
6. **`w` mirrors every form** (Q6: A): `w.div`, `w.create()`, and the ward forms, `w.createWard()` and `use:w` on Solid 1, `w.ward()` on Solid 2. Every other form puts on a Complete element.
7. **A missing Feature** (Q7: A): its prop does nothing. Development warns once per Feature, naming its import and where to add it; production says nothing. `strict`, on `WardicProvider` or `LazyWardic`, makes a Complete element rendered below it an error in development, as Motion's.
8. **Features loaded lazily** (Q8: A): `features={() => import(…)}`. Values animate at once; a Feature takes effect when it arrives, from then on, and nothing before it is replayed. No missing-Feature warning while a load is pending; a failed load is reported once. A server render is the same either way.
9. **Schema leaves Wardic's runtime** (Q9: A). Option bags, an Interpolator's values, colours and the Key rules are decoded by hand, with Wardic's own errors naming the field. `Interpolator.Entry` gives a plain `parse` / `format` pair, what its codec was built on, in place of a `Schema.Codec`. Reverses ADR-0025's *Amendment (#66)* and ADR-0026's codec shape; core is unpublished.
10. **`bun run size`, gated head against base** (Q10: A). A fixed set of apps on both bindings, built as an app ships them, reporting minified, gzip and brotli bytes and the split by package. An app fails when its gzip grows more than 1% over the base's. The Slim element's base app holds an absolute budget too, about 105 KB, set once it's reached.
11. **Interleaved with #460** (Q11: A): `bun run size` first; Schema out with #460's PR 3b; the colour and Feature splits after #460's PR 4, before its PR 5 reads the code.
12. **A Feature's components bring it** (Q12: A): `LayoutGroup` brings `layout` for the elements under it, `Reorder.Group` and `Reorder.Item` bring `drag` and `layout`.

## Decisions at the split (grilled 2026-11-01, #511)

13. **Features are Layers, built by the provider, held by the section** (asked for during #460's PR 3b: "treat every lazy thing to add as an optional layer"; Q13: A). A Feature is an Effect `Layer` of its service: its name, the service's key, and the Layer, on the provider's Environment.
    - **Built into the runtime's `MemoMap`:** the provider builds a Feature's Layer the first time an element under it asks (#51: a provider with no element builds nothing), or as a lazy one arrives, with `Layer.buildWithMemoMap` into its runtime's `MemoMap`, in a Scope of its own. A Layer two Features share, such as the gestures' pointer input or the projection system, is built once per provider, and the provider ends its Features before its runtime.
    - **Held by the section:** each `WardicProvider` and `LazyWardic` holds the services of its Features, a `Context`, joined with its parent's: Q2b's union. An element looks a Feature up by its key. A lazy Feature arriving changes its section's, so an element takes it from then on, its fibers running as they did.
    - Rejected: B, one registry per provider, which is Motion's (its `loadFeatures` writes one registry for the page), as a section's choice would reach its siblings, reversing Q2b; C, providing the section's `Context` to each element's fibers, as every run would pay a context switch (#460's PR 3 measured Effect 4.1.1's per-fiber context) and a late Feature couldn't reach a fiber already running.
14. **The gestures' input moves into the gestures** (Q14: A). `DomLive` stops building the DOM's `InputSource`. Every gesture Feature's Layer stands on one input Layer, built once per provider by the `MemoMap`, which uses an `InputSource` the Environment gives (`@wardic/test`'s `TestLive`) and else builds the DOM's. An app with no gesture ships no pointer code, about 3 KB gzipped; `InputSource` leaves the Environment's required services.
    - Rejected: keeping it in the Environment, the gestures' Features carrying their recognizers only.
15. **The split in three PRs and a short fourth** (Q15: A): (1) the mechanism, with `colors` as its first Feature: Features as Layers, `features` and `strict` on `WardicProvider`, `LazyWardic`, `w` in every form on both bindings, the missing-Feature word, lazy loading, and the base reading colours through `culori/fn`; (2) `layout`, the projection system out of the provider, `LayoutGroup`, `Reorder` and the layout hooks bringing it; (3) the gestures, one Feature each, the input out of `DomLive`, `domAnimation` and `domMax`; (4) the base app's absolute budget, `/*#__PURE__*/` measured again, and this record. Each gated by `bun run size` and both benches.
    - Rejected: one PR; the biggest cut first, the mechanism built in pieces.

## Built

**`bun run size`** (`packages/solid/bench/size.ts`, PR 1 of #511):
- **The apps:** each binding's plain Solid app, one Complete element, and the same inside `<AnimatePresence>`. The Slim element's apps (its base, each Feature alone, `domAnimation`, `domMax`) join them with the Feature split.
- **Each side built as an app ships it,** as `bench:solid`'s pages are. The build code they share moved to `sides.ts`. Size copies each package's manifest beside its sources, and the resolver hands Rollup the package's `sideEffects`, as Vite's own resolver does for an installed package. Without that, the complete app read 190.1 KB instead of 180.6: Rollup assumes a module a plugin resolves has side effects. `bench:solid` builds its pages as before.
- **Gate:** an app fails when its gzip grows more than 1% over the base's; exit 1. Sizes are deterministic, so it runs in seconds, with no reps and no quiet host. A 6 KB string logged from dom's entry failed every Wardic app (+2.5% to +2.9%).

**`/*#__PURE__*/` annotations**, measured and not shipped: all 227 top-level calls in the three packages' sources, annotated, saved 0.2 KB gzipped (−0.1%), and added 1 KB minified, since esbuild keeps the comments for downstream bundlers. The Complete element's path reaches nearly everything it imports. Measured again after the Feature split, when a Slim element's app imports modules most of whose exports it won't use.

**Schema out of the runtime** (decision 9, with #460's PR 3b): option bags checked by hand (`internal/options.ts`), a rejected one throwing `Machine.OptionError` with Schema's messages word for word (137 rejected bags compared before and after); `Interpolator.Entry`'s `parse` / `format`; `Color.parse` / `Color.format`. `bun run size`, with the rest of #460's PR 3b: the Complete element's app 180.6 → 167.0 KB gzipped on Solid 1 (−7.6%), 216.9 → 203.3 on Solid 2 (−6.3%); Effect −57.4 KB minified, core +2.1 (+1.7 for the Schema step alone). What Schema is left, 118 bytes, is Effect's own `Atom` importing it. A fresh bag resolves 35–51% faster in Node, and an Interpolator parses 2–10× faster (ADR-0025's and ADR-0026's *Amendments (#511)*).

**The mechanism and `colors`** (PR 2 of #511, decisions 13 and 15's first):
- **`feature.ts`, shared by both bindings:** a `Feature` (its `name`, its service's `key`, its `layer`, and a `server` part), Features as a list or nested (`[domAnimation, layout]`), a provider's `FeatureRegistry` (`build`, a Complete element's `section`, `warnOnce`, `dispose`), and `makeSection`, which each binding calls with its reactivity: a Feature given at once is built on first need; a lazy one's load starts on the client as its section renders, and a `Reactivity` trigger tells its arrival. A server render builds no runtime, so it runs each Feature's `server` part instead, and loads nothing lazily.
- **Both bindings:** `WardicProvider`'s `features` and `strict`, `LazyWardic`, and `w`: `w.<tag>`, `w.create` and `w.createWard` / `use:w` on Solid 1, `w.<tag>`, `w.create` and `w.ward()` on Solid 2. The forms' shared code moved to each binding's `element.tsx`, so `wardic.tsx`, `createWard` and `ward()` are the only modules naming every Feature (`features/all.ts`), and `w.tsx` names none. A Complete element under a `strict` section throws in development (`DEV`, Solid's own flag, which a production build has as `undefined`). `Reorder` renders `w.<tag>` elements, so it renders under `strict`.
- **`colors`** (`features/colors.ts`): its Layer registers the colour spaces (ADR-0026, *Amendment (#511, colour spaces)*) and has its provider's interpolator registry `forget` the pairs it resolved before; its `server` part registers them too, as a server render's Appear rules read colours. A Slim element with a colour naming a wide-gamut space, while the page reads none, logs once per provider, in development and not while a lazy load is on its way, naming the import.
- **A Feature module's top-level calls are marked `/*#__PURE__*/`.** Without the marks, Rollup kept `registerSpaces` and every space's definition in a Slim element's app that never imported `colors`: the callback given to `Effect.sync` in the module's `Layer.effect(…)` was kept as reachable, though nothing of the module was emitted (1 KB gzipped). Annotating the module's two calls dropped it.
- **`bun run size`'s apps:** each binding's Slim element alone (`s1-slim`, `s2-slim`) and with `colors` (`s1-colors`, `s2-colors`); an app the base can't build, its API new, is reported as new and not gated.

| App, gzipped KB | Solid 1 | Solid 2 |
|---|---|---|
| Complete element (main → PR 2) | 167.0 → 161.9 | 203.3 → 198.2 |
| Slim element alone | 156.8 | 193.2 |
| Slim element with `colors` | 161.8 | 198.2 |

The mechanism adds 3.6 KB minified to every Wardic app (its registry, sections and `LazyWardic`), about 1 KB gzipped. The Slim element's base is still most of the binding: `layout` and the gestures are the next two PRs.

**`layout`** (PR 3 of #511, decision 15's second):
- **The projection system leaves the provider's runtime** for the `layout` Feature (`features/layout.ts`). Its Layer builds `ProjectionSystem.make` over the provider's flush gate, with the provider's reduced motion and scale correctors, which a `ProjectionOptions` service in the runtime carries. It's built once per provider, the first time an element whose section has it asks or a component brings it, in the Features' Scope, so it still ends before the gate.
- **Who makes layout nodes:** an element whose section has `layout`. Without it, its layout props (`layout`, `layoutId`, `layoutScroll`, `layoutRoot`) do nothing, and development says so once per provider. Its node is made as it mounts, its layout props being read once: an element mounted while `layout` is on its way gets none.
- **Who brings it** (decision 12): `LayoutGroup`, for its `layoutDependency`; each `Reorder.Item`, for its own node; `Reorder.Group`; `useLayoutMember` and `useWardicProjection`. `LayoutGroup` brings it for itself, not for its children: giving them a section would add a context Provider, and with it a level to every Solid 1 hydration key below (PR 2's SV15).
- **What works with it when it's there, and brings none,** refining decision 15's "the layout hooks bringing it":
  - every element's values registration (ADR-0012 *Amendment (#137)*);
  - the presence: its crossfades, hand-backs, kept leavers, take-overs' boxes and `presenceAffectsLayout`;
  - `animateLayout`, the Instant changes and the Projection reset.

  Each reads the provider's projection system as it's used, whichever section built it. Until then there's no layout node to act on, so `animateLayout` runs `fn` and settles, as during a server render. A hook that brought it would ship the projection system in an app that loads `layout` lazily. Without it, a popped leaver isn't kept where it was seen across a scroll (ADR-0048 *Amendment (#480)*), which is Motion's behaviour.
- **Two fixes:**
  - The providers' `animateLayout` read the projection system once, when the hook was called: one taken before the first layout element mounted would only ever run `fn`. It reads it at each call now.
  - PR 2's sections built the Features given at once only when something read them, and no element did: a `w.div` under `features={[colors]}` read no wide-gamut colour. Each element now reads its section's Features as it mounts.
- **Marks:** `ProjectionSystem.ts`'s class and `make` are marked `/*#__PURE__*/`, so a Slim app can import the module's key without the engine.

| App, gzipped KB | Solid 1 | Solid 2 |
|---|---|---|
| Slim element alone (PR 2 → PR 3) | 156.8 → 135.5 (−13.6%) | 193.2 → 171.8 (−11.1%) |
| Slim element with `layout` | 157.0 | 193.2 |
| Complete element | 161.9 → 161.9 | 198.2 → 198.2 |
| Complete element in `AnimatePresence` | 168.3 → 168.6 (+0.2%) | 204.9 → 205.2 (+0.1%) |

dom's share of a Slim app falls by 70.6 KB minified. The presence's view of the projection system, built to work without one, adds 0.7–0.9 KB minified to an app with `AnimatePresence`.

**The gestures and the presets** (PR 4 of #511, decision 15's third):
- **A Feature per gesture:** `hover`, `press` (its Keyboard presses included), `focus`, `inView`, `pan` and `drag` (`dragControls`, the constraints and the release's inertia included), each in its own module under `features/`. Each one's service is its gesture's start, which wraps core's `Recognizer.watch*`, `watchPressOn` or the drag track. An element looks it up in its section.
  - With the Feature, the gesture starts through it. Without it, its props do nothing, and development says so once per provider and gesture, naming the import.
  - So an element imports none of `Recognizer`, `press.ts`, dom's input or the drag track. (`Inertia` stays: a transition of `type: "inertia"`, ADR-0064, is an element's, so `retarget-legs.ts` reads its `restOf`.) It keeps the gesture layers, the drag defaults and `dragTransitionOf`, which a layout node's release also runs on.
- **A gesture Feature arriving lazily starts an element's gesture from then on,** unlike `layout`, whose node is made at the mount. Solid 1's recognizers start from a computation that reads the section's Features with the config; Solid 2's `startRecognizers` runs again when they change. A drag is still decided at the mount.
- **The input** (decision 14): `DomLive` no longer builds the DOM's `InputSource`, and `WardicServices` no longer requires one. Every gesture Feature but `inView`, which reads only the Probe, stands on one input Layer (`features/input.ts`): the Environment's `InputSource` when it gives one (`TestLive`, a test's pushed input), else `DomInput.layer`. It's one Layer, so a provider's `MemoMap` builds it once. A gesture Feature gives the input beside its service, so a section with one has it: a `Reorder` item's keys and `createDrag` run on it.
  - Asked at the build: should the same check, the Environment's service if it gives one, apply to every Feature? Not now: only the input needs it.
- **What brings what** (decision 12): each `Reorder` item brings `layout`, `drag` and every other gesture. Decision 12 named `layout` and `drag`. The rest let `whileHover` or `whileTap` on an item work as on Motion's, for about 0.5 KB gzipped beside the drag's, which already brings `Recognizer` and the input; #511's tests caught a `Reorder` item's `whileHover` going quiet without them. `createHover`, `createPress`, `createFocus`, `createDrag` and Solid 1's `runDragTrack` bring their gesture's Feature. `createInView` reads only the Probe, so it brings none.
- **The presets:** `domAnimation` is `hover`, `press`, `focus` and `inView`, as Motion's is. `domMax` is every Feature, `colors` and `layout` included: the Complete element's list.
- **Still DOM-bound:** dom's `auto-scroll` reads the held scroll shift only the DOM's input fills, so under another `InputSource` a held drag's auto-scroll doesn't follow the page's scroll.

| App, gzipped KB | Solid 1 | Solid 2 |
|---|---|---|
| Slim element alone (PR 3 → PR 4) | 135.5 → 121.7 (−10.1%) | 171.8 → 158.0 (−8.0%) |
| Slim element with `hover` | 128.1 | 164.5 |
| Slim element with `domAnimation` | 128.7 | 165.0 |
| Slim element with `drag` | 135.2 | 171.5 |
| Slim element with `domMax` = Complete element | 161.9 → 162.4 (+0.3%) | 198.2 → 198.9 (+0.4%) |

core's share of a Slim app falls by 23.6 KB minified (`Recognizer`, `Drag`, `Inertia`, `InputFeed`), the binding's by 10.2 and dom's by 8.0. The Complete element pays about 2 KB minified for the lookups, under the gate's 1%.

**The split's end** (PR 5 of #511, decision 15's fourth):
- **`/*#__PURE__*/` measured again.**
  - Every top-level call in core, dom and solid marked (319, by a script over the TypeScript AST) saved 1.2 KB gzipped on the Slim element's app, 2.6 on `hover`'s and 3.0 on `drag`'s. Before the split, the same marks saved 0.2 KB: the Complete element reached nearly everything they could have dropped.
  - Per package: core's marks gave most of it, solid's about 0.5 KB, and dom's nothing.
  - Diffing each app's source-map split with and without the marks found the modules they let Rollup drop: core's `Recognizer`, Effect's `RcRef` (through `SharedSource`), `PressClaims`, the stepper's option checks, and solid's `appear.ts` and `motion-props.ts`.
  - 22 marks in those six modules, each reviewed as a pure construction (`Effect.fnUntraced`, `Context.Reference`, `Match` and `Predicate` combinators, `new WeakMap`/`new Set`, `Arr.filter`, and the builders `stepOf` and `cachedResolver`), give all of it. They ship. The rest don't: they change nothing in an app.
- **The budget** (decision 10): the Slim element's base apps hold absolute budgets, 122 KB gzipped on Solid 1 and 159 on Solid 2, its sizes at the split's end with a little room. They're 121 and 157 since the build target moved (#525, ADR-0040), the same room over 119.4 and 154.9. Each was raised by 0.5 KB for #594's fix (a layout element's translate in `%`), and again for #618's checks on values no animation can take and a shared source's end (2026-11-05): 122 and 158, the gate's room kept until #518. `bun run size` fails an app past its own budget, whatever its base, so changes each under the +1% gate can't add up.
  - *Note (#618, 2026-11-05):* #618's dom PR (#622) merged unmeasured, 103 bytes past Solid 1's: a debug log's level read (+116) and a longer client-only error (+59). The budget stayed. The spine reads the level alone (`Report.debugKept`), so an app that logs nothing else ships no debug log, and the error is shorter: 124,914 of 124,928 bytes. CI doesn't run `bun run size`; a PR runs it before it's pushed.
  - *Note (#618, 2026-11-06):* Solid 1's budget is 122.5 KB. #618's M1, each element's Renderer read once by the provider and not through `runSync` as it mounts, costs 48 bytes in the Slim element, 3 past 122 (124,931 of 124,928); the rest of that PR saves 31. M1 makes the mount task 8.2% shorter on Solid 1 and 3.5% on Solid 2, and leaves a mount with its first frames flat (+0.6%, −0.4%): the work the reads ran moves into the first frame. Kept for the shorter task, with the budget raised (the user's call, 2026-11-06). Solid 2's stays at 158.
  - *Note (#618, 2026-11-06, PR 8):* Solid 2's budget is 158.5 KB. #618's API changes, breaking before 1.0, add 344 gzip bytes to Solid 2's Slim element, 225 past 158 (162,017 of 161,792), and 180 to Solid 1's, under its 122.5: a Measured pair split from its measurement (+81 on Solid 2), the Appear `<style>`'s `nonce` (+93, Solid 2's head tags), `springValues`' start bag and `Reorder.check`'s movement (+74), the `Option`s in core's input and drag options (+55), and the rest under 20 each. The bytes are the decided API's, and size comes after v1 (#518), so the budget was raised (the user's call, 2026-11-06).
  - Decision 10's 105 KB budget, "once it's reached", and Q4's target move to #518, after v1. Wardic's focuses are, in order: performance, dev-friendly APIs, and extensibility to every environment JS runs in. Size comes after them.

| App, gzipped KB | Solid 1 | Solid 2 |
|---|---|---|
| Complete element (#511 filed → the split's end) | 180.6 → 161.3 (−10.7%) | 216.9 → 197.7 (−8.9%) |
| Slim element alone (PR 2 → the split's end) | 156.8 → 120.5 (−23.2%) | 193.2 → 156.9 (−18.8%) |
| … with `hover` / `domAnimation` / `drag` | 125.5 / 127.4 / 132.2 | 162.0 / 163.8 / 168.6 |

## Consequences

- A new user's `wardic.*` app is the same size as before; the savings are for apps that move to `w.*`.
- Every Feature is code that must load on its own: what a Feature needs from the spine becomes the spine's seam for it, and the Complete element is the Slim element with every Feature registered.
- `effect-first.md`'s "`Schema` wherever values are decoded and encoded" changes with decision 9.
- A size change is held like a time change: `bun run size` beside `bench:core` and `bench:solid`.

## Amendment (#548, 2026-11-03): a module holds one Feature's code at most

**Found on #526.** The storefront moved to the Slim element, with a provider giving `[domAnimation, layout]` and three pages bringing `drag` through `LazyWardic`.
- **The JavaScript every page loads barely moved:** −4.3 KB gzipped on Solid 1.
- **Its shared chunk still held `drag`:** `Recognizer.ts`, `drag-track.ts`, `features/drag.ts`. Stubbing the pages that drag took it out (143 → 137 KB). A static import, an `import()` and the module's own path all gave the same result.

**Why.** Bundlers assign whole modules to chunks. A module that every page reaches, and that holds a Feature's code, puts that code on every page once any page uses it. Two places did that:
- **The binding's Feature modules** each held the key every element looks up (`DragGesture`, `HoverGesture`, …) beside the Feature's Layer, which imports its code (`drag-track`, the recognizers).
- **Core's `Recognizer.ts`** held every gesture's watch. The shell's hover and press put it on every page, and `watchDrag` with it.

The barrel wasn't the cause: the packages declare `"sideEffects": false`, and Rollup and Rolldown both trace an unused re-export away.

**Decided (#548's grill):**
1. **Core's drag and pan move to `DragRecognizer` (Q1).**
   - **The new module:** `@wardic/core/DragRecognizer` holds `drag`, `watchDrag`, `pan` and `watchPan`, their options, `WatchedDrag`, `PanSample`, and the pointer fold drag and pan share.
   - **`Recognizer` keeps** hover, press, focus and inView.
   - **Shared code:** what both build on (`watchFeed`, `streamOf`) is internal (`internal/watch.ts`), so neither module imports the other.
   - **A Tier 2 move for binding authors.**
   - Rejected: a module per gesture (most churn, for little more); `Drag.ts`, which code every page loads reaches.
2. **Every Feature's key in `features/keys.ts` (Q2).**
   - **The keys:** `HoverGesture`, `PressGesture`, `FocusGesture`, `InViewGesture`, `PanGesture`, `DragGesture` (with `DragRun`) and `Colors`. The element code imports them from there.
   - **Each `features/<name>.ts`** keeps its Feature and Layer, and imports its key.
   - **`layout`'s key** was already dom's `ProjectionSystem`.
   - Rejected: a key module per Feature.
3. **The rule (Q3): a module holds one Feature's code at most, and code every page needs never shares a module with a Feature's.** Applied across the binding, with the root exports' names unchanged:
   - **The Complete forms:** `COMPLETE` and the Complete `createWard` (Solid 1) or `ward()` (Solid 2) move to `complete.ts`, since they hold `ALL`. The spine every element shares no longer reaches every Feature, so a page with one `wardic.*` doesn't put them all on every page.
   - **`domAnimation` and `domMax`** are in `features/dom-animation.ts` and `features/dom-max.ts`.
   - **The gesture sensors** `createHover`, `createPress`, `createFocus` and `createDrag` each have a module per binding (`<gesture>-sensor.ts`), apart from `createReducedMotion` and `createPageInView`.
   - **`useWardicProjection`**, which brings `layout`, is in `layout-projection.ts` per binding, apart from the provider every page renders. The provider exports `fromWardicContext` for it.
   - Rejected: only the keys and `DragRecognizer`.
4. **`layout` too** (found discussing the keys, added as a commit of its own).
   - **Its key isn't in `keys.ts`.** It's dom's `ProjectionSystem` service, whose module held `make` beside the key, and `make` imports the engine.
   - **Two small values tied the engine's modules to code every page runs:**
     - the default layout transition, which the binding's layout element code reads, lived in `internal/projection.ts`;
     - `scrollersOf`, which the gesture input reads, lived in `internal/measure.ts` beside the Measure pass.
   - **The fix:**
     - the engine's `make` and `layer` move to `@wardic/dom/DomProjectionSystem` (ADR-0041, *Amendment (#548)*);
     - the default transitions move to `internal/projection-defaults.ts`;
     - the scroll reads move to `internal/scrollers.ts`, a per-frame file as `measure.ts` is.
   - **Measured:** a page beside one that lays out loaded the engine, about 17 KB gzipped (132.4 KB with the engine against 115.2 without, on Solid 1), until this fix.
5. **`bun run size` gains multi-route apps** (`s1-routes`, `s2-routes`; stated, not asked).
   - **Their shape:** a shell giving `domAnimation` with a hover, a plain page, a page that drags and a page that lays out, each an entry as SolidStart's routes are (`preserveEntrySignatures: "exports-only"`).
   - **Measured** as what the plain page loads: the app's chunk, the page's, and their static imports, each gzipped as it's fetched.
   - **Gated:** from here a Feature that reaches a page that never uses it fails the gate.

**Measured.**
- **`bun run size --base main`,** with the layout page in:
  - `s1-routes` 138.2 → 116.2 KB gzipped (−15.9%; dom −51.2 KB, core −6.3 KB and solid −7.2 KB minified);
  - `s2-routes` 164.4 → 142.3 (−13.4%);
  - before the `layout` fix, with only the drag page, they read 119.7 → 115.4 and 145.8 → 141.5;
  - every other app within ±0.1%, and the budgets held (120.4 of 121, 156.0 of 157).
- **#526's storefront conversion** on top (SolidStart 2, Vite 8 / Rolldown), the JavaScript a route loads on a fresh visit, against `main` with every element Complete:
  - a page that doesn't drag, 212.2 → 203.7 KB (Solid 1) and 267.4 → 259.0 (Solid 2);
  - a page that drags, 214.1 → 210.9 and 269.0 → 266.3, loading its own `drag` chunk;
  - with the conversion alone, before this amendment, a page that doesn't drag saved 4.3 KB.
- **A mutation that puts the `DragGesture` class back in `features/drag.ts`** returns `s1-routes` to 119.7. Against today's `main`, which has that shape, it reads +0.0%. Against a `main` with this amendment it's +3.7%, a failure.

## Amendment (#551, 2026-11-04): a drag starts when `drag` arrives

**Found on #526's lazy card.** Its room's pieces sat in a `LazyWardic` whose `features` loaded `drag` on a press. They mounted with the section, while the load was on its way, and never dragged. Development said nothing.

**Why.** Each binding decided an element's drag once, as it mounted ("A drag is still decided at the mount", PR 4 of #511 above):
- **Solid 1's mount effect** read its section's `DragGesture` once, untracked; so did **Solid 2's `mount`**.
- **The missing-Feature warning** is muted while a load is pending, and nothing looked again once it had arrived.

Hover, press, focus, inView and pan already started when their Feature arrived. Motion's elements do too: an `m.div drag` mounted before `LazyMotion`'s bundle loads gets drag at its next render (`updateFeatures`).

**Decided (#551; on #526, 2026-11-04).**
1. **A drag starts when `drag` arrives,** from then on, in both bindings, as a gesture does. Nothing before it is replayed: a pointer pressed while the load was on its way isn't taken up.
   - **Solid 1:** an element whose config wants a drag, mounted while a load is pending, watches its section's Features (a computation) and starts its track when `drag` is among them, under its mount's owner. What the track is made with is copied into the drag's own block first, so the closures there hold only those copies. A first shape, whose closure reached the mount's own variables, moved them into its context for every element: a hover-and-press element kept 0.8% more at rest (16.62 → 16.76 KB), back to +0.1% with the copies.
   - **Solid 2:** the same watch is an effect made with the ward, which starts the mounted element's track.
   - **The spine** reads the track at each Retarget (#340's takeover). Only an element whose `drag` was on its way as it mounted gets a getter for it: one that has `drag` at the mount, or never wants it, makes nothing new.
2. **A load that arrives without `drag`** gets development's missing-Feature warning then, once per provider, as one given at once does.
3. **`layout` stays decided at the mount.** An element mounted while it's on its way gets no node (the decision above): its node is made as it mounts, with the measurements taken before each change. `LazyWardic`'s docs now say so.

**Tests.** `FG5` (Solid 1) and `FGV6` (Solid 2): an element mounted while `drag` is on its way doesn't move under a drag on the pushed input, then drags once `drag` arrives; a load that brings only `hover` says nothing while it's on its way and warns once it's here. Both fail without the fix.

## Amendment (#582, #581, 2026-11-04): a layout node is made when `layout` arrives

**Found writing the Shipping less guide (#558).** An element with a layout prop that mounted while a lazy load was on its way got no layout node, even when the load brought `layout`: #551's decision 3 kept `layout` decided at the mount. When the load brought none, development said nothing. Everything inside `<LazyWardic features={() => import(…)}>` mounts while its load is on its way, so lazily loaded `layout` laid out nothing already on screen. Motion makes an element's projection node at any render where the Feature is loaded and the element has none (`useVisualElement`), so an `m.div layout` mounted before `LazyMotion`'s bundle lands gets one once it has.

**Grilled on #582: A.** The rejected options:
- **B. Keep the rule, and warn either way** when the load lands: lazily loaded `layout` would stay useless for what's on screen.
- **C. Warn only when the load lacks `layout`,** the bug as filed.

**Decided.**
1. **An element's layout node is made when `layout` arrives,** in both bindings, as a drag's track is (#551). It registers then, is measured by the next pass, and animates its layout changes from then on; nothing before is replayed. A child that took over from a leaver at its mount (#286) doesn't start from the leaver's box, which was its mount's.
   - **Solid 1:** an element mounted while a load is pending watches its section's Features (a computation) and makes its node under its mount's owner. What the node is made with is copied into the layout block first, so its closures hold only those copies (#551's lesson).
   - **Solid 2:** an effect made with the ward makes the mounted element's node. An element that mounts after `layout` arrived, but whose ward read none at its setup, makes its node at the mount.
2. **A load that arrives without `layout`** gets development's missing-Feature warning then, once per provider, as one given at once does.
3. **A drag drives the layout node its element has as its track is made:** at the mount, or as `drag` arrives. `drag` and `layout` from one load make the node first, so the element drags through it, as one that had both at its mount does. A track made before `layout` arrived keeps moving `x`/`y`, drawn over the node (#363): the gesture's state is the track's, and switching it mid-gesture would end a projection's drag that never started. The spine reads `projected` where it uses it, through a getter only for an element whose `drag` was on its way, as it reads the track.
4. **The missing-Feature warning names the Feature and where to add it, and stops there (#581).** It ended "or use a `wardic.*` element, which has every Feature", which a `strict` section makes an error in development, and which is the heavy way round the Feature the warning is there to name.

**Tests** (`features-layout.browser.test.tsx`, Solid 1, and its `v2/` twin):
- **FL1 / FLV1:** the warning no longer names a Complete element.
- **FL7 / FLV7:** an element mounted while `layout` is on its way animates its layout change once it's here.
- **FL8 / FLV8:** a load that lands with only `hover` says nothing while it's on its way, and warns once, for two elements, when it lands.
- **FL9 / FLV9:** `drag` and `layout` from one load: an element mounted while they're on their way follows a pushed drag, and lands where one that had both at its mount does.
- All eight fail without the fix.

**Measured** (`bench:solid`, head against `main`, 1,000 elements, Chromium; every gate passes):
- **Solid 1:** warm mount +0.0%, Retarget −0.7%, unmount +1.2%; allocated +0.3% per element; kept at rest +0.1% (hover and press 16.62 → 16.63 KB, a Reorder item 27.88 → 27.89); the layout scenes within noise.
- **Solid 2:** warm mount −3.6%, unmount −0.4%; allocated −0.1%; kept at rest −0.2% (16.14 → 16.08 KB) and +0.3% for a Reorder item (26.19 → 26.26).
- **A first shape** gave Solid 2's mounted record a getter for its node (`get layout()`). A getter of its own on every record gave each record a shape of its own: an element kept 2.7% more at rest (16.13 → 16.56 KB), and its unmount ran 4.9% slower. The node is a plain field of the record, which the late path writes.

## Amendment (#618, 2026-11-06): the docs lead with `w.*`

Decision 2 kept `wardic.*` as Motion's `motion`, and rejected "Slim by default". The docs went the other way: the landing page, the README, Why Wardic, the start pages and the examples lead with `w.*` and the Features a provider gives (the storefront's elements are all `w.*`), since a page should ship only the Features it uses, and a `wardic.*` element brings about 40 KB gzipped more than a `w.div`. The review of 2026-11-05 found the two disagreeing, and chose the docs.

**Decided.**
1. **The docs lead with `w.*`,** under a provider given its Features. This supersedes "Rejected: Slim by default" for what Wardic teaches; an app still names no Feature it doesn't use, and `domAnimation` covers hover, press, focus and in-view.
2. **The API keeps both.** `wardic.*` stays the exact equivalent of Motion's `motion`, every Feature built in, for trying something out; under a `strict` provider or a `LazyWardic` it throws in development, so none reaches a page by accident.
3. **Every line that maps `motion.div` to `w.div` adds "with the Features its provider gives",** as the Motion page's table does: the README, the landing page, Why Wardic and the Motion page's opening.

## Amendment (#518, 2026-11-06): measured as an app ships, and what's left of the base

**Found measuring again for #518.** `bun run size` built each single-entry app in Vite's lib mode. For an ES library, Vite keeps the whitespace (`minifyWhitespace: false`), so annotations reach the bundlers downstream; the bundles it gated were indented code. Built as an app ships, the routes apps' way (#548), the same sources read:

| App, gzipped KB | lib mode | as an app ships |
|---|---|---|
| Slim element, Solid 1 | 122.5 | 103.9 |
| Slim element, Solid 2 | 158.6 | 132.3 |
| Complete element, Solid 1 | 164.7 | 140.0 |
| Complete element, Solid 2 | 200.8 | 168.7 |

So decision 4's target, about 105 KB on Solid 1, was met. `main` was a few bytes past both budgets.

**Grilled 2026-11-06 (#518).**
1. **`bun run size` builds every app as it ships (Q1: A).** One app build for the single-entry apps and the routes apps. The budgets move to the shipped sizes with the same 0.5 KB of room, and the sizes the docs give are measured again.
   - Rejected: bundling each package's `dist` (both sides need a package build, minutes for each run); keeping lib mode with a note.
2. **The frame loop's metrics are a Layer an app gives (Q2: A).** Without it the loop builds and updates none (−1.2 KB gzipped). The spans stay: they open only with a tracer installed, and Effect's runtime keeps `Tracer`, `Formatter` and `Hex` anyway (−0.2 KB more). Rejected: metrics always on; no metrics.
3. **One fan-out of Wardic's own (Q3: A, if the benches hold)** under `Clock.ticks`, `SharedSource` and the DOM's scroll containers, as `InputFeed.byTarget` shares a target's input (#318): a list of subscribers and a count, each subscriber's Stream a `Stream.callback`. No `PubSub`, `RcMap` or `RcRef` (−4.1 KB on both bindings, prototyped). The Streams are unchanged; `SharedSource`'s `idleTimeToLive`, which no caller passes, goes. Reverses the review of 2026-11-05's decision 6 (Effect's own sharing) and M7 (`RcMap` for the scroll containers). Rejected: keeping them; the scroll containers alone.
4. **The base reads sRGB colours with Wardic's own parser (Q4: A),** the colour names kept, pinned against culori by a seeded test as #156's blend is. culori stays behind `colors` and the other spaces' interpolators (about −3 KB). Refines decision 5. Rejected: the names behind `colors` too, as Motion has none (about −4.5, but `"white"` to `"black"` would jump); culori in the base.
5. **The Probe's `scroll` becomes the `scroll` Feature (Q5: A)**, built over the Environment's scroll service if it gives one, else the DOM's, as decision 14's input is, and brought by `useScroll` (decision 12). App code is unchanged (−1.7 KB). Rejected: an `import()` inside the DOM's Probe; keeping it.
6. **`wardic.*` keeps every Feature from its first frame (Q6: B).** Loading a Feature the first time an element needs it was #518's lever 4, possible since #551 and #582. Rejected: what an element did before its chunk arrived would be missed (a hover, an `oklch()` animation at mount, a layout change in the mount's own task). Decision 2 stands; the Slim element is how an app ships less.
7. **The three breaks land before 1.0.0 (Q7: A):** decision 2's Layer, 3's `idleTimeToLive` and 5's `Probe.scroll`, in Tier 2 (ADR-0008). The rest may follow in 1.1.
8. **The budgets ratchet (Q8: A).** Each #518 PR lowers them to its own size with 0.5 KB of room. No new target.

**Not levers.** The atoms: `Atom` is the type of every Live value and of the Probe's fields (ADR-0043), and Effect's `SubscriptionRef` has no derivation. `Duration`: `SharedSource` imports only its type, and Effect's runtime, `Atom` and `Stream` reach it. Effect's runtime itself (ADR-0030).

**By this ADR's #548 rule** (a module holds one Feature's code at most): `layout-member.ts`, the gesture callbacks' builder and the drag transition move behind their Features. `Inertia` stays (a `type: "inertia"` transition is an element's, decision 2), and so does the Appear Handoff (under 1 KB, and a forgotten Feature would replay every entrance on hydration).

**Built.**
- **`bun run size`** (`packages/solid/bench/size.ts`): one `appSizeOf` for every app, its entry and pages built as SolidStart builds a client (`preserveEntrySignatures: "exports-only"`), measured as what its first page loads. Budgets 104.4 KB on Solid 1 and 132.8 on Solid 2. The figures in *Features*, *Why Wardic* and `wardic.*`'s reference are measured again: over the Slim element alone, `hover` 4 KB, `press`, `focus` and `inView` after it 2, `drag` after `domAnimation` 6, `layout` 20, `colors` 4, and every Feature 36.
- **Solid 2's client bundles drop the server render's code.** Its provider chose its context with `Bool.match(isServer, …)`, and a bundler folds `isServer` only in a literal test, so every client app carried the server render's (its Appear sampler and server context). A plain `if`, as Solid 1's provider has, gives the Slim element's app 132.3 → 123.9 KB gzipped (−6.3%), and every Solid 2 app 5–6% less; Solid 1's are unchanged. The same shape moved in the Live values' accessor and a `Reorder` item's internals, and `effect-first.md` gains the rule, which `bun run lint` holds: a build-time flag (`isServer`, `DEV`) is tested in a plain `if` or `&&`, never through `Bool`. Solid 2's budget 124.4 KB.
