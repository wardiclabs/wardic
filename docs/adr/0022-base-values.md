# Base values: where a key with no value starts, and where it returns

A key that no `initial` gives a value (a `whileHover`, `whileTap` or `whileDrag` key, an `animate` key with no `initial`, an exit key) starts from its **Base value** and, once no layer of the Override stack sets it, returns there, as Motion does (#47). Its last link is the element's **Own value**: a transform key's identity, or what the element's Environment reads from it, on the client after mount. Before, such a key started at 0 and stayed where the last layer left it.

This amends ADR-0003 (the `from` of a key `initial` doesn't set), ADR-0005 (the spine's start and return) and ADR-0007 (each key's fallbacks below the base layer).

## Why

- **A gesture-only key started at 0 and never came back** (#47).
  - Scenario 14's "lift", `whileDrag: { scale: 1.05 }` on a `Reorder.Item`, grew each item from 0 and left it at 1.05.
  - It reproduces on a plain `<wardic.div whileHover={{ scale: 1.5 }}>`. #44's `d5d3b31` (a projected element renders its own scale) only made it visible on layout elements.
- **The cause, at `18b1e86`:**
  - The spring starts a key its Snapshot lacks at 0 (`multi.ts:88`), and a tween starts it at its target (`multi.ts:39`). The Snapshot is seeded from `initial` only (`use-wardic.tsx:526-534`).
  - A key that leaves the target stays where it is: the target is the Override stack's resolution (`use-wardic.tsx:693-707`), and the gate keeps a key's last value (`gate.ts:223`).
- **The same gap reached further:**
  - an `animate` key with no `initial` faded in from 0, even the common workaround `animate={{ scale: 1 }}`;
  - a hydrating client blinked such a key to 0 at mount, since the server renders it at its CSS value;
  - a key dropped from `animate` stayed put;
  - an exit key the element never animated started its exit at 0 (`presence.tsx:178-195`).
- **Motion starts such a key from the element and returns it to its base** (read at `16c6122`, and at runtime on `motion` 13.5.0 in Chromium 147 and Firefox 148, cases C1–C17 in [base-values.md](../research/base-values.md)):
  - **Start:** the current value, else the `style` prop, else a read of the element (`VisualElement.ts:864-870`).
  - **Return:** a key removed from every active animation goes to `getBaseTarget`: `initial`'s value, else the `style` prop, else the value first read (`animation-state.ts:404-434`, `VisualElement.ts:911-951`).
  - **A transform key is never read**, in practice. `HTMLVisualElement.ts:51` tests `this.projection?.isProjecting` without calling it, and every `motion` element has a projection node, so the key takes its default: 1 for a scale, 0 otherwise (`parse-transform.ts:62-64`). A class's `transform: scale(0.5)` is ignored (C5).

## Decisions (grilled 2026-10-01 and 2026-10-02 against Motion @ `16c6122` and `motion` 13.5.0 at runtime)

- **The chain (decision 1).**
  - **Return:** a key no layer sets any more returns to the first of:
    - the resolved base layer (local `animate`, else an inherited variant, else `initial`; ADR-0007);
    - the key's `initial` value;
    - the element's `style` value;
    - its Own value.

    With none, it doesn't return: it stays where it is, as before.
  - **Start:** a key with no value yet starts from its `style` value, else its Own value (`initial` already seeds the Snapshot, ADR-0003). With neither, it starts at its target, with no motion (Motion's `unresolvedKeyframes[0] = finalKeyframe`, `KeyframesResolver.ts:226-228`).
  - **Own value:** a transform key's Own value is its identity, pure. Any other key's is read from the element.
  - **A transform key has no `style` link.** In a DOM style, `scale`, `translate` and `rotate` are CSS properties of their own, which compose with the element's transform rather than seed it: `style={{ scale: 0.8 }}` with `whileHover={{ scale: 1.5 }}` paints 0.8 → 1.2 → 0.8.
  - **#50:** an inherited `initial` variant later joins at the `initial` link.
- **Every key with no value (decision 2).** `animate` keys included, as Motion does (C13–C16):
  - an `animate` key with no `initial` starts from its Own value;
  - a key dropped from `animate`, a variant or a gesture returns through the chain.
- **Where it lives (decision 3).**
  - **Core:** `TRANSFORM_IDENTITY`, `transformIdentity`, `baseValueOf` and `startValueOf`, pure (Tier 2). The chain asks one `own(key)` lookup, so an Environment that renders transforms its own way still decides its Own values.
  - **`@wardic/dom`:**
    - `ownValues(element)`, the read;
    - `styleValueOf`, the `style` link's lookup, for an object or CSS text;
    - `valueLike`, the coercion to a key's target shape: a plain number or `px` string for a numeric target.

    All Tier 2, imported directly as #41's Starting-style helpers are.
  - **The binding** only wires them.
  - Not a third `Renderer` method: every Renderer would have to grow one for a case no binding has.
- **The read (decision 4).** At first need, synchronously, once per key per element, kept, including a miss: a later CSS change doesn't move it (C12). Every key `initial` doesn't set is read at its first need, even one that starts from its `style` value, so a later return finds the element's value, not Wardic's own write (a colour from a class, C8).
  - **What it reads:**
    - a transform key: nothing;
    - on an svg-inner element, a key written as an attribute: its attribute (ADR-0014's routing), then the computed style;
    - anything else: the computed style, a custom property by its own name.
  - **Where:** the read runs in the spine's effect: after mount, never on a server (ADR-0021). The Override stack's memo stays pure: the effect works out the returns, so a `when` gate (ADR-0007) holding it closed reads and records nothing.
  - A read from an element not in the document isn't kept: its computed style is empty, so the key is read again once the element is in.
  - **Measured** (1000-element mounts, production builds, `.tmp/p47-bench/`):
    - **The fix keeps one style recalculation per mount on every sink kind.** `use:reorderItem` went to 1000 because its base style was written in an effect queued before each spine effect, so the item now writes it at mount (and on later changes).
    - **The timing deltas are within run-to-run noise**: −6 to +27 ms on 190–630 ms mounts. The reads (0.6–2.2 µs each, batched) sit below that noise.
  - Motion batches its reads in the next frame's read step because some of its resolvers measure layout. Its stepped frame loop makes that free, where Wardic's separate schedulers would lose a frame.
- **The return and the state at rest (decision 5).**
  - **The return is an ordinary Retarget with the element's `transition`.** A Wardic `initial` carries no transition, so this is Motion's default path.
  - **A returning key stays in the target until its return settles,** so a Retarget mid-return carries it again.
  - **Once settled:**
    - **A key back at its `style` value is handed back to the element** (the gate's `release`). A later `style` change then shows at once, and the next gesture starts from it (Motion's `liveStyle`, C7). A commit sink writes the user's current value back.
    - **Any other key rests inline at its base** and leaves the target. A later CSS change doesn't show (C4, C12).
    - A key handed back stays the element's when a `when` gate (ADR-0007) reopens on the same target.
    - A commit sink clears a key gone from the user's style by then, rather than restoring a stale value.
  - **Translate keys.** A projected element's never return: the projection owns them (ADR-0016). On a drag element, the keys the drag moves leave the return while it runs, so they stay where it dropped them (C9) until a layer sets them again. A `whileHover` `y` on a drag element returns like any key, and one the drag's strip (ADR-0004) holds back mid-return returns once the drag lets go.
- **The exit (decision 6).** `<AnimatePresence>` starts an exit key the element never animated from the same start links, read from the retained node. A string exit key then animates from its read value.
- **The server (decision 7).**
  - Nothing reads the DOM on a server (ADR-0021).
  - A key no `initial` sets has no Starting style.
  - Server markup and hydration are unchanged (SV19, hydrate F13 and F14). The first paint after hydration keeps an `animate`-only key at its own value: no blink.

## Considered Options

- **A `Renderer.read(target, key)`** (decision 3). Rejected: every Environment's Renderer would grow a method for a case no binding has. An Environment that needs other Own values supplies its own lookup.
- **Pure defaults only, no read.** Rejected: an opacity or a colour from a class (C4, C8, C12) has no pure default.
- **Gesture keys only** (decision 2). Rejected:
  - the same key would start at 1 under `whileHover` and at 0 under `animate`;
  - the hydration blink would stay.
- **Reading at mount** (decision 4). Rejected: it pays for elements never touched, and still needs a read at first need for keys a reactive config adds.
- **Batching the reads at the end of the task**, an engine microtask like ADR-0018's (decision 4). Kept as the fallback if a mount shows the write-and-read interleave again. Not taken now: it makes a first-need Retarget asynchronous, which `when` and the presence exit would have to account for.
- **Motion's timing, the next frame's read step** (decision 4). Rejected: with a separate Clock and gate it starts a frame late.
- **Never following a `style` change** (decision 5). Rejected: it differs from Motion in C7.
- **Releasing every key once it settles** (decision 5). Rejected: it follows class changes, unlike Motion (C12), and a class's transform would show again (C5).
- **SVG attribute props as a base link** (`cx={50}`, Motion's `SVGVisualElement.ts:27-32`). Not taken; see Consequences.

## Consequences

- **New surface:**
  - core's `TRANSFORM_IDENTITY`, `transformIdentity`, `baseValueOf`, `startValueOf` and their types (Tier 2), and `unitOf`, the unit the `unit` interpolator parses (`valueLike` uses it);
  - `@wardic/dom`'s `ownValues`, `styleValueOf`, `valueLike` (Tier 2);
  - the gate's `release(id, keys, restore?)`;
  - `PresenceRecord`'s optional `startOf`;
  - the spine's internal `styleOf`.
- **The DOM renderer takes its transform keys from core's identities,** so the two lists can't drift.
- **Breaking:** an `animate` key with no `initial` no longer fades in from 0. Write `initial={{ opacity: 0 }}`, as in Motion.
- **Costs:**
  - nothing per frame and nothing at rest;
  - per element: one Own-value reader, and a read at each key's first need;
  - per Retarget that starts or returns a key: one cold-path debug log (`wardic.base`), run at the head of the Retarget's first leg rather than in a fiber of its own. Forking one per element cost 10–20 µs each at a mount.
- **Where Wardic still differs from Motion:**
  - **SVG attribute props.** A `cx` prop changed at rest shows at once, because Solid writes the attribute; Motion keeps its own value. The next gesture then starts from the first-read value (a jump) and returns there; Motion returns to the new prop (C17).
  - **Units.** A numeric target takes only a plain number or `px` as an Own value, and a string target with a unit only a value in that unit (the unit interpolator dies on a mixed pair, so `exit={{ height: "0%" }}` starts at its target). Motion measures the element to convert other units.
  - Covered by their own issues:
    - string keys still snap through the spine (#56), so a colour returns by snapping;
    - an identity transform rests as `scale(1)`, where Motion writes `none` (#57);
    - CSS variables aren't read (#55).
- **Solid 2:** an effect's compute half runs on a server, so the read must stay in the apply half ([upgrade-targets.md](../plans/upgrade-targets.md)).
- **Deferred:**
  - #50 (an inherited `initial`, at the `initial` link);
  - #55, #56, #57;
  - `whileFocus` / `whileInView`, which aren't wired (they get the chain once they are).
- **Pinned by:**
  - core: `base-value.test.ts` (B1–B12);
  - `@wardic/dom`: `base-value.node.test.ts` (D1–D10) and `own-values.browser.test.ts` (OV1–OV13);
  - `@wardic/solid`:
    - `base-values.browser.test.tsx` (M1–M26: the Motion cases on `wardic.div`, a `useWardic` spread and `Reorder.Item`, with the real mouse and painted values every frame);
    - `base-values-sinks.browser.test.tsx` (K1–K6: `wardic.create(Component)`, `use:ward`, `use:reorderItem`; X1–X3: the exit);
    - `gate.browser.test.tsx` (GR1–GR5);
    - `server.ssr.test.tsx` (SV19);
    - the hydrate project's F13 and F14;

    all in Chromium (and in Firefox through local configs);
  - the layout lab:
    - scenario 14's `lift` line;
    - scenario 15's board, judged by `lab/base-values-board.ts`;
    - their node tests (`reorder-run.test.ts` L12–L16, `base-values-board.test.ts` BV1–BV9);
    - the hand runs.

## Amendment (#57, 2026-10-06): a transform key at rest at its identity writes `none`

The Consequences left #57 open: a transform key that returned to its Own value, its **Identity** (CONTEXT.md), rested as `scale(1)` or `translateX(0px)`, where Motion writes `none` (C1, C2, C10). ADR-0023 closes it in `project`: a transform at its identity is left out, and `transform: none` is written when nothing is left. Decision 5's state at rest is unchanged: the key still rests inline at its base and stays in the gate's value-map, and the `none` it projects keeps a class's transform overridden (C5).

## Amendment (#56, 2026-10-07): string keys start and return by animating

The Consequences left #56 open: string keys snapped through the spine, so a colour returned by snapping. ADR-0024 gives the Snapshot strings, starts a string key with no value from its `style` value, else its Own value (decision 1's start links, now wired for strings), and drives it under a spring by the spring's progress. A string key that leaves the target now returns through the chain by animating, and decision 5's state at rest is unchanged. A pair that can't blend (an Own value of `auto` for a length target) switches at its leg's first frame (ADR-0024, decision 3).

## Amendment (#79, 2026-10-12): `style` is a key's fallback while a layer sets it

ADR-0034 decides it.
- **While any entry of the Override stack sets a key, the element shows Wardic's value, whatever its `style` says.** `style` is the key's fallback (its Base value's `style` link), never an override. That was `wardic.div`'s behaviour, through `mergeStyle`, and Motion's (`motion-values.ts:42`). Since the gate commits every element, the binding's `style` leaves out the keys the gate holds, so the rule holds on component wraps too.
- **The hand-back is unchanged:** a key back at its `style` value is released, the gate writes the user's current value, and the key returns to the element's `style`, so a later `style` change shows at rest. Every sink now commits, so decision 5's "a commit sink" means every element.
- **The directives** (`use:ward`, `use:reorderItem`) don't own `style`. There, a key both set goes to whichever wrote last.
