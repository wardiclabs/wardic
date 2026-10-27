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

- *Note (#257's audit, 2026-10-21):* `<LayoutGroup>` returned `props.children` from its body, which reads them once: `<LayoutGroup>{open() ? a : b}</LayoutGroup>` never switched, on this binding (Solid 2 logged STRICT_READ_UNTRACKED) and on Solid 1's. Both now return `<>{props.children}</>`. Found by `eslint-plugin-solid`'s `v2-strict` `solid/reactivity`; pinned by LY18 and Solid 1's `layout-flip` test, each caught when the fix is reverted.
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
- **By hand,** on the Solid 2 build (the user, Windows, Chrome 155): 15 runs of scenarios 1 to 10, all clean at their expected held frames, s7 in its four container modes; s10's two seeding passes, its step ratio 0.83. s7 ran one Measure pass, where its rationale said two. That depends on the device pixel ratio, not on a change: #21's filter skips the engine ResizeObserver's first delivery for the new twin where it reports the box the pass measured (one pass at DPR 1 and 1.35), and lets it through where its rounding differs (two at DPR 2.79, the phone logs of 15 to 17 October). PR 5b's text says so.
- Found on main, not by the binding: free play's first run after the other cards have run reads `wrong-origin`. Their results grow the cards above it, moving its box 20 px down the page with no size change, and the next layout change FLIPs from the box measured before (`originOffset` −19.9 px). A Motion parity question for the engine: #261.
  *Note (#261, 2026-10-21):* fixed by the **Page-size refresh** (ADR-0018, *Amendment (#261)*): that run now reads clean on both builds.

## PR 5b: the layout lab on Solid 2, scenarios 11 to 19

Grilled 2026-10-20: scenario 14's Solid 2 card drives both Reorder forms, by a select (A). PR 5b changes no binding code: every scenario now runs on both builds.

- **Scenarios 11 to 19 on the v2 binding,** with Solid 1's ids, cells, controls and expectations. `onMount` becomes `onSettled`, whose cleanup is returned (a Solid 2 settle callback owns nothing, so an `onCleanup` in it has no owner); `batch` goes; each rationale says where Solid 2 applies its writes.
- **Scenario 14's form select:** Motion's components (`Reorder.Group` / `Reorder.Item`, the default, so runs compare with Solid 1's) or the binding's own factories (`reorderGroup` on a `<ul>`, `reorderItem` on each `<li>`, each made in a component's body). A factories run records it in its mode.
- **A ward's style derived from the ward itself.** s18's swipe card fades with its own `x`. Solid 1's `createWard` took the element's style after the ward was made; a Solid 2 ward takes its style in its config, which names an opacity made from the ward's own `read("x")`. So the config is an accessor naming the opacity once it's made: the ward reads its style when it renders and follows its Live values from its mount, both after the component's body, so the opacity still carries the ward's Atom ("same frame" passes). Motion makes the `x` value first (`useMotionValue`), so no cycle arises. A cleaner form for this is an API question: #264.
- Solid 2's JSX types `aria-pressed` as an enumerated string, not a boolean (s19).
- **A Live-value run cut short by the cell's next gesture** (found by hand: a hover let go and entered again within 0.5 s) never lands, so it failed follows and returns, on both builds. The recorder now marks it `superseded`, and those two lines read "cut short by the next gesture, not judged", as for a run cut off at the time limit; the next run is judged on its own.

### Pinned by (PR 5b)

- **The lab, headless, on both builds** (`.tmp/209/lab`), judged by the cards' own lines and the lab's `boardChecksOf`, with no console warning on either page:
  - s11 to s13: 24 drags a build (both schedulers, cold and warm), s11 in reorder mode, s12's X at rest, s13's item with Z mid-drag and with the twin, its free box flung with momentum, without, and in bounds on the grid: every line passing.
  - s14: in the y list, x row and xy grid, a drag and a keyboard reorder each; components on both builds give the same orders, every line passing, focus kept, the same announcements; the factories the same on Solid 2; and in a scroll container on the CSS card (moved by C) and on the draggable card, on each form.
  - s15 and s16: every cell and toggle, 37 and 18 board runs, all passing; s17 in its rationale's sequence, the same verdicts (wrong-origin 30 px where it says so) and callbacks lines on both; s18 and s19: 9 and 8 Live-value runs, all passing, the swipe card in the same frame.
  - Every trigger scenario, now with s17 on Solid 2 too: clean at its expected held frames, cold and warm, under both scheduler modes, the two builds alike.
- **By hand,** on the Solid 2 build (the user, Windows, Chrome 155): 40 drag runs, 6 rest runs and 9 s17 runs as expected; 142 of 144 board runs, the other two the cut-short runs above.

## Amendment (#259, 2026-10-21): a config read per key, and the Solid 2 page gated

`bench:solid --v2` showed the Solid 2 binding's unmount growing from +14% to about +30% against Solid 1's after PR 1, and its Retarget a few points up. Nothing had gated it: every PR ran `--base main`, which benched the Solid 1 page only.

**Found** (the bench server, N = 1,000, warm, `.tmp/259`):
- **One PR made the step.** `--v2 --head <merge>` at each Solid 2 merge, with page-v2 unchanged since PR 1. Solid 1's times are flat at every merge (unmount 7.0–7.1 ms, Retarget 22.5–22.8). The Solid 2 page's rose at PR 3a (#255): unmount 8.1 → 9.1 ms, rest Retarget 18.8 → 19.6. PR 4b's mount change is the artifact it fixed.
- **What in PR 3a.** Each element gained:
  - two "wants" memos (does the config have `whileHover` / `whileTap`?) and their effect;
  - three gesture signals linked into the target memo;
  - three resets at unmount.

  Each part was worth about 0.3 ms of unmount, and the memos most of rest Retarget's step: each re-ran on every config change.
- **Why every config change re-ran them:** the ward's config was an accessor of the whole object. `wardic.<tag>` built it with `motionToConfig`, a copy of every motion prop per call, and about five computations an element (the target memo, the "wants" memos, the variant node's stagger and transition) each called it. So an `animate` change rebuilt the config five times an element and re-ran every reader.

**Decided** (grilled 2026-10-21; Q3 after a discussion in which the user raised Solid's stores):
1. **Q1 A: `bench:solid --base` gates the Solid 2 page too,** head against base, by Solid 1's rules (times and bytes), skipped when a side has no Solid 2 binding. `--binding 1|2` runs one; the noise control runs either way. `--v2` stays the Solid 2 against Solid 1 report.
2. **Q2 A: fix the drift, and profile the rest of the unmount gap.** Anything structural there goes to its own issue.
3. **Q3: a config is read per key.** Each key is a value, or an accessor of it: a getter, a store's property (`ward(store)`), a component's prop (`ward(props)`), or a function, called as it's read.
   - **The callbacks** (`onUpdate`, the layout animation callbacks, `onReorder`) are functions as they are.
   - **A plain value is a constant,** as a literal prop is.
   - **`initial`, `drag` and its settings, and `layout` and its keys are read at setup,** as before; a Layout mode at each layout animation's start, as before (ADR-0009, *Amendment (#42)*).
   - **The whole config as an accessor (`ward(() => ({ … }))`) is refused,** with a message naming the per-key forms. A key's accessor derives state as the whole one did, and is read only where that key is. The user first liked the whole accessor for derived state, then chose this: Solid's signal style, with performance first.

**Built:**
- **`config-view.ts`:** a view per config kind (ward, Reorder group, Reorder item), a class whose prototype has a getter a key. Reading a key reads the source's key where it's read, so Solid tracks it alone, and calls a function there. Making one allocates no getters. Setup reads a plain copy, untracked (Solid 2's dev build flags a reactive read in a component body), and the mount runs untracked, as the Retarget does.
- **`wardic.<tag>`, `wardic.create` and `Reorder.Group` / `Reorder.Item` pass their props;** `motionToConfig` is no longer on the Solid 2 path. A Reorder item fixes its `layout` over its config as an accessor (its Layout mode, read at each start).
- **The gestures:** one signal for the three, so the target memo reads one; a ward disposed with its owner resets nothing (a remount still does); the recognizers' watch reads the two keys, with no memos.
- **The REMADE check** (PR 1) queued a microtask per element at unmount, about 0.25 ms an unmount of 1,000; one a task now clears a set.

**Measured** (`bench:solid --base main`, 11 paired reps, N = 1,000, warm; the Solid 2 page, head / base):

| | mount | Retarget | rest Retarget | unmount | bytes |
|---|---|---|---|---|---|
| per-key config + gestures | −3.3% | −10.5% | −14.6% | −6.0% | −3.3% |
| + the REMADE check batched | −1.7% | −15.2% | −13.8% | −8.8% | |

The Solid 1 page: every task within ±1%, bytes −0.5%. `--v2` (Solid 2 / Solid 1) after both: mount −3.3%, first frame −30.5%, Retarget −3.0%, rest Retarget −3.5%, unmount +13.8%. The Solid 2 binding is now as fast as Solid 1's or faster everywhere but unmount, which is back at PR 1's level (+13.7% to +14.4%).

**The rest of the unmount gap** (a CPU profile of the warm unmount task on both pages, `console.profile` around it, `.tmp/259/profile.ts`): Solid 2's own disposal (`disposeChildren`, `markDisposal`, `unlinkSubs`, about 1.7 ms against Solid 1's `cleanNode`, 1.2) and Effect's fiber interrupts (about 2.5 ms against 2.2). Both are per element and not the binding's code: no issue filed.

**A store as the config** (the bench page's 1,000 elements, each `ward(config)` over one store whose `animate` is replaced, `--v2`, 9 reps, the Solid 2 page's own times):
- **A shallow store is faster** (`createStore(config, { shallow: true })`, its values plain, replaced whole): it mounts in 33.5 ms against a deep store's 35.6, Retargets in 22.2 ms against 23.0, and rest-Retargets in 16.9 against 18.2. A deep store reads its values through proxies, key by key. Unmount is alike (7.7 ms).
- **A deep set works too** (`draft.animate.opacity = 1`, CK2). The README recommends the shallow store.

**Pinned by:**
- `test/v2/config-per-key.browser.test.tsx` CK1–CK9:
  - a key's accessor re-read alone (CK1);
  - a store, deep and shallow (CK2, CK2b);
  - props (CK3), getters (CK4), the callbacks (CK5), the keys read once (CK6);
  - the whole accessor refused for the ward and both Reorder factories (CK7);
  - `wardic.div` per key (CK8);
  - a Reorder item's Layout mode read at each start (CK9).
- `test/v2/ward-tracked.browser.test.tsx` WT2: an element a ward left takes a new ward in a later task.
- **Mutations:** 14 single-point mutations, all caught:
  - the view's call, callbacks, fixed values;
  - setup reading the live view;
  - the mount, the context read, both Reorder views tracked;
  - the guard, the gesture reset, the recognizers' watch;
  - an item's frozen layout;
  - the REMADE record never cleared or never kept.
- Every Solid 2 test and the lab's s14 and s18 rewritten per key.
- **The lab:** s15 on the Solid 2 build gains a **store config** cell, the style opacity cell's twin with its config a shallow store: Store style replaces the store's `style` (0.5 ↔ 0.8) and shows at once, and a hover (or a phone's tap) goes to 1 and back to the store's value. Its three board runs pass headless; every other card is unchanged on both builds.

## #257 item 1: an async config (2026-10-23)

Item 1's second and third parts: what a ward does while its config reads a pending async value, and whether a `<Loading>` that refetches disposes a ward mid-animation. Item 1's grill (ADR-0046) had covered only the ward's own async values.

**Probed first** (`.tmp/257-async/`): a ward whose `animate: () => ({ x: pos() })` read an async memo **never showed**.
- With no boundary, the page stayed blank. Under `<Loading>`, the region never showed.
- The cause: the setup copy of the config (`initialConfig`) read `animate` in the component's body, untracked. Solid links a pending node to the reader of an untracked read, re-running it once the node settles ("An untracked read of a pending node still re-runs its reader when the node settles", `read()` in `@solidjs/signals`). So the render that made the component ran again, made a new async memo, and pended again, for good.
- A refetch inside `<Loading>` doesn't dispose a ward: the same element, made once, its animation going on (AC2).
- An accessor returning a promise animated nothing: the promise was taken as an empty target.

**Grilled 2026-10-23:**
1. **A pending config holds the ward's region, as any pending read does (Q1: A).** The region shows once the config is in, and the ward plays from its Starting style to the fetched target. With no boundary, the root waits, and Solid warns, as for any async read. A refetch keeps the last target until the new one lands: Solid holds the previous value. Rejected: showing at once and moving when the data lands (B); an error (C).
2. **Keys read as it goes may pend; keys setup fixes must be ready (Q2: A).**
   - **May pend:** `animate`, `while*`, `transition`, `style`, `custom`.
   - **Must be ready:** any other key, such as `layout`, `drag` or `initial`. A pending one is an error naming it: "``ward(config): `layout` was still loading when the ward was made…``".
   - **`animate` is in both groups:** setup reads it only to tell whether it names variants. While it's pending, it names the ward's own variants if the ward has `variants`, and is a target of values otherwise.
   - **`initial={false}` with a pending `animate`** is an error, as the ward would start there.
   - Rejected: setup deferred until every key is in (B), and only `animate` allowed to pend (C).
3. **An accessor returning a promise is an error (Q3: A),** showing the async memo to use. An accessor is called at every read of its key, so a promise from one would fetch at each. Supporting it would fetch twice per ward when it's made (B), or put a memo per key on every ward (C).

**Built:**
- **`config-view.ts`:**
  - `setupOf(view)` reads the setup copy with no reader (`runWithOwner(null, …)`), so nothing re-runs, and untracked, which lifts the dev build's strict read of a component's body. A key whose read throws `NotReadyError` is left out and named.
  - A per-key accessor that returns a thenable is the Q3 error.
- **The ward:**
  - `configAtSetup` throws for a pending setup key, and gives a pending `animate` on a ward with `variants` an empty name list.
  - Its style, read where the element renders, also reads every key that was pending at setup, and its target, through one memo. That's what holds the region: Solid retries it when they land. A ward with nothing pending makes no memo.
  - That covers the reads made outside a tracking scope once the region shows: the Retarget's `transition`, and the `while*` checks that start recognizers at mount. A pending key read there would throw with no boundary to reach; held, they've all landed by then.
- **On a server,** the same errors are thrown before the read that waits. A pending key the ward reads as it goes is read again and throws, so the server waits and renders the component again: its region streams with its Appear rule to the fetched target (AR18).

**Pinned by:**
- `v2/async-config.browser.test.tsx` **AC1–AC8**:
  - the region held, then the entrance to the fetched target, the component made once;
  - a refetch holding the last target on the page, and one mid-animation keeping the ward;
  - no boundary, with Solid's warning;
  - a pending `style`, `transition` and `whileHover`;
  - setup keys, `initial={false}`, and a promise accessor, each in `<Errored>`;
  - a pending variant name followed by a Variant child (AC8), and, under a variant parent, a ward with a pending name taking no `initial` from the parent (AC9).
- `v2/appear.ssr.test.tsx` **AR18–AR19**.
- `test/v2/swallow.ts`: the `swallow` helper, moved out of `settled.browser.test.tsx` and shared.

**Mutation-checked:** twelve single-point mutations, eleven caught:
- the setup read only untracked (the render re-runs for good), or only with no reader (the dev build's strict read throws), or rethrowing a pending key (AC1–AC4);
- the setup keys unchecked, on a client or a server (AC5, AR19);
- a pending `animate` given no names (AC9, found surviving AC8 and pinned);
- `initial={false}` unchecked, on a client or a server (AC6, AR19);
- a promise accessor allowed (AC7);
- no region hold, or one on the target alone (AC1, AC3, AC4).

The twelfth counted a pending `while*` key as given, at the recognizers' mount-time check. It survived: the region hold covers the setup-time pending keys, so they've landed by mount. The guard was taken out.

## #257 item 5: a ward mounts in a user effect still (2026-10-23)

Item 5 asked whether a ward should mount, and start its Retargets, in `createRenderEffect`, which Solid 2's docs reserve for "renderer plumbing", rather than in `createEffect`, after the render queue. **Probed; Q1: A, no.**

- **The probe** (branch `probe/257-5-render-effect`, local and the bench server only):
  - **First frame:** a ward mounted by a `<Show>` painted its entrance's first step (opacity 0.08 of a 0.2 s tween) in the first frame after the mount both ways, in five runs of five. There's no earlier frame to win.
  - **`onSettled`:** both ways it saw the ref set, the element connected, and the Starting style in place.
  - **Suites:** the Solid 2 browser and hydration suites passed both ways (316 and 27).
  - **`bench:solid`, the Solid 2 page:** mount +0.7%, retarget −0.3%, restRetarget −0.1%, unmount −0.2%, and bytes per element −0.3%.
- **So the mount stays in a user effect.** It changes nothing anyone can see, and a user effect keeps the mount's work (registering with the gate, building the spine, starting fibers) out of Solid's render phase.

## #257 item 6: a Live value's watch stays an effect (2026-10-23)

Item 6 asked whether the follower's per-key watch (`solid-reactivity.ts`'s `watch`, a root and an effect a key) should be `createReaction`, which tracks once and reacts once. **Probed; Q1: A, no.**

- **What it took:** a reaction must be re-armed at each change, so the watch re-reads its accessor every time. It still needs its root under the ward's owner, so that `stop` and the ward's disposal end it, and a watch made inside an effect's apply works.
- **What it costs** (branch `probe/257-6-reaction`, local; `.tmp/257-6/`; Solid's production build, 1,000 elements each following a signal through `style`, median of 12 paired runs):

  | | effect (kept) | reaction |
  |---|---|---|
  | mount | 23.4 ms | 21.0 ms |
  | one update of the 1,000 watches | 1.50 ms | 2.50 ms (+67%) |
  | unmount | 6.2 ms | 6.2 ms |

- **So the watch stays an effect.** A Live value often moves every frame, so the update is the hot path, and the reaction's mount saving comes once per element.

## #257 item 12: `flush(fn)`, and `list.move` inside an action (2026-10-23)

Item 12 asked whether the binding's two `fn(); flush()` calls should be Solid 2's `flush(fn)`, which runs `fn` "in a synchronous flush scope" so its writes "bypass microtask scheduling and drain synchronously when the callback returns". It also asked whether that behaves the same inside an `action`. **Q1: A, both changes below.**

- **`flush(fn)` behaves the same** in both places: the full browser suite passed with it.
  - **The Reorder group's `onReorder`,** so the DOM follows a gesture's or a keyboard lift's reorder within the controller's call. That keeps focus on a lifted item: moving a focused node can blur it.
  - **The provider's `applyAndFlush`,** the gate's per-frame Starting-style switches (ADR-0034).
  - In each, `fn`'s writes no longer schedule a microtask that the flush drains early and that then fires with nothing to do.
- **Inside an action it doesn't work, nor did `fn(); flush()`.**
  - An app calling `list.move()` inside an `action` got Solid's `FLUSH_IN_ACTION` error ("flush() inside an action body is not allowed"), and the action rejected. On main, the order was written before the throw.
  - A gesture's or a keyboard reorder comes from an event handler, never an action. Only the app's `move` can run inside one, and nothing reads the DOM after it.
  - So `move` calls `onReorder` with no flush. Its DOM update lands at Solid's next flush, before the frame, and inside an action it's held with the action's other writes.
- **Rejected:** fixing `move` alone and keeping `fn(); flush()` (B); neither (C).

**Pinned by:** `v2/reorder.browser.test.tsx` **RV15**: `list.move` inside an action resolves, its order reaches `onReorder`, and the item flies to its place. It fails on main with `FLUSH_IN_ACTION`. RV10, a `move` outside one, still flies.

## #257 item 8: no native Atom tracking (2026-10-23)

Item 8 asked whether the binding should offer Solid 2's `enableExternalSource`. That's an adapter registered once for the whole app: Solid wraps every computation with it, and it lets Solid track a non-Solid reactive system's reads. With it, Solid would track Effect Atoms natively. **Probed first, at the user's ask; then Q1: A, no.** Every Atom handed to Solid keeps going through the one bridge, `followAtom` (`read(key)`, the Live-value helpers, `fromAtom`).

**The probe** (branch `probe/257-8-adapter`, local and the bench server only; `.tmp/257-8/`):
- **What it took.**
  - `AtomRegistry` has no read hook, so the adapter wrapped the registry's `get` to record the Atoms a computation reads while Solid tracks it, and subscribed to each to trigger it.
  - It needs Solid's `untrack` hook too, pausing the record. Without it, the ward's own Retarget, which reads the values it animates inside `untrack`, was tracked by its mount effect. That effect then re-ran every frame and restarted the animation, so the card never moved.
- **What it gives,** across 35 frames of a card moving:
  - `card.read("x")` in another element's `style`: on the card's frame in all 35.
  - An Atom read through the adapter in a `style`: a frame behind in all 35.
  - An Atom read through the adapter as JSX text: on the frame, as `fromAtom` or `read()` already are, since Solid's microtask flush lands before paint.
  - So it gains no timing: only writing `registry.get(atom)` where `fromAtom(atom)` is written today, and only for text.
- **What it costs,** on the `bench:solid` Solid 2 page (1,000 wards, with the adapter on and no Atom read through it), against main:

  | | Change |
  |---|---|
  | mount | +17.7% |
  | retarget | +5.6% |
  | restRetarget | +4.9% |
  | unmount | +23.6% |
  | bytes allocated per element | +3.2% |
  | heap kept per ward (production build) | about +2.4 KB, +24% |

  Three tasks fail the gate. The Solid 1 page, untouched, was flat. Solid wraps every computation with the adapter, so an app's own computations pay the same.
- **Solid's guide agrees:** "For a library with a `subscribe` method, the signal above is the smaller tool". Effect Atoms have one.

**Rejected:** an app opt-in with the cost documented (B), which buys only the shorter text read.

## #257 item 2: no projection API (2026-10-23)

Item 2 asked whether `createProjection`, Solid 2's derived store, should replace a ward's per-key accessors: `card.values.x` for `card.read("x")`. **Q1: A, no:** `read(key)` stays.

- **Why:** the same-frame rule (PR 3b). A value derived from a ward's paints in the ward's frame only on its Atom: `read(key)` gives an accessor that carries it, and a `style` given one follows the Atom, set where the gate writes. A projection's property is read through Solid, which shows a change at its flush, after the gate's write, so whatever is derived from `card.values.x` would paint a frame late. A property can't carry an Atom as an accessor does.
- **The issue's three internal uses stay probes, not API:** the resolved target compared by value (`sameResolution`) as a projection's diff, `live-style.ts`'s `split` / `reconcile` of the user's style, and Reorder's `values` indexed by value. Each is taken up only if a probe shows it's cheaper or simpler than what's there.
  - **The first was probed, and found #325.** A diff of changed keys was meant to tell the spine which keys to Retarget. It showed the spine restarted every key it resolved, where Motion keeps an unchanged key's animation running. The spine now compares each key's target against its running Leg's itself, so the diff wasn't needed, and `sameResolution` stays the target memo's equality (ADR-0005, *Amendment (#325)*).
  - **The other two were probed in #327, and neither is taken up:** see *Note (#327)*.

## #257 item 11: the copies into Atoms stay effects (2026-10-23)

Item 11 asked whether the two effects that copy a Solid value into an Atom should be derivations. Solid's guide *Avoid unnecessary effects* replaces an effect that copies one reactive value into another with a writable memo (`createSignal(fn)`) or a projection writing into its draft. **Q1: A, no change.**

- **The two copies:**
  - **`mirrorOf`** (`live-value.ts`): a plain accessor given to `createSpring`, `createVelocity` and the other helpers is copied into an Atom, as those helpers run on Atoms.
  - **`read(key)`'s resting mirror** (`ward.tsx`): where the key rests, its `style` value, is copied into an Atom, so `read` combines it with the gate's output in the same frame.
- **Why:** the guide's own rule says when an effect is right: "Does a settled reactive result need to leave Solid and drive an imperative system? Use an effect." Both copies write into an `AtomRegistry`, which Solid doesn't own. A writable memo or a projection gives another Solid value, so either would still need an effect to reach the Atom: the same mirror, with a Solid node in front of it.
- **The cost the guide names, a copy a step behind its source,** is known: the Atom gets the value at Solid's effect phase. That's why a value derived from a ward carries its Atom (`read` and the helpers), and only a plain accessor is mirrored (PR 3b's same-frame rule).
- **No probe:** the guide answers it. Rejected: a probe anyway (B), which could only measure a node added in front of the same effect.

## #257 item 10: streams stay fibers into signals (2026-10-23)

Item 10 asked whether the sensors and `streamToSignal` should be memos over `Stream.toAsyncIterableWith(stream, services)`, so that Solid owns their cancellation, in place of a fiber run into a signal. **Q1: A, no.** They keep their starting value, are never pending, and hold no update.

- **Why:** a probe built `createHover` that way (`.tmp/257-10/`). `loadingValue` answers only the memo's first flight. Each re-run after it, such as the ref attached or moved to another element, was pending until the stream's next value, and a hover stream's next value waits on the user. Moved to a second element with an unrelated `setCount(1)` in the same flush, it showed the first element's `true` and held the count's write at 0 for over 300 ms, until the second element was hovered. Solid treats a pending read as an unfinished update, and a sensor's next value isn't coming soon.
- **Rejected:** switching and giving each re-run a value at once (B), which fights the form it adopts and adds a promise hop per event on the gesture path; and adding an async `streamToSignal` for streams whose first value comes soon (C), which an app can already write as a memo over `toAsyncIterableWith`.
- The gesture-timing check the item asked for is moot.

## #257 item 13: hydration and held regions (2026-10-23)

Item 13 compared Solid 2's `onHydrationEnd`, `<Reveal>` and `isDisposed` with what the binding does. **Q1: A, no API change; the held regions are pinned by tests.**

- **`onHydrationEnd`** is "intended for test tooling and markers"; Solid's docs say to switch to a client-only value from `onSettled`. `fromAtom`'s Hydration hold and the Appear Handoff do that already.
- **An entrance in a region Solid holds plays once the region shows,** with nothing changed in Wardic:
  - On a client, a ward inside a `<Loading>` waiting on data is made at once, but isn't on the page until the data lands, and its entrance plays from then. One in a region `<Reveal>` holds plays at its reveal, not when its data lands.
  - On a server stream, a chunk `<Reveal>` holds arrives in an inert `<template>`, and its placement comes with the region ahead of it. The Appear animation starts at that placement (357 ms, against the chunk at 50 ms), and the Handoff reads the CSS animation's own `startTime`.
  - Solid holds the DOM, not Wardic, so tests pin it in case a Solid release changes it. AH13 fails with the fixture's `<Reveal>` taken out.
- **`isDisposed(owner)`** isn't used: no late callback has written into a disposed ward. Item 9's audit runs every suite with Solid's diagnostics failing a test.
- **Rejected:** `isDisposed` guards on the fibers' callbacks as defence (B), a check on per-event paths for nothing seen; and recording it with no tests (C).

**Pinned by:**
- `v2/held-regions.browser.test.tsx` **HR1** (a waiting `<Loading>`) and **HR2** (`<Reveal>`): not on the page before the region shows; the first frame on it near the start; moving; at rest.
- `v2/appear.hydrate.browser.test.tsx` **AH13**, on the fixture A9: the held element off the page between the two chunks; its CSS animation from the reveal; near 0 at first sight; through the Handoff to rest. `runStreamed` now lands each late write at its own time when given a list.

## #257 item 4: errors and `<Errored>` (2026-10-23)

The misuse errors reach `<Errored>` already. A failed animation now rejects `next("settled")`, throws from `settled()` and `each("settled")`, and clears at the next Retarget. A per-frame callback's run of throws is reported once. ADR-0046, *Amendment (#257 item 4)*; ADR-0030, *Amendment (#257 item 4)*.

## #257 item 7: writable Live values (2026-10-23)

No writable Live value: Solid's writable memo is a spring's target that's derived and set, and a ward's `read(key)` is the value a drag writes. `createSpring` gets Motion's `jump` and `skipInitialAnimation`, and a velocity reads 0 across a jump. ADR-0043, *Amendment (#257 item 7)*.

## #257 item 3: `reorderEnd` (2026-10-23)

The group's `next("reorderEnd")` / `each("reorderEnd")`, `Reorder.Group`'s `groupRef`, and the optimistic save pattern the probes found: an optimistic store written by the save, a writable memo of it written by the drag, a memo over `each` and an effect. ADR-0020, *Amendment (#257 item 3)*.

## #257 item 9: the diagnostics audit (2026-10-21)

#257 collects where the Solid 2 binding could lean on more of Solid 2. Item 9, the first taken, audits the binding against Solid 2's own tooling. It has three parts:
- every suite run with Solid 2's attribution engine on, recording every diagnostic code;
- `ownedWrite` taken off one signal at a time;
- `eslint-plugin-solid`'s Solid 2 rules.

**Found and fixed:**
- **`<LayoutGroup>` read its children once,** on both bindings: a conditional child never switched. The lint found it. Fixed in PR #268 (see *PR 2*'s note).
- **GE5, `EFFECT_WRITES_OWN_SOURCE`.**
  - **What it was:** a ward moved to another element reset its gesture state in its mount effect. The target memo reads that state, so the effect re-ran itself, and one frame showed the old gestures.
  - **Fixed by:** the state records the element it's on. The memo reads the layers of the element mounted now, so a ward on a new element reads none with nothing written.
- **RV7, `EFFECT_RELAY_TEAR`, on both Reorder forms.**
  - **What it was:** when the app cleared a group's `axis`, an effect ran the controller's detection, which wrote the detected-axis signal. The items' `touch-action` went through the last detected axis first, a step before the new one.
  - **Fixed by:** the group's axis is a memo. When the app's is cleared, it reads the controller's new `detect()`, the axis from the boxes the engine holds, reporting nothing, in the same flush.
  - **Changed in the dom API:** `ReorderController.resolve` is replaced by `detect`. The Solid 1 binding derives its axis the same way, though its synchronous updates never painted the stale step.
- **`ownedWrite`:**
  - **Unneeded on 12 of the 14 signals:** with it taken off each in turn, no suite wrote any of them in an owned scope. It's off them now, so Solid 2's dev build reports a new owned-scope write instead of the flag hiding it.
  - **Kept on two, each saying why:**
    - the variant node's unsettled count, which a Variant child writes as it registers in its own body;
    - a ward's `element`, for a ward called with its element in a component's body (WT2).

**Kept as a gate:**
- **The Solid 2 test projects' setup** (`test/v2/diagnostics-setup.ts`) turns attribution on and fails a test on every code Solid 2 reports. The timing and size heuristics are left out (`HOT_SCOPE_*`, fan-in and fan-out, `GRAPH_GROWTH`, the hold and waterfall verdicts), since a loaded machine moves them. Before the fixes it failed exactly GE5 and RV7 on both forms.
- **`eslint-plugin-solid` 0.18.1's `v2-strict` config** lints `src/unstable/v2` and `test/v2`. The plugin object is shared with the block that keeps the Solid 1 code's `solid/reactivity` directives quiet. Its four false positives in the source each carry a disable with the reason:
  - an accessor returned, by `followAtom` and the sensors;
  - an accessor handed to getters (a Reorder item's `describedBy`);
  - an early return on the constant `isServer` (`AnimatePresence`).

  Five never-written signals in the tests became plain accessors, and the sixth (the SSR smoke test's) is kept, with a disable that says why.

**Pinned by:**
- GE5 and RV7, under the enforced diagnostics.
- RV7 now also records every `touch-action` write as the axis clears: one, from `none` straight to the detected axis's. A relay goes through `pan-x` first, which an effect behind the memo would do without a relay-tear code.
- `test/reorder-controller.browser.test.ts` RC3: `detect()` reads the row's `x` at once, reporting nothing.
- **Mutations:** the gestures not keyed by element (GE5), a memo that misses a pass's detection (RV7), and the axis detected by an effect behind the memo (RV7's writes) are all caught. Writing the old reset back is now harmless: with the state keyed by element, it changes no resolution.

## Amendment (#253, 2026-10-23): Solid 1's `wardic.create(Component)` sets its Ward up as this binding does

Solid 1's `wardic.create(Component)` built its element's Ward itself, beside `createWardWith`. It rebuilt the variant node, the Starting values, the drag defaults, the Live style and the element style, then called `runSpine`. Its server path rebuilt `serverWard`'s Starting style the same way. It now does what this binding's `create` does (decision 9): `wardic.<tag>` and `wardic.create(Component)` are one component over `createWardWith`, with the component in place of the tag, and one server path over `serverWard`.

**What a wrap keeps:**
- **Drag defaults on the element at mount** (`SpineInternals.defaultsOnElement`, this binding's name), since its component may pass neither `style` nor `draggable` on.
- **The ADR-0008 error,** thrown at mount when the component never forwarded its ref. A ref merged into the ward's own notes the forwarding.

**A bug it fixes:** the wrap's own setup never told a presence of its element (`madeWith`, #286). A keyed `wardic.create(Component)` child came back beside its leaver instead of taking over from it.

**Pinned by:**
- `presence-key.browser.test.tsx` PK18: the wrap's take-over, which fails on the old setup.
- `drag-defaults.browser.test.tsx` E10: the defaults at mount, through a component that passes neither on.
- The suites that pin the component path, unchanged: `wardic-component`, `style-fallback`, `drag-defaults`, `server.ssr`, `appear.ssr` and the hydration suite.

**Mutation-checked:**
- The defaults on the element dropped, at the wrap and at the spine (E10).
- The forwarding check dropped, or never satisfied (`wardic-component`).

The `use:wardic` directive and Reorder's item still call `runSpine` themselves (#253's scope).

## Amendment (#264, 2026-10-23): `ward.with({ ref, style })`

Motion's swipe card fades as it's dragged: its opacity is derived from its own `x`. A Solid 2 ward took its `style` in its config, but its `x` comes out of the ward (`read("x")`), so a style derived from it couldn't be given before the ward existed. The lab worked around it with a `let`, assigned after the ward, inside a `style` accessor.

**Grilled 2026-10-23:**
1. **`ward.with({ … })` at the spread (Q1: C),** Solid 1's factory call as a method:
   ```tsx
   const swipe = ward({ drag: "x", dragSnapToOrigin: true })
   const opacity = createTransform(swipe.read("x"), [-150, 0, 150], [0, 1, 0])
   <div {...swipe.with({ style: { opacity } })} />
   ```
   - **Why a method is safe in a spread:** Solid 2 re-runs a spread's expression on every props run (*Built (PR 1)* 1), which is why `{...ward(config)}` throws. A method on a kept ward makes nothing new, so re-running it is harmless.
   - **Rejected:**
     - A: the ward reading its `style` only at render, so an accessor could name a `const` made after it. The user: "I don't feel like that's a very good api". Today the ward reads `style` while it's made, and a forward `const` throws.
     - B: a value made before the ward that the drag writes into, as Motion's `useMotionValue`, which breaks ADR-0043's rule that Wardic never writes into a value it's given.
     - D: keep the `let` and document it.
   - The user asked whether the shape was chosen for a memory issue. It wasn't: Q4's ref-carrying-props shape followed Solid 2's ref factories (Q3).
2. **It takes `ref` and `style` (Q2: A),** Solid 1's `WardUserProps`. A `ref` written after the spread replaces the ward's own, so `.with` calls the user's (one, or a list) beside it, the user's first. Rejected: `style` only (B); any props (C), which JSX already merges.
3. **Its style goes over the config's, key by key (Q3: A, `Style.over`).** The combined style is the element's everywhere: its `style` before and after the first commit, the Live values followed per frame, a key's Base value link (ADR-0022), and `read(key)`'s resting value. Rejected: replacing the config's whole (B); `style` only through `.with` (C).

**Built:**
- **Client:**
  - The latest `.with()` props are the ward's, in a plain variable, as Solid 1's factory keeps them. The style getter and the spine read the combined style.
  - `read(key)`'s resting memo also tracks a signal `.with()` writes. That's a third `ownedWrite`, as `.with` runs in the spread's computation. The style getter never tracks it, or the spread would run `.with` again in a loop. The signal is made at the first `read` or `.with`, as most elements call neither.
  - A merge is kept per `.with` style object (`withStyleOver`), so a Live value sees the same object across a run's reads.
- **Server:** `.with()` returns the combined Starting style, the Appear veto applied to it, and `read(key)` rests at it.
- **Exports:** `WardWithProps`. `.with` isn't enumerable, so a spread of the ward doesn't carry it.
- **The lab:** scenario 18's swipe card is `{...swipe.with({ ref, style: { opacity } })}`, its `let` gone. A real-mouse drag to x 90 painted opacity 0.4 (= 1 − 90/150), and back to 1 at its release.

**Pinned by:**
- `v2/ward-with.browser.test.tsx` WW1–WW5:
  - the swipe card's opacity in the card's own frame;
  - the merge, key by key;
  - the ref beside the ward's;
  - a reactive `.with` style;
  - a return to `.with`'s value, and `read` resting there.
- `v2/server.ssr.test.tsx` SV18: the Starting style and `read` on a server.

**Mutation-checked:** eight single-point mutations, all caught:
- `.with`'s style ignored;
- the config's dropped, or laid over `.with`'s;
- `read` not told of `.with`;
- the ward's own ref, or the user's, dropped;
- the server's style or `read` ignoring `.with`.

## Amendment (#335, 2026-10-24): a ward's setup reads the update's in-flight values

Found while porting #296's product detail to Solid 2. A `<Show>`'s narrowed accessor, read in a `wardic.<tag>`'s config, threw on open (`it().id` of `undefined`), and Solid reported `REACTIVITY_HALTED`:

```tsx
<Show when={item()}>{(it) => <wardic.div layoutId={`detail-${it().id}`} />}</Show>
```

A plain `<div title={`x-${it().id}`}>` in the same place worked.

- **Why.** `setupOf` reads the setup copy with no reader, `runWithOwner(null, …)`, so a pending async key doesn't re-run the component (#257 item 1, above).
  - Solid 2 shows a read outside the update's owner tree the committed values. Inside it, as the element's own render reads them, it gets the in-flight values.
  - The accessor reads a memo of `when` that hadn't committed, so the setup got `undefined`.
  - The same stale read made a `<For>` item added in the flush that changed a value its `initial` reads start at the old value, then animate across.
- **Decided** (a bug with one fix, so not grilled): the setup reads under `latest()`, still with no reader, and untracked. It sees the in-flight values, the ones the render uses. A pending key still throws `NotReadyError`, and is still left out and named.
- **Rejected:**
  - Reading under the component's owner: #257 item 1's re-run is back, and AC1–AC4, AC8 and AC9 fail.
  - A detached owner of its own: AC passes, but it still reads committed values, and the `<Show>` still throws.
- **Pinned by** `test/v2/in-flight-setup.browser.test.tsx`, IF1–IF4: the narrowed accessor in a `wardic.<tag>`, under `<AnimatePresence>`, and in a `ward()`'s getters; and the `<For>` item starting at the new value. All four fail on `main`. Taking `latest` out again is the mutation that fails them.

## Amendment (#337, 2026-10-24): a ward an optimistic write makes inside an action

Found while building #296's cart drawer on Solid 2. A cart line added optimistically, its ward made by a `createOptimisticStore` write inside an `action`, stayed at its `initial` values. The console showed `TypeError: Cannot read properties of undefined (reading 'dragging')`.

- **Why.** The ward's target memo compares resolutions with `sameResolution`. A memo made inside the action's transaction has nothing committed yet, and Solid 2 calls its `equals` with `undefined` for the previous value. The comparison threw, Solid logged it with `console.error` and left the memo errored, so the target never moved.
  - A plain signal set inside an action isn't affected: its write is held until the action settles, so its ward is made after it.
- **Decided** (a bug with one fix): the target memo's `equals` (`sameTarget`) counts a missing value on either side as a change.
- **The test setup** fails a Solid 2 browser test on an error Solid only logs: `console.error` with an `Error`, as a throw in a memo's comparison, an effect or a handler is reported. Before, it failed only on a coded diagnostic or a hydration key miss. All 331 tests passed under it as they were, so nothing else was hiding.
- **Pinned by** `test/v2/in-action.browser.test.tsx`, OA1–OA3, on an optimistic store over a server list:
  - OA1: the added row animates to its target;
  - OA2: refused, the overlay drops, and the row, a `layout` element under `<AnimatePresence mode="popLayout">`, exits and goes;
  - OA3: kept, the refreshed row is the same element, at its target.

  All three fail on `main`.

## Note (#345, 2026-10-24): rc.18

Bumped per decision 9:
- `solid-js`, `@solidjs/web` and `@solidjs/babel-plugin` pinned at 2.0.0-rc.18 in dev; the peer floor is `^2.0.0-rc.18`;
- the examples: `@solidjs/router` 2.0.0-next.42 and `@solidjs/vite-plugin` 3.0.0-next.51.

rc.16 to rc.18 changed one thing in Wardic, a type:
- rc.18 types `data-*` attributes (`string | number | boolean | undefined`). So `Component<Record<string, unknown>>`, which `wardic.create`'s implementation returned and the tags' cache kept, is no longer assignable from a `Component<WardicProps<Tag>>`.
- Both are now `Component<never>`: every component is one. `create`'s overloads, the public types, are unchanged.
- `onSettledClientOnly` still passes `transparent` through a tracked effect's options to its node, which reads it (`@solidjs/signals` rc.18, `owner.js`).

What else changed upstream, for apps on this binding:
- **rc.16:** data server functions called during hydration are sent on a page with server components (solidjs/solid#4033). Before, the frames client held every call made before the document's last chunk.
- **rc.16, rc.17:** a server-rendered `live()` read reconnects after hydration.
- **rc.17:** `live()` implies `GET`.
- **rc.16:** keyed `<For>`'s reconciler, and hydrating a streamed `<Loading>` whose fragment was revealed early.

The storefront's Solid 2 wishlist (#296) worked around the first two.

- **Checked:**
  - the v2 browser, hydration and SSR suites, unchanged and all passing;
  - `bench:solid --binding 2`, rc.18 against rc.15 (11 paired reps, 1,000 elements): warm mount −0.2%, Retarget +1.9%, at-rest Retarget −1.4%, unmount −1.5%, bytes −0.3%; no gate failure;
  - `examples/solid2-start` built and every route loaded with nothing logged.

## Note (#414, 2026-10-27): `wardic.create`'s ref check

Decision 9's ref-forwarding error, thrown from `onSettled`, is now an effect over what the wrapped component renders, resolved through `children()`: it throws when the component rendered an element and its ref reached none of it, and waits while it renders nothing. The output is resolved on the server too, so the hydration ids match, and checked only in the browser. A ward's element that comes after the last one left the page enters fresh. See ADR-0046 *Amendment (#414)*.

## Note (#327, 2026-10-27): the last two projection probes

Item 2's other two internal uses were probed in Chromium on Solid 2's production build (`.tmp/327`). Neither is cheaper, so both stay as they are.

**1. The user's style, split by key.** A `createProjection` per element, so that only the keys that changed are written, against `live-style.ts`'s `split` and `reconcile`:
- **The page:** 1,000 elements, each with a six-key style: a Live `x` and a plain `scale` (both routed), and four plain keys. One plain key changes per update. Medians of 12 paired runs:

  | | mount | one key changed |
  |---|---|---|
  | `split` + `reconcile` (kept) | 3.0 ms | 1.5 ms |
  | the derive returns a fresh split, which the projection reconciles | 7.9 ms | 5.8 ms |
  | the derive writes its draft key by key, with no pass for removed keys, and `style` is given the store | 11.2 ms | 6.1 ms |
  | the derive writes its draft key by key and deletes removed keys, and `style` is given a spread of the store | 19.1 ms | 12.8 ms |
  | the whole `wardic.div`, for scale | 25.0 ms | 4.3 ms |

- **Both did the same work:** the new colour painted, and no routed key was told again, since its source hadn't changed.
- **The best projection costs more than the whole `wardic.div` update.** A style the user gives is a new object at every change, so the derive still reads every key, and a store adds its proxy and per-key tracking on top.
- **It would also be Solid 2 only:** `live-style.ts` is shared by both bindings, and Solid 1 has no projection.

**2. Reorder's lookups by value.** Core's drag sample, on 1,000 items in a column, with the dragged item in the middle (500) or at the end (999), a sample that doesn't reorder:
- **A sample costs about 17 µs.** Core's linear search (`indexOf` before `check`) is 0.5 µs of it at 500, and 0.95 µs at 999.
- **Most of the sample is building the measured order** (`measure`: an entry per item with a box, each sample): 11–12 µs.
- **A `Map` from value to index** would answer in about 0.01 µs, but rebuilding it costs about 17 µs at every reorder, which changes `values`.
  - Nothing smaller can be kept, since the index `check` needs is in the measured order, which skips unmeasured items.
- **dom's controller's search runs once a gesture,** at a lift and at a drag's start and end, not per move.
- **The search isn't worth an index:** under 1 µs per pointer move, beside the Measure pass a reorder brings (about 4 ms over 1,331 nodes on `bench:solid`'s layout page, ADR-0040 *Amendment (#385)*).
- **Fixed:** core `Reorder.make`'s doc said a sample "allocates nothing but a new order on a reorder". In fact each sample allocates the measured order, an entry per item. Making that build cheaper was offered and declined: it's about 12 µs a move at 1,000 items.
