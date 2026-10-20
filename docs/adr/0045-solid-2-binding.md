# The Solid 2 binding: `@wardic/solid/unstable/v2`, a ward that's a ref carrying its props, on the Solid 1 binding's spine

#209 gives Wardic a binding for Solid 2.0, still a release candidate (`solid-js@2.0.0-rc.15`), beside the Solid 1 one. It lives inside `@wardic/solid` under `unstable/v2`, as Effect v4 shipped its unstable modules, and its API is redesigned around Solid 2's idioms. Its element primitive is `ward(config)`: a ref that carries its props, so a kept one spreads (`{...card}`) and any one can be given to `ref`. Motion's components stay: `wardic.<tag>`, `wardic.create`, and later `AnimatePresence`, `LayoutGroup` and `Reorder`.

It lands in five PRs. The first has the dev setup, `WardicProvider`, `ward()`, `wardic.*` with variants and `.Provider`, and Solid 2's batching against the gate. Then presence and layout (2); gestures, Reorder, sensors and Live-value helpers (3); SSR and Appear animations on `@solidjs/web` streaming with `<Loading>`, plus a start-mode example app (4); and the layout lab on Solid 2 (5).

## Why

- **Solid 2 changes what the Solid 1 binding stands on** (rc.15, `node_modules/solid-js-2/CHEATSHEET.md`):
  - `batch` is gone: updates batch on a microtask, `flush()` applies them now, and **a signal's read lags its write until the flush**;
  - an effect is `createEffect(compute, apply)`: the compute tracks, the apply runs side effects, **has no owner, and may not create a computation** (`PRIMITIVE_IN_EFFECT_CALLBACK`);
  - **writing a signal inside an owned scope throws** in dev, unless the signal sets `ownedWrite`;
  - `on`, `createComputed`, `from`, `splitProps`, `mergeProps`, `onMount` and `use:` directives are gone; a ref is a function or an array of them, and a directive is a ref factory;
  - a context is its own provider (`<Ctx value>`), and `JSX` comes from `@solidjs/web`.
- **So the Solid 1 binding can't run on Solid 2,** and Solid 2 isn't stable yet. Users moving to Solid 2 need a binding they can try now, and Wardic needs to learn Solid 2 before it's stable.

## Decisions (grilled 2026-10-20, Q1–Q9)

1. **`@wardic/solid/unstable/v2`, inside `@wardic/solid`, exempt from semver (Q1).** Solid-free modules are shared between the bindings by relative import; the rest is written for Solid 2 under `src/unstable/v2/`. Peers: `solid-js` `^1.9.13 || ^2.0.0-rc.15`, and an optional `@solidjs/web`.
   - Rejected: a separate package (two packages to keep in step, and a rename at graduation); `@wardic/solid/unstable` (it leaves no room for other unstable modules) and `unstable/solid2`.
2. **Graduation (Q2):** once Solid 2.0 is stable and this API has settled, one release makes `@wardic/solid` the Solid 2 binding, moves Solid 1 to `@wardic/solid/v1`, and drops `unstable/v2`. Every release ships both. `v1` goes at a later, announced major.
3. **The API is redesigned around Solid 2 (Q3),** not ported name for name: ref factories are the primary element API, and Live values are read where they're given.
4. **`ward(config)` returns a ref function carrying its props (Q4).** A kept ward spreads, its Starting style in server HTML (Solid 2's server writes a spread's props, and evaluates then discards a ref factory's call); given to `ref`, it's client-only. A kept ward also has `.read(key)` and `.atom(key)`. The user's own ref goes beside it (`ref={[card, mine]}`), and their style in its config (`ward({ style })`). See *Built* 1 and 2 for what building it changed.
5. **Motion's components stay (Q5):** `wardic.<tag>`, `wardic.create`, `AnimatePresence`, `LayoutGroup`, `Reorder.Group`/`Item` and `WardicProvider`, over the factories. Only the `use:` directives go.
6. **A ward is a context provider for its Variant children (Q6):** `<card.Provider>`. Rejected: finding the parent through the DOM, since the Starting style and Appear groups need the parent during render.
7. **Live values keep their meaning (Q7):** an uncalled accessor in `style` is the frame-exact path (followed through the gate); a called value is a resting value.
8. **Five PRs (Q8),** each a working slice with its tests, docs and a lab or example, as above.
9. **Exact RC pins in dev, `^2.0.0-rc.15` as the peer (Q9).** Each new Solid RC gets its own bump PR that runs the v2 suites; the README states the RC last tested.

## Built (PR 1)

Decided while building, from what Solid 2 does, measured with probes (`test/v2/probe*.browser.test.tsx`, not kept) and the compiler's output.

1. **A kept ward spreads; an inline `{...ward(config)}` throws.** Solid 2 runs a spread's expression again on every run of the element's props: `<div {...ward(c)} />` compiles to `spread(el, () => ward(c))`, and with other props to `spread(el, [() => ward(c), { … }])`. Both call it in the spread's render effect and again in its children insert, and again on every re-run. A ward remade each time animates nothing, and joins its parent's stagger registry each time.
   - The forms are `const card = ward(config)` made once (a component's body, a `<For>` callback, a root), then `<div {...card} />`; or `ref={ward(config)}`, whose expression runs once with the element's.
   - A ward that mounts an element another ward left in the same task throws, naming both forms (`REMADE`). A `ref={ward(…)}` in a parent's children runs where Solid tracks too, but makes the element and the ward together, so it's left alone: a guard on Solid's observer was tried and rejected for refusing it.
   - This narrows Q4: its `{...ward(config)}` is `{...card}`.
2. **`read(key)`, where the Solid 1 ward has `value(key)`.** A spread's type gives the element every property its object type has. `value: (key) => Accessor` fails `<li {...card}>` and `<input {...card}>`, whose `value` attribute is `string | number` (checked with `tsc` on `tsconfig.v2.json`). At runtime only `ref`, `style` and the Starting style's attributes are enumerable; `Provider`, `read` and `atom` aren't.
   - A ward called with anything but an element returns itself: Solid 2's `merge` reads a function source through a memo it calls with its previous value.
3. **The config is read once, or through an accessor (or getters, as a component's props are),** as the Solid 1 binding's is. **Its target is compared by value** (`spine.ts`'s `sameResolution`: each layer's values, the drag, the variant name): a `style` or `transition` change in the config doesn't Retarget, as Motion's `animateChanges` doesn't. A new variant name does, even to the same values. The Solid 1 binding still Retargets on any change of its config.
4. **The spine is shared.** Its Retarget, its returns to Base values, its Handoff and its Live-value follower move from `create-ward.tsx` into Solid-free `spine.ts`, which both bindings drive (`makeElementSpine`). The variant rules move into `variant-tree.ts`, the presence record into `presence-record.ts`, the runtime into `runtime.ts`, the config types into `config.ts`, the motion props into `motion-props.ts`.
   - `live-style.ts` and `element-style.ts` take the binding's Solid as a `Reactivity`: `untrack`, a trigger, and a watch of an accessor. `element-style.ts` keeps its state in plain variables, so it reads the same with Solid 2's lagging reads.
   - The Solid 1 binding's behaviour doesn't change: its suites pass as they were.
5. **A ward mounts in an effect.** Every primitive is made at setup, under the ward's owner. The ref, called during render (no owner, element not yet connected), sets the element; one effect, tracking the element, the target and the `when` gate, mounts it (registers it with the gate, builds its spine) in its apply and Retargets. The gate is a memo: an element with variants of its own reads its `when` off its config, and read straight from the effect it re-ran the effect, and Retargeted, on every change of the config (a mutation found it). A Live value's watch is a root made under the ward's owner (`reactivityIn(owner)`): Solid 2 disposes a root with the computation it's made in, and refuses one with no owner inside an apply.
6. **The variant node writes nothing a child reads from an effect.** Solid 2 orders effects' applies by graph height, and a write in one is read by the others' computes a pass later.
   - **Stagger slots** are plain fields, taken in the memo that computes the handed-down name, as it changes. Every Variant child reads that memo for its target, so the slots are taken before any child's Retarget.
   - **`beforeChildren`** compares the name handed down with the one the element last settled at (written from its frames, outside any flush), both read in the child's compute.
   - Its signals set `ownedWrite`: a child registers during setup.
7. **Batching:** the provider hands the gate `(apply) => { apply(); flush() }`.
8. **Two engine fixes,** found because Solid 2's effects run at its flush, not at the write:
   - core: the Frame loop counts whether a burst ends after its tick's `afterTick` hooks (ADR-0027 *Amendment (#209)*);
   - dom: the gate tells the keys held in the binding's `batch`, before any commit (ADR-0034 *Amendment (#209)*).
9. **`wardic.<tag>` and `wardic.create` render through one `dynamic()` component each** (`<Dynamic>` is deprecated in Solid 2), with `omit` and ref arrays. `wardic.create(Component)`'s ref-forwarding error is thrown from `onSettled`. `wardic` is a plain object: there's no directive to call.
10. **On a server** a ward renders its Starting style and attributes, and builds nothing, as ADR-0021 has it. No Appear animation yet: `@solidjs/web` has no `useAssets`, PR 4's subject.

## Consequences

- **What PR 1 leaves out:** presence, layout and `layoutId` (PR 2); `whileHover`/`whileTap`/`whileFocus`/`whileInView`, drag, Reorder, sensors, `createTransform`/`createSpring` and the other Live-value helpers (PR 3); Appear animations and hydration's Handoff (PR 4).
- **Open for PR 3:** whether a value derived from `read(key)` and given to another key's `style` still paints in the same frame (the Solid 1 binding's LF7). Solid 2 applies the accessor's change at its flush, after the gate's.
- **The dev setup:** both Solid majors under aliases (`solid-js-2`), a Vite plugin that compiles `src/unstable/v2` and `test/v2` with `@solidjs/babel-plugin` and resolves `solid-js` to Solid 2 for every importer (`vite.solid2.ts`), their own vitest projects (`v2-browser`, `v2-ssr`) and `tsconfig.v2.json`.
- **A future Solid 2 RC** can change any of the behaviour above; each RC bump runs the v2 suites (Q9).

## Pinned by

`packages/solid/test/v2/`:

- `provider.browser.test.tsx`: the runtime, the error outside a provider, disposal, `runScoped`.
- `ward.browser.test.tsx` W1–W8: a kept ward spread and a ward in a `<For>` callback (Starting style, animation), `ref={ward(…)}` alone and in an array, an accessor config Retargeting while a `style` change doesn't (W8: on a ward with variants of its own too), the keys a spread applies, an unmount ending its legs.
- `ward-tracked.browser.test.tsx` WT1: `{...ward(config)}` throws `REMADE` into `<Errored>`.
- `stagger-when.browser.test.tsx` SW-a–f (the Solid 1 binding's), SW-h (`beforeChildren` holds again at a second flip), SW-i (a reversed stagger's order at each flip), SW-j (a new name with the same values still Retargets, so `beforeChildren` releases).
- `variants.browser.test.tsx` V1–V3, VB1–VB5: names through a ward's `.Provider` and through `wardic.*`.
- `wardic.browser.test.tsx` WC1–WC10, WCC1–WCC3: the element, the merge policy, the proxy, tracked props, a reactive user style, `wardic.create(Component)`.
- `gate.browser.test.tsx` G1–G3 and `style-fallback.browser.test.tsx` F1–F9: Solid 2's batching against the gate; F9 is a one-frame take of a key the user's style sets.
- `spine.browser.test.tsx` SP1–SP7: string keys, a `var()` end, a return to `style`, a Live value, `read`, `onUpdate`, a transition change.
- `server.ssr.test.tsx` SV1–SV8: the server render.
- core `frame-loop.test.ts` and dom `gate.node.test.ts` GH4: the two engine fixes.
- **Mutations** (`.tmp/209/mut1.py`, in a worktree, each against the v2 browser and server suites and core's and dom's): 30 of 31 caught. The one left, `sameResolution` without its base layer, is equivalent in PR 1: with no gesture layer, the resolved values are the base's. W9 (a ward's spine left running at unmount) and S1 (`sameResolution` without the variant name) survived the first run, and W7 and SW-j now pin them; S1's survival also found the gate memo (*Built* 5), pinned by W8.

## Measured on the final code (PR 1)

On the bench server, after `wardic-quiet`, Chromium 147 headless.

- **`bun run bench:core --base main`** (11 paired reps, N = 1,000): every workload passes in Bun, Node and Chromium. The noise controls read Bun +0.1%, Node +0.4% and Chromium −0.5%, and Node's bytes per frame are unchanged. The Frame loop's change is one sum per tick.
- **`bun run bench:solid --base main`** (the Solid 1 binding, 11 paired reps, N = 1,000, warm; head / base, median [p25–p75]): mount +0.8% [−0.4, +1.6], retarget +1.3% [−1.4, +2.1], rest retarget +0.5% [−1.1, +1.8], unmount −1.2% [−1.8, −0.7]; bytes per element per round +2.1% [+1.3, +2.1] (176.9 → 180.6 KB). Every gate passes; the control reads −0.5%. The shared spine and the gate's two-pass flush cost the Solid 1 binding nothing measurable.
- **`bun run bench:solid --v2`** (new: the same N = 1,000 `wardic.div`s on the Solid 2 binding against the Solid 1 binding, both on this branch, 11 paired reps, warm, not gated; Solid 2 / Solid 1):

  | Task | Solid 1 | Solid 2 | Ratio |
  |---|---|---|---|
  | mount | 37.45 ms | 32.08 ms | −14.9% [−15.4, −13.6] |
  | first frame | 15.56 | 10.37 | −34.4% [−35.4, −33.1] |
  | retarget | 22.88 | 23.94 | +6.8% [+3.6, +7.6] |
  | rest retarget | 17.77 | 18.53 | +5.1% [+3.0, +5.9] |
  | unmount | 7.07 | 8.10 | +14.4% [+11.6, +17.0] |

  - **The first frame** is where every element's Starting-style switch runs in the binding's `batch`, then the keys held: Solid 2's apply-then-`flush()` costs a third less there than Solid 1's `batch`.
  - **A Retarget and an unmount cost more** on Solid 2. Not profiled yet: each Retarget per element is a memo compared by value, an effect's compute and its apply, where Solid 1 runs a memo and one `on` effect.
  - The Solid 2 page runs `flush()` inside each timed task, so a task holds the work its write causes, as a Solid 1 write does at once.

## Implementation (PR 1)

- `packages/solid/src/unstable/v2/`: `provider.tsx`, `ward.tsx`, `variant-node.ts`, `solid-reactivity.ts`, `wardic.tsx`, `index.ts`.
- Shared, Solid-free: `spine.ts`, `variant-tree.ts`, `presence-record.ts`, `runtime.ts`, `config.ts`, `motion-props.ts`, `reactivity.ts`; `live-style.ts` and `element-style.ts` on a `Reactivity`. The Solid 1 binding's instance is `solid-reactivity.ts`.
- The package exports `./unstable/v2`.
