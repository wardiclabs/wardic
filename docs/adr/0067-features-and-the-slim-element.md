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
  - So an element imports none of `Recognizer`, `press.ts`, dom's input, the drag track or `Inertia`. It keeps the gesture layers, the drag defaults and `dragTransitionOf`, which a layout node's release also runs on.
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

## Consequences

- A new user's `wardic.*` app is the same size as before; the savings are for apps that move to `w.*`.
- Every Feature is code that must load on its own: what a Feature needs from the spine becomes the spine's seam for it, and the Complete element is the Slim element with every Feature registered.
- `effect-first.md`'s "`Schema` wherever values are decoded and encoded" changes with decision 9.
- A size change is held like a time change: `bun run size` beside `bench:core` and `bench:solid`.
