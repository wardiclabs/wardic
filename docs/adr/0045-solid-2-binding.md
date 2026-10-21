# The Solid 2 binding: `@wardic/solid/unstable/v2`, a ward that's a ref carrying its props, on the Solid 1 binding's spine

#209 gives Wardic a binding for Solid 2.0, still a release candidate (`solid-js@2.0.0-rc.15`), beside the Solid 1 one. It lives inside `@wardic/solid` under `unstable/v2`, as Effect v4 shipped its unstable modules, and its API is redesigned around Solid 2's idioms. Its element primitive is `ward(config)`: a ref that carries its props, so a kept one spreads (`{...card}`) and any one can be given to `ref`. Motion's components stay: `wardic.<tag>`, `wardic.create`, and later `AnimatePresence`, `LayoutGroup` and `Reorder`.

It lands in five PRs. The first has the dev setup, `WardicProvider`, `ward()`, `wardic.*` with variants and `.Provider`, and Solid 2's batching against the gate. Then presence and layout (2); gestures, Reorder, sensors and Live-value helpers (3, in two: see *PR 3a* and *PR 3b*); SSR and Appear animations on `@solidjs/web` streaming with `<Loading>`, plus a start-mode example app (4); and the layout lab on Solid 2 (5).

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
10. **On a server** a ward renders its Starting style and attributes, and builds nothing, as ADR-0021 has it. No Appear animation yet: `@solidjs/web` has no `useAssets`, PR 4's subject (see *PR 4a*).

## Consequences

- **What PR 1 leaves out:** presence, layout and `layoutId` (PR 2); `whileHover`/`whileTap`/`whileFocus`/`whileInView`, drag, Reorder, sensors, `createTransform`/`createSpring` and the other Live-value helpers (PR 3); Appear animations and hydration's Handoff (PR 4).
- **Answered in PR 3's grill (Q2):** a value derived from `read(key)` and given to another key's `style` paints a frame behind (measured: B following `a.read("x")` trails by 5 px at 300 px/s), since Solid 2 applies the accessor's change at its flush, after the gate's; following `a.atom("x")` paints in the same frame. So Wardic's own values carry their Atom through Solid (PR 3b): `read(key)`'s accessor carries the gate's Atom, the Live-value helpers derive on core's Atom helpers when given one, and a ward's `style` follows a carried Atom directly.
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

## PR 2: presence and layout

`<AnimatePresence>`, `<LayoutGroup>`, and a ward's `exit` and layout node (`layout`, `layoutId`, `layoutScroll`, `layoutRoot`, `layoutAnchor`, `layoutDependency`, the layout callbacks), on the Solid 1 binding's engine.

- **Shared, as the spine is:** presence's work moves into Solid-free `presence-controller.ts` (the retained node, its exit, the twins it hands back, a re-entry's interrupt); a layout node's registration and its options from a ward's config into `layout-member.ts`; the drag transition a node's Release offset runs on into `drag-transition.ts`. Each binding's `AnimatePresence` and `useLayoutMember` keep only their Solid: resolving the child, the tracking effect, the first render's end, the cleanup, the context. The Solid 1 binding's suites pass as they were.
- **`AnimatePresence` tells the controller what's present from an effect's apply,** which runs after Solid 2's flush has applied the change, the leaving node already removed. The controller puts it back before the flush ends, so no paint shows it gone (P1 checks it's connected right after the flush). `onSettled` ends its first render, for `initial={false}`.
- **A ward registers its exit record and its layout node at its mount,** in the effect's apply: neither makes a Solid primitive. What's reactive is made at setup: an effect keeps the record's `exit` current from the config (the presence reads it after the ward is gone), and one re-measures the node when `layoutDependency` changes. A layout node's Starting style is drawn through its projection at rest (#245), on a server and on the client.
- **`animateLayout` needs nothing of its own.** Its second measurement is a Measure pass on a microtask the call schedules after the callback returns, and Solid 2 queues its flush at the callback's first write, so the flush applies the change first (LY11).

### Pinned by (PR 2)

- `presence.browser.test.tsx` P1–P8: an exit on the retained node, none, a re-entry, a kept ward's exit, an `exit` changed while alive, `initial={false}`, a twin handed back, the presence unmounted mid-close.
- `layout.browser.test.tsx` LY1–LY11: a FLIP through `wardic.div` and through a kept ward, `LayoutGroup`'s reflow, a `layoutId` swap and crossfade, a lone `layoutId` exit, Layout modes, the callbacks, the `layout` transition key, a `layoutRoot`'s snap, `animateLayout`.
- `presence.browser.test.tsx` P9: a re-entry ends the running exit, its node gone at once.
- `layout.browser.test.tsx` LY12–LY16: a layout node's Starting style on the client, the projection owning its translate, `LayoutGroup`'s dependency as the only trigger, `layoutScroll`, `layoutAnchor={false}` (a child on a slower spring than its parent falls behind it).
- `server.ssr.test.tsx` SV9–SV10: a layout node's Starting style drawn at rest; `AnimatePresence initial={false}` on a server.
- **Mutations** (`.tmp/209/mut2.py`, in a worktree, against the v2 suites and, for the shared modules, the Solid 1 binding's presence and layout files): 24 of 25 caught. Six survived the first run, and P9 and LY12–LY16 now pin five of them. The one left, `layoutScroll` not forwarded, survives the Solid 1 binding's three scroll suites too: since ADR-0012's *Amendment (Reorder)* the fold reads any scrollable ancestor's scroll, and `layoutScroll` only has the node sample it at measure, which none of them tells apart.
- **`bun run bench:solid --base main`** (the Solid 1 binding on the shared modules, 11 paired reps, N = 1,000, warm; head / base): mount −0.2%, retarget +0.5%, rest retarget −1.1%, unmount −1.2%; bytes −0.4%. Every gate passes; the control reads −0.2%.

## PR 3a: gestures, drag, sensors, typed keys

Grilled 2026-10-20 (Q1–Q4, all A). PR 3 splits in two (Q3): this one has `whileHover`, `whileTap` and `whileDrag`, a ward's drag, the sensors, `fromAtom` and `streamToSignal`, and `read`/`atom` keys typed from the config. PR 3b has the Live-value helpers on carried Atoms (Q2) and Reorder.

- **Sensors are refs that are also their reading, as a ward is (Q1):** `const hovered = createHover()`, given to `ref` (alone or in a ref array beside a ward), and `hovered()` reads it. The `create*` names stay. Given another element, a sensor lets the first go and follows the new one. Disposed with its owner, its recognizer ends. `createReducedMotion()` isn't a ref: it follows the Probe's preference through `fromAtom`. On a server a sensor reads its initial value and its ref does nothing.
- **`read(key)` and `atom(key)` keys are typed from the config (Q4):** the keys of `initial`, `animate`, `exit`, every variant, `whileHover`, `whileTap`, `whileDrag` and `style`, plus `x`/`y` for the drag's axis, complete. Any other string is accepted (`keyof … | (string & {})`). A transform key reads a `number`; any other reads the type the config gives it, or `undefined`. A config typed as a plain `WardConfig` completes every key. `ward<const C>` infers the config's literal type; the types are in Solid-free `ward-keys.ts`.
- **Shared, as the spine is:** the drag track moves into Solid-free `drag-track.ts`, run through a `run` each binding hands it for its one fiber (the Solid 1 binding's `runDragTrack` wraps it with `runScoped`); `createDrag`'s shaped recognizer into `drag-samples.ts`. The Solid 1 binding's suites pass as they were.
- **A ward's recognizers start when its config first wants them,** at mount or later, once a mount (#87, ADR-0040): an effect watches `whileHover`/`whileTap` being set. Their fibers and the drag track's are the mount's: a ward moved to another element ends them and drops its gesture state, so the new element doesn't start hovered.
- **Drag defaults (#36):** a kept ward's spread and `wardic.div` carry them in `style` and `draggable`, under the user's style, and a server renders them. A `wardic.create(Component)` wrap sets them on the element at mount too, since its component may pass neither on, as on the Solid 1 binding.
- **`whileFocus` and `whileInView` stay unwired,** as on the Solid 1 binding: accepted and kept off the element.

### Pinned by (PR 3a)

- `gestures.browser.test.tsx` GE1–GE5: `whileHover` on `wardic.div`, `whileTap` through a kept ward, neither recognizer started when not wanted, one started when set after mount (and not twice), a ward moved to another element leaving its gesture state and its first element's recognizer behind.
- `drag.browser.test.tsx` DG1–DG11: the follow, `whileDrag`, the axis lock, hard and elastic constraints, `dragSnapToOrigin`, `dragMomentum: false`, a `whileTap` `y` the drag moves staying where dropped (DG6b, ADR-0022), a layout drag through the projection, the defaults (by axis, under the user's style, through a spread and a wrap), a real-mouse flick (#139), a claiming `createDrag` refused and `claim: false` seeing the gesture, `dragPropagation` (#29).
- `sensors.browser.test.tsx` SN1–SN10: each sensor, beside a ward, `createDrag`'s `bounds` (SN5b), re-attached, disposed, reduced motion, `fromAtom`/`streamToSignal`, `createInView`.
- `server.ssr.test.tsx` SV11–SV12: drag defaults on a server; sensors reading their initial values.
- `ward-keys.ssr.test.tsx` WK1–WK5: the typed keys, checked by `typecheck:tests` (`expectTypeOf`) and read on a server render.
- **Mutations** (`.tmp/209/mut3.py`, in a worktree, against the v2 suites and, for the shared modules, the Solid 1 binding's drag and sensor files): all 35 caught. Three survived the first run. A moved ward's recognizer left running (GE5 entered the old element again while its recognizer still had it hovered, and a recognizer reports changes only: it now leaves first). `createDrag`'s `bounds` ignored (neither binding tested them: SN5b). And the drag track never run, which wasn't valid: it left a syntax error, so no test file imported and the script read it as a pass. The script now reports such a run as an error, and rewritten, the mutation is caught.
- **`bun run bench:solid --base main`** (the Solid 1 binding on the shared drag track, 11 paired reps, N = 1,000, warm; two runs, head / base): mount +0.3% / +0.1%, retarget +0.2% / +0.4%, rest retarget −0.4% / +0.8%, unmount −0.3% / +1.9%; bytes +0.2% / +0.6%. Both runs flagged the control as too noisy (−5.7%, −7.3%, IQRs past ±10%), as 11 of the box's last 15 runs did; no task moved in either.

## PR 3b: Live values on carried Atoms, and Reorder

Q2 from PR 3's grill (2026-10-20), and Reorder, grilled 2026-10-20 (R1, R2, both A).

- **An accessor can carry its Atom** (`live-style.ts`'s `carry`, shared): a `style` given one subscribes to the Atom in place of the accessor, so it's written where the Atom is set. On Solid 2 an accessor shows a change at Solid's flush, after the gate's write, so a value derived from a ward's would paint a frame late. Nothing on the Solid 1 binding carries one; its suites pass as they were.
- **`read(key)` carries an Atom**: the gate's output for the key while the gate holds it, else where the key rests, which is the user's style (Solid's), mirrored into an Atom of its own. LV1 pins it: B's `x` from A's `read("x")`, and an opacity mapped from it, paint in A's frame, every frame of a tween.
- **`fromAtom` carries its Atom too, and is the one bridge** (`bridge.ts`'s `followAtom`): every Atom the binding hands to Solid (a ward's `read`, each helper's, an app's own through `fromAtom`) becomes an accessor carrying it there, rather than three copies of the same signal-and-subscription. Measured (LV12, and LV1 with carrying turned off): followed through Solid, a value from a *derived* Atom (`read`'s, a helper's, an `Atom.map` of a ward's `atom(key)`) paints a frame late; a ward's raw `atom(key)` happened to keep up. Carried, both paint in the frame they're set. `fromAtom`'s Hydration hold (`serverValue` while hydrating) carries nothing, since until it has settled it doesn't read what its Atom holds.
- **The helpers derive on core's Atoms** (`live-value.ts`): `createSpring`, `createVelocity`, `createTime` and `createScroll` always, mirroring a plain accessor source into an Atom; `createTransform` when its source is an Atom or carries one, and in a memo, as Solid maps it, for a plain signal. Its function form tracks what the function reads of Solid besides its source: a change re-derives the Atom (LV2). Each returns an accessor carrying its Atom.
- **Two Solid 2 traps:**
  - A helper made inside JSX (`style={{ x: createSpring(x) }}`) runs in an effect, where Solid 2 makes no primitive (`PRIMITIVE_IN_EFFECT_CALLBACK`). Make them in a component's body.
  - `createScroll({ container: () => box })` with a ref variable: the effect's first compute runs before the ref is set, and a variable isn't a signal, so nothing would read it again. It reads its elements once the render has settled (`onSettled`).
- **A `style` Live value may read `undefined`** (a ward's `read(key)` for a key with no value): the key stays where it is, as the follower already did.
- **Reorder's factories are refs carrying their props (R1):** `reorderGroup(config)` (the config's `style` over `overflow-anchor: none`; given to `ref` alone it sets that on the element) and `reorderItem(list, config)`, which is a ward. `Reorder.Group` renders `wardic[as]` with the group in context; `Reorder.Item` finds it and calls the same factory, and throws outside one.
- **An item's own attributes go in its config (R2):** `reorderItem(list, { value, tabindex, "aria-describedby" })`. Its `tabindex` wins over the keyboard reorder's `0`, and its ids come before the instructions'. The keys are Solid 2's attribute spellings (`tabindex`, not `tabIndex`), as its JSX has them.
- **The ward takes a Reorder item's internals:** the per-gesture axis and samples for the drag track, the layout handle the group registers (released before the node is disposed), the raise while dragged, the keyboard lift (which turns `whileDrag` on), the base style (the item's `touch-action`), and a mount hook (its keys, blurs and presses, and the instructions' document).
- **The group flushes Solid right after the app's `onReorder`.** The controller keeps focus on a lifted item right after a reorder, since moving a focused node can blur it, and expects the DOM to have followed within the call, as Solid 1's synchronous updates have it. Without the flush, Solid 2's list moved the node after that, and Escape left focus on `<body>` (RK2).

### Pinned by (PR 3b)

- `live-values.browser.test.tsx` LV1–LV12: the same frame through `read` (ranges and function form) and through `fromAtom` of a derived Atom (LV12), a function form's own Solid reads, `createSpring` and colours, a plain signal's memo, `read` at rest, `createScroll` in the scroll's frame, a target's offsets, a container accessor, `createVelocity`, `createTime` ending with its owner, and a helper's run ending with its owner under a live provider.
- `server.ssr.test.tsx` SV13: the helpers on a server, and a style derived from another ward's `read` in the Starting style.
- `reorder.browser.test.tsx` RV1–RV14: the Solid 1 binding's Reorder cases with a real mouse, each through the components and the factories (tags, the Crossover's orders, a sibling's first frame, a row and a grid, the raise and the release, `touch-action` by axis and a cleared axis detected in the same flush, `overflow-anchor`, `whileDrag`, `list.move`, an app's own reorder, an item as a ward, the gesture's axis, the remount warning).
- `reorder-keyboard.browser.test.tsx` RK1–RK6: lift, step and drop, Escape and Enter, a blur, `keyboard: false`, the app's own `tabindex` and ids through props and through a kept item's config, `move` announcing.
- `reorder.ssr.test.tsx` RS1–RS5: Motion's server markup, `as` and styles, the factories, tab stops, `Reorder.Item` outside a group.
- **Mutations** (`.tmp/209/mut4.py`, in a worktree, against the v2 suites and, for `live-style.ts`, the Solid 1 binding's Live value files): 36 of 38 caught. The first run's seven survivors led to RV7's row (the controller detects nothing while the app gives an axis, so clearing a `"y"` on a column proved nothing; the Solid 1 binding's RO21 has the same blind spot), RV14, LV11, and a rewrite of one mutation that had left the settled gate in place. The two left only leak until the provider ends, which no behaviour shows: the old scroll container's subscriptions (closing its Scope already stops its Atoms) and an unmounted item's key and blur fibers (its driver's `dispose` already drops its value).
- **`bun run bench:solid --base main`** (the Solid 1 binding on the shared `live-style.ts`, 11 paired reps, N = 1,000, warm; head / base): mount +0.6%, retarget +0.9%, rest retarget +0.6%, unmount +0.4%; bytes −0.4%. The control was flagged as too noisy (−5.2%), as on most of the box's runs; no task moved. **`--live`** on main and on the branch (Wardic's own times, N elements following a Live value): mount 24.8 / 24.0 ms, set 0.30 / 0.30, frame 1.60 / 1.60, unmount 3.39 / 3.38: unchanged.


## PR 4a: Appear animations and hydration

Grilled 2026-10-20: Q1 A, PR 4 in two (4a the binding, 4b `examples/solid2-start` in start mode with the phone check). The head channel was asked about too (Solid Meta's `<Style>`, or `useHead`).

- **The head's `<style>` goes through Solid 2's head registry (`useHead`),** where Solid 1 had `useAssets`. The provider registers it on the server only, in `useHead`'s function form, which the server reads when it writes the head: after the shell has rendered, so every element's entry and timing is known (probed: a getter registered before two elements wrote both). An empty sheet registers no tag. A client never registers it, and leaves the server's in the head (probed through hydration and after).
  - **Not `@solidjs/meta`'s `<Style>`.** It's `useHead` with its text in a `createMemo` made at registration, so on a server it reads the sheet before the page has rendered and writes it empty (probed: `/**/` against `useHead`'s `/*a,b*/`). It would also be one more peer dependency, and the docs point libraries to `useHead`.
  - The registry writes a `style`'s text raw (probed: quotes and `>` untouched), so Solid 1's `innerHTML` isn't needed; the unsafe-text refusal (ADR-0044) still keeps a `</style>` out.
- **A late chunk's rules stream with it as a head patch.** A late element registers its own `useHead` (`ServerAppear.chunkCss`, read once its chunk has rendered). Solid's own `$df` appends the patch's `<style>` to the head in the step that places the chunk, so no `<style>` sits among the items and nothing needs adopting: `Appear.adoptChunks`, Solid 1's, isn't used. A chunk of kept wards alone brings its rules too (AR15), which Solid 1 couldn't: only `wardic.*` rendered a chunk's `<style>`.
- **What's late differs from Solid 1.** Solid 2 runs a `<Loading>` subtree's components in the shell pass and holds only the pending reads, so an element whose own component reads none of the pending data is the shell's, though its markup streams later: its rule and timing are in the head, and its CSS starts when its chunk is placed. Under a shell group's `when: "beforeChildren"`, such a child waits its whole delay from its landing. An element the data makes (a `<For>` over it, a `<Show when={data()}>`) is late, as in Solid 1 (AR14).
- **Shared, as the spine is:** an element's entry (`appearEntryOf(state, …)`, Solid 1's `serverAppearOf` with the state passed in) in `spine.ts`; `chunkCss()` beside `chunk()` in `appear.ts`. The Handoff is the spine's, unchanged: the client ward finds its Appear animation at mount while hydrating and hands its sink to `releasingAppear`.
- **Found by the hydration tests, both from PR 1:**
  - **Hydration ids.** A Solid 2 memo or effect takes its owner's next hydration id, and adopts the server's serialized value while hydrating. The binding makes them on the client only (a server ward is lean), so the client's keys missed the server's markup (`Unable to find DOM nodes for hydration key`). Each is made with `CLIENT_ONLY` (`{ transparent: true }`), which Solid 2 documents for "client-only memos with no server-rendered counterpart".
  - **A stagger on mount.** A Variant child's slot was snapshotted when its parent first computed its variant name, in the parent's setup, before any child had registered, so every child of a stagger on mount started at once (Solid 1 waits each child's delay). The snapshot is taken at the first slot read after a trigger now (SW-k). The Handoff hid it (it starts from the CSS's elapsed time); a reduced-motion snap showed it (AH9).
- **A test project of its own,** `vitest.hydrate-v2.config.ts`: a fixture rendered in Node with `@solidjs/web`'s server build (`renderToString` and `renderToStream`, their head through `onHead`), then hydrated in Chromium. The page is shared: each hydration resets `_$HY.done`, and a streamed run hides `_$HY.f` while its chunks land, as a page before its JS has none.

### Pinned by (PR 4a)

- `appear.ssr.test.tsx` AR1–AR16: the Solid 1 binding's AR cases on `@solidjs/web`, the hydration keys unchanged with Appear on (AR8, the provider's server-only registration takes no id), a late chunk's head patch (AR14), a chunk of kept wards (AR15), no `<style>` when nothing plays (AR16).
- `appear.hydrate.browser.test.tsx` AH1–AH12: every frame the machine through the Handoff (spring, tween, a late hydration, JS off, a stagger, `when`, a loop, reduced motion with and without a stagger, SVG attributes, a layout card, a streamed chunk), and hydration claiming the server's node (AH1).
- `stagger-when.browser.test.tsx` SW-k: a stagger on mount.
- **Mutations** (`.tmp/209/mut5.py`, in a worktree, against the v2 server, hydration and stagger suites and, for `appear.ts`, the Solid 1 binding's Appear tests): 17 of 21 caught. The four survivors were equivalent:
  - Two pointed at code that did nothing, now gone. Solid 1's `within` kept a chunk to one `<style>` node; on Solid 2 a nested late root's registration finds the batch written and adds no tag. A guard keeping a user's own `animation` over the Appear slot is redundant too: `Style.over` already puts the slot under the user's style.
  - The head tags' cache: Solid reads each registration once, so reading it afresh changes nothing in rc.15. It stays as a guard, since a second read would write the late entries in place of the shell's rules.
  - Snapshotting the stagger slots eagerly at a later trigger: `stale` starts true, so the first read still snapshots after registration, and at a later trigger every child is registered already.
- **`bun run bench:solid --base main`** (the Solid 1 binding on the shared modules, 11 paired reps, N = 1,000, warm; head / base): mount −0.9%, retarget +1.8%, rest retarget −0.5%, unmount −0.9%; bytes +0.3%; control −3.0%. Every gate passes.
- **`bun run bench:solid --v2`** on the branch and on main (Solid 2 / Solid 1, each run's own pairs): mount −12.5% / −12.2%, first frame −32.6% / −31.5%, retarget +8.7% / +10.7%, rest retarget +9.7% / +9.6%, unmount +29.0% / +31.2%. PR 4a moves none of them (the transparent computations and the lazy slots included). Against PR 1's figures (above), unmount has gone from +14.4% to about +30% and retarget a few points up since, over PRs 2 to 3b: not profiled yet.

## PR 4b: the start-mode example, and what it found

`examples/solid2-start`: `@solidjs/vite-plugin`'s start mode (3.0.0-next.50, on Vite 8) with streaming server rendering, the Solid 1 example's pages on the v2 binding, and their hand checks. Grilled with PR 4a (Q1 A).

- **Start mode with an authored entry pair.** `entry-server.tsx` streams `<Document><App /></Document>` and `entry-client.tsx` hydrates it; the document references its client entry itself, which the handler rewrites to the built file. File routes come from `filesystem-routing`'s `fileRoutes()` into `@solidjs/router` 2's `createRouter`, and a route module's `POST` is answered by a start-mode middleware (`createAPIHandler`), as the `fullstack` template wires it.
- **Solid 2 for the binding's source.** `@wardic/solid` ships TypeScript source whose `solid-js` resolves, from `packages/solid`, to Solid 1 (its own binding's peer). The example dedupes `solid-js`, `@solidjs/web` and `@solidjs/signals`, so the app's Solid 2 runs it, and maps `solid-js` to Solid 2's types for every importer, as `tsconfig.v2.json` does.
- **The hand checks are shared** (`examples/hand-checks`, `@wardic/example-hand-checks`): the `/ssr` hydration report, the `/appear` report and the save-log handler, moved from the Solid 1 example, plain DOM and Node. What each `/ssr` element should do stays each example's (`reportWhenHydrated(expected)`). Solid 2's `hydrate` holds its start until the server's shell has arrived (the script is async in the head), so the reports read the server's paint in the function `hydrate` calls.
- **Found by the example, in the binding:**
  - **A cached `wardic.<tag>` took a hydration id.** A tag's component is made on its first use, often inside a render, and cached for the module's life, and `dynamic()` makes a memo when it's called: under the render's owner that memo took an id, which a server pays on its first request only and a page on every load. Every later request's keys missed the page's. The cache now makes it under `runWithOwner(null)`. Rejected: `dynamic()`'s `{ static: true }`, which drops the memo too but, on a server, moves a pending child's read into the component's own body: the ward runs twice, a dead slot lands in the head, and the element turns late (AR14, probed).
  - **Client-only code took hydration ids.** Solid 2's `onSettled` takes a hydration id, and a server's takes the same one. Four client-only paths called it with no server counterpart, so every key after them missed: `AnimatePresence` (`/ssr` threw at its child), `runScoped` while hydrating (`useWardicFiber`, `streamToSignal`), `fromAtom` with a `serverValue` (so `createReducedMotion`), and `createScroll`. `onSettledClientOnly` is Solid 2's own `onSettled` (a tracked effect running the callback untracked) made `CLIENT_ONLY`. A tracked effect's declared options are only `name`, but it passes them to its node, as every computation does, which reads `transparent` (rc.15, dev and prod builds).
  - **A key miss on an element with a template doesn't throw.** Solid warns (`Hydration key miss`) and makes a detached copy, leaving the server's node on the page, so PR 4a's tests couldn't see one, and `AnimatePresence`'s first child had claimed its sibling's node. `diagnostics-setup.ts` fails any v2 browser or hydration test that logs one.
  - **Reactive reads Solid 2's dev build warns of** (`STRICT_READ_UNTRACKED`). The spine reads the variant context (its gates, its stagger, what it inherits) at the Retarget, in the ward effect's apply: one-time reads by design, since the compute is what re-runs it. The Retarget now runs untracked, saying so. A component's `ref` is read in its body (Solid 2 compiles it eagerly), a reactive read through spread props: `refsOf` reads it once, untracked. The same setup fails a test that logs one.
- **The reports' reduced motion.** A positional key snaps to its target under reduced motion (ADR-0029), and both reports took the snap for a fault: `/ssr` called each element with an `x` offset a FLASH, and `/appear` called a streamed item whose stagger delay ended on the Handoff's frame a step (half the runs at `hydrate=600`, on both examples' builds). The frames showed the CSS at the very end of its delay the frame before, and the engine drawing what the CSS would next. Neither counts now; opacity is still judged.

### Pinned by (PR 4b)

- `wardic.hydrate.browser.test.tsx`:
  - WH1–WH2: a `wardic.<tag>` whose component the server has made and the page makes, and the other way round. Both failed before.
  - KH1–KH12: every helper and component with a server branch (sensors, the Live-value helpers, `fromAtom`, `streamToSignal`, `useWardicFiber`, layout, presence, Reorder in both forms, a kept ward, `wardic.create`), each followed by a sibling component whose key follows its ids. KH1, KH4, KH5, KH6 and KH8 failed before.
- `diagnostics-setup.ts`, in the v2 browser and hydration projects: no hydration key miss and no `STRICT_READ_UNTRACKED`.
- **Mutations** (`.tmp/209/mut6.py`, in a worktree, on a green baseline): 8 of 8 caught. The cached tag made under the render (WH1–WH2); each client-only settle taking an id, at presence, `runScoped`, `fromAtom` and `createScroll`, and `onSettledClientOnly` without `transparent` (KH); the Retarget tracked (every stagger and variant test, through the diagnostics setup); the ref read tracked (the Reorder and wardic tests).
- **The example** (headless, Chromium and Firefox, its production build): `/ssr` 15/15 with motion and under reduced motion, its paint with JavaScript off, and its toggles, resize and keyboard reorder; `/appear` 17/17 at once, at `hydrate=300` and `1200`, under reduced motion (12 of 12 runs), with JavaScript off, and with the streamed chunk before and after the JS; no console warning on any page. The Solid 1 example on the shared checks: `/ssr` 14/14, `/appear` 17/17 (12 of 12 under reduced motion). By hand, on the production build over the tailnet (Windows, Chrome 155): `/ssr` 15/15; `/appear?hydrate=1500` and `/appear?data=300&hydrate=1500` 17/17 each, handed off mid-flight 11 ms after hydration started (1.7 s in).
- **`bun run bench:solid --v2`** (the Solid 2 page against the Solid 1 page, 11 paired reps, N = 1,000, warm; head / main):
  - Mount −2.8% / −12.9%, first frame −21.0% / −31.2%, retarget +9.4% / +10.6%, rest retarget +9.2% / +9.0%, unmount +26.5% / +26.6%.
  - The mount and first-frame gap is an artifact of main's page. `wardic.<tag>`'s `dynamic()` memo belonged to the first element that used the tag. The bench unmounts that element after its first round, so every later element read a disposed memo and linked nothing.
  - With the page reading `wardic.div` once in an owner that lives as long as the page, main measures what the head does: mount −2.5% / −2.9%, first frame −28.0% / −29.2%. An app whose first `wardic.<tag>` stays mounted paid this on main too.
  - Located by benching each change alone; neither the strict-read `untrack`s nor the client-only settle moved it. Two other hydration-safe forms of the tag, a `dynamic()` per element and a static one with a memo of its own, measured −2.2% and −2.3%. On plain Solid 2's production build, none of these forms differs by more than about 0.3 ms per 1,000 elements.
  - PRs 1 to 4a's mount figures (about −12%) were the same artifact.

## PR 5a: the layout lab on Solid 2, scenarios 1 to 10

Grilled 2026-10-20: one lab built two ways (Q1 A); PR 5 in two, 5a the build with scenarios 1 to 10 and free play, 5b scenarios 11 to 19 (Q2 A); and the Solid 2 scenarios write as a Solid 2 app writes, their expectations re-derived and any difference explained (Q3 A).

- **One lab, two builds.** `bun dev` builds `examples/layout-lab` on Solid 1, `bun dev:v2` on Solid 2 (`vite.v2.config.ts`, with `@wardic/solid`'s own Solid 2 compile, `vite.solid2.ts`). The UI, probes and judging are one source; each build picks its scenarios and binding through `package.json`'s `imports` (`#scenarios`, `#binding`) under a `solid2` condition, which Vite (`resolve.conditions`) and TypeScript (`customConditions`, `tsconfig.v2.json`) both resolve. One `WardicProvider` per page, as before.
  - Rejected: a second lab app (its UI duplicated and drifting); and Solid 2 scenarios as islands in the Solid 1 page, which is possible (Solid 1 delegates `$$click`, Solid 2 `_$$click`, so neither runs the other's handlers) but gives each island a runtime of its own, so the Clock-idle and held-frame readings wouldn't compare.
  - `vite.solid2.ts` now resolves `@solidjs/web` from `packages/solid` for every importer, as it did `solid-js`: an app outside the package gets the copy the binding imports. The Solid 2 build pre-bundles no Solid (a pre-bundled `@solidjs/web` would find Solid 1) and keeps its own pre-bundle cache, so both dev servers run at once.
  - The shared UI keeps to what both Solids have: `#binding` gives it the binding, `render`, `JSX` and `batch` (a call on Solid 2, which batches anyway), and `classOf` stands for `classList`, which Solid 2 dropped.
- **The scenarios keep Solid 1's ids, trigger paths and expectations.** Solid 2 applies a signal write at its flush, a microtask straight after the handler, observer or rAF callback that made it, still in the same task and before the Measure pass it queues: no expectation changed. s8's driver is a kept `ward`, its effect Solid 2's split one, run by the `flush()` the gate drains its Starting-style switches with (where Solid 1 runs it in the gate's `batch()`).
- **Found, and fixed here:**
  - **A Solid 2 layout node re-measured on every change of its config.** A Solid 2 effect applies on every re-run of its compute (its node doesn't compare values), and `() => cfg().layoutDependency` re-ran on any config change, a `style` among them. So a move with the dependency unchanged FLIPped, where Motion and Solid 1 paint it in place, and each change cost a Measure pass. The dependency is a memo now (`===`). Found by free play's content-only moves.
  - **Two reads Solid 2's dev build warns of, in the shared UI,** fixed for both builds: the frame stretch's first value read once, said so; and the timeline's mark and paint items read the run shown, where a kept item (`<For>` keeps one whose value stays) kept the times of the run it was made for.
  - **Scenario 10's boxes parted under a burst of Runs,** on both builds (found by hand): Run toggled A and, 150 ms later, B's second cell, and a Run cancels the growth still pending, so two Runs closer than that toggled A twice and B once. B's cell now follows A's side.
  - **Scenario 8's driver dot jumped under a burst** (asked about by hand): each Run mounts a new dot, its trigger, and the dot started from where the last Run's animation would end, so a Run mid-flight swapped the dot for one at the far end (137 px). The next dot now starts where the last one is painted (20.7 px at most a frame).
- **Logs record their binding** (`binding`, in the log and the saved file's name), and the header shows it.

### Pinned by (PR 5a)

- `layout.browser.test.tsx` LY17: a `style` move with `layoutDependency` unchanged paints in place, and a move with its change FLIPs. It fails without the memo.
- `drag-run.test.ts`, `Lab.log`: the log's `binding`, Solid 1's when not given.
- **The lab, headless** (`.tmp/209/lab`): every trigger scenario on both builds, cold and warm (Keep Clock warm), under both scheduler modes: clean, at its expected held frames, and the two builds alike; and free play's 30 timing × mutation × path combinations, identical on both. No console warning on either page.
- **By hand,** on the Solid 2 build (the user, Windows, Chrome 155): 15 runs of scenarios 1 to 10, all clean at their expected held frames, s7 in its four container modes; s10's two seeding passes, its step ratio 0.83. s7 ran one Measure pass, where its rationale says two: Solid 1 does too now (its logs of 15 to 17 October show two), so that changed on main since.
- Found on main, not by the binding: free play's first run after the other cards have run reads `wrong-origin`. Their results grow the cards above it, moving its box 20 px down the page with no size change, and the next layout change FLIPs from the box measured before (`originOffset` −19.9 px). A Motion parity question for the engine: #261.

## PR 5b: the layout lab on Solid 2, scenarios 11 to 19

Grilled 2026-10-20: scenario 14's Solid 2 card drives both Reorder forms, by a select (A). PR 5b changes no binding code: every scenario now runs on both builds.

- **Scenarios 11 to 19 on the v2 binding,** with Solid 1's ids, cells, controls and expectations. `onMount` becomes `onSettled`, whose cleanup is returned (a Solid 2 settle callback owns nothing, so an `onCleanup` in it has no owner); `batch` goes; each rationale says where Solid 2 applies its writes.
- **Scenario 14's form select:** Motion's components (`Reorder.Group` / `Reorder.Item`, the default, so runs compare with Solid 1's) or the binding's own factories (`reorderGroup` on a `<ul>`, `reorderItem` on each `<li>`, each made in a component's body). A factories run records it in its mode.
- **A ward's style derived from the ward itself.** s18's swipe card fades with its own `x`. Solid 1's `createWard` took the element's style after the ward was made; a Solid 2 ward takes its style in its config, which names an opacity made from the ward's own `read("x")`. So the config is an accessor naming the opacity once it's made: the ward reads its style when it renders and follows its Live values from its mount, both after the component's body, so the opacity still carries the ward's Atom ("same frame" passes). Motion makes the `x` value first (`useMotionValue`), so no cycle arises. A cleaner form for this is an API question left open.
- Solid 2's JSX types `aria-pressed` as an enumerated string, not a boolean (s19).
- **A Live-value run cut short by the cell's next gesture** (found by hand: a hover let go and entered again within 0.5 s) never lands, so it failed follows and returns, on both builds. The recorder now marks it `superseded`, and those two lines read "cut short by the next gesture, not judged", as for a run cut off at the time limit; the next run is judged on its own.

### Pinned by (PR 5b)

- **The lab, headless, on both builds** (`.tmp/209/lab`), judged by the cards' own lines and the lab's `boardChecksOf`, with no console warning on either page:
  - s11 to s13: 24 drags a build (both schedulers, cold and warm), s11 in reorder mode, s12's X at rest, s13's item with Z mid-drag and with the twin, its free box flung with momentum, without, and in bounds on the grid: every line passing.
  - s14: in the y list, x row and xy grid, a drag and a keyboard reorder each; components on both builds give the same orders, every line passing, focus kept, the same announcements; the factories the same on Solid 2; and in a scroll container on the CSS card (moved by C) and on the draggable card, on each form.
  - s15 and s16: every cell and toggle, 37 and 18 board runs, all passing; s17 in its rationale's sequence, the same verdicts (wrong-origin 30 px where it says so) and callbacks lines on both; s18 and s19: 9 and 8 Live-value runs, all passing, the swipe card in the same frame.
  - Every trigger scenario, now with s17 on Solid 2 too: clean at its expected held frames, cold and warm, under both scheduler modes, the two builds alike.
- **By hand,** on the Solid 2 build (the user, Windows, Chrome 155): 40 drag runs, 6 rest runs and 9 s17 runs as expected; 142 of 144 board runs, the other two the cut-short runs above.
