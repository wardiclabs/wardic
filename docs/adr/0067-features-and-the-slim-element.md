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

## Built

**`bun run size`** (`packages/solid/bench/size.ts`, PR 1 of #511):
- **The apps:** each binding's plain Solid app, one Complete element, and the same inside `<AnimatePresence>`. The Slim element's apps (its base, each Feature alone, `domAnimation`, `domMax`) join them with the Feature split.
- **Each side built as an app ships it,** as `bench:solid`'s pages are. The build code they share moved to `sides.ts`. Size copies each package's manifest beside its sources, and the resolver hands Rollup the package's `sideEffects`, as Vite's own resolver does for an installed package. Without that, the complete app read 190.1 KB instead of 180.6: Rollup assumes a module a plugin resolves has side effects. `bench:solid` builds its pages as before.
- **Gate:** an app fails when its gzip grows more than 1% over the base's; exit 1. Sizes are deterministic, so it runs in seconds, with no reps and no quiet host. A 6 KB string logged from dom's entry failed every Wardic app (+2.5% to +2.9%).

**`/*#__PURE__*/` annotations**, measured and not shipped: all 227 top-level calls in the three packages' sources, annotated, saved 0.2 KB gzipped (−0.1%), and added 1 KB minified, since esbuild keeps the comments for downstream bundlers. The Complete element's path reaches nearly everything it imports. Measured again after the Feature split, when a Slim element's app imports modules most of whose exports it won't use.

## Consequences

- A new user's `wardic.*` app is the same size as before; the savings are for apps that move to `w.*`.
- Every Feature is code that must load on its own: what a Feature needs from the spine becomes the spine's seam for it, and the Complete element is the Slim element with every Feature registered.
- `effect-first.md`'s "`Schema` wherever values are decoded and encoded" changes with decision 9.
- A size change is held like a time change: `bun run size` beside `bench:core` and `bench:solid`.
