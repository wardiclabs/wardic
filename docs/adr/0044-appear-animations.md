# Appear animations: a server-rendered mount animation plays from first paint, and the engine takes it over at mount

#48 gives Wardic an **Appear animation**: an element's mount animation, which the server's markup starts in CSS from first paint, and which the engine takes over at mount, the **Handoff** (CONTEXT.md). Until now, a server-rendered mount animation stood still until hydration.

It lands in three PRs:
1. core's `Machine.startAt`, and dom's `@wardic/dom/Appear`;
2. the Solid spine's mount legs pulled into one builder, with no change in behaviour;
3. the Solid binding's server and client halves.

This amends ADR-0003 and ADR-0021.

## Why

- **A server-rendered mount animation stood still until hydration.**
  - The server renders the **Starting style**, `project(resolveInitial(config))` (ADR-0003), and a hydrating client keeps it until the element mounts (ADR-0021's **Hydration hold**).
  - So `initial={{ opacity: 0 }}` showed nothing from first paint until the JS had loaded and run, and nothing at all with JS off.
- **#48 was filed as a direction, *server-live resume*:** a long-lived engine on a server whose running animations a client hydrates mid-flight. Its "hard parts" named this gap. Grilled, the gap turned out to be the problem: an app's own data already carries server-owned state into `initial` and `animate`.
- **Motion's nearest equivalent is its *optimised appear*,** which in practice only Framer uses (framer-motion 13.4.0, `animation/optimized-appear/`):
  - An inline script starts WAAPI animations on elements marked `data-framer-appear-id`.
  - At mount, `visual-element-target.mjs` asks `window.MotionHandoffAnimation(id, key)` for that animation's start time and starts its own animation from it.
  - Motion cancels the WAAPI animation two frames later (`MotionCancelOptimisedAnimation`).

## Decisions (grilled 2026-10-19, Q1–Q10 all A)

1. **The problem is the gap before hydration, not a server engine (Q1).** Wardic still builds no runtime on a server (ADR-0021, decision 1).
   - Rejected:
     - a long-lived server engine with per-element snapshots: a second Environment, a snapshot format and clock skew, for state the app's data already carries;
     - wall-clock animations alone: one case of decision 2's, an animation that's a pure function of time;
     - parking it.
2. **A CSS `@keyframes` rule sampled from Wardic's own machines (Q2).**
   - The server steps the mount animation through core's machines and the DOM's `project`, and writes it as one `@keyframes` rule. The element's inline style gets `animation: … linear forwards`.
   - What paints before hydration is what Wardic would have painted. The composed `transform` is sampled whole, so `x` on a spring and `opacity` on a tween animate together exactly.
   - With JS off or failed, it plays through and holds its target. No script is needed: the `<style>` falls under the same `style-src` policy the Starting style's inline styles already need.
   - Rejected:
     - WAAPI from an inline script, as Framer does: it needs a `script-src` allowance, and does nothing without JS;
     - native CSS timing per property (`cubic-bezier`, `linear()`): Wardic composes the transform keys into one `transform`, so keys on different transitions can't share it.
3. **One `<style>` in the `<head>` (Q3),** through the binding's head channel: Solid's `useAssets`, which is called after the render and injected before `</head>` (solid-js 1.9.13 `web/dist/server.js:612`, `:654`).
   - An element whose rule doesn't arrive keeps today's behaviour, held at its Starting style. That happens when a render has no `</head>` (unless the app calls `getAssets()`), and for a `Suspense` chunk streamed after the shell, since `renderToStream` injects assets into the shell only (`:366`).
   - The CSS text comes from `@wardic/dom/Appear`, for any binding.
   - Rejected:
     - a `<style>` after the provider's children: a slow parse paints elements before their rule arrives, and the client has to tolerate the extra node;
     - one before each element: an unkeyed node beside each one, which shifts sibling selectors.
4. **An element qualifies whole, when the server knows its whole mount animation (Q4):**
   - **Values:**
     - static or variant-name `initial` and `animate`;
     - every animated key starting from `initial`, since an `animate`-only key starts from the element's computed style, read after mount (ADR-0022);
     - every start and target something `project` writes without the element: no `auto`, no `var()`, no length pair in mixed units.
   - **Any transition:**
     - a finite `repeat` is sampled in full;
     - an infinite one samples one cycle, played with `animation-iteration-count: infinite`.
   - **Not under `AnimatePresence initial={false}`,** which has no mount animation.
   - **Reduced motion (ADR-0029):**
     - the provider's `"never"` and `"always"` are known on the server and pick the rule;
     - `"user"`, the default, adds the reduced rule under `@media (prefers-reduced-motion: reduce)`, so the browser picks as the client would.
   - **An element that fails a rule keeps its Starting style,** and the `wardic.hydration` debug log says why (unreachable: the provider's `appear="explain"` says it since #585).
   - Rejected: qualifying per key, which puts an element's keys out of step.
5. **Variant orchestration in full, through a custom property (Q5).**
   - The element's inline style names only `animation: var(--wardic-aN)`. The head's `:root` defines it once the render is done, when every element's index, its siblings' total and every settle time are known.
   - This is needed because Solid writes an element's `style` before rendering its children (`ssrElement`, `server.js:509` then `:532`), so a parent's inline style can't know them.
   - Rules are still shared between elements; each element costs one `:root` declaration.
   - An undefined `var()` makes `animation` invalid, so an element whose rule never arrives keeps its Starting style for free.
   - Qualification is whole across the tree: a child whose start depends on a parent that doesn't qualify doesn't either, nor a parent under `when: "afterChildren"` with a child that doesn't.
   - Rejected: only what's known as each element renders (`delayChildren`, stagger from `"first"`).
6. **The Handoff, by elapsed time, in the first commit (Q6).**
   - At mount, the run finds its `wardic-…` animation (`getAnimations()`) and starts its machines that far in, velocity included (`Machine.startAt`).
   - The elapsed time is read at the run's first tick, inside the frame that draws it: `currentTime` there is the CSS's own time for that frame.
   - In the same task, the first commit writes that frame inline and removes the CSS animation (the gate's `beforeFirstCommit`, ADR-0021 decision 6), so no paint falls between. While it ran, the animation's value beat the inline style.
   - A finished animation, `fill: both` holding its end, hands off settled.
   - The rule's name is the hash of the spec: its starting values, targets, transition and reduced motion. A client whose own spec hashes differently logs it in development and continues its own animation at the same elapsed time.
   - Rejected:
     - reading the drawn values back with `getComputedStyle`: a `transform` reads back as a `matrix()`, and velocity is lost;
     - letting the CSS finish on its own, which no gesture or new target could interrupt.
7. **On by default (Q7).**
   - `<WardicProvider appear={false}>` turns it off for an app, and an element's `appear={false}` (on `wardic.*` and `createWard`'s config) turns it off for that one element.
   - Both are read on the server, once.
   - Rejected: opt-in, which leaves the default server-rendered page hiding its content until hydration.
8. **Where the code lives (Q8):**
   - **core:** `Machine.startAt(at)`, which starts a run partway through, stepped in 60 Hz frames (`Machine.CATCH_UP_DT`), as the sampler steps. It has no CSS.
   - **solid:** one pure builder of the mount legs, shared by the spine and the server sampler so they can't drift; the provider's per-render sheet and `useAssets`; the inline `var()`; orchestration resolved at the end of the render; the `appear` props; the Handoff in the spine.
   - **dom:** `@wardic/dom/Appear`, framework-free (ADR-0021's rule for server work, ADR-0041's layout): the sampler, the spec's name, the cache across requests, the CSS text, and the Handoff's reads.
   - Rejected: everything in solid, where each binding would copy the sampler; the sampler in core, which would write CSS (ADR-0036).
9. **Sampled at 60 Hz, then thinned (Q9).**
   - Kept: the stops a straight line can't stand in for, within a tolerance per key below what a screen shows. A bare number is judged by the unit `project` draws it in: 0.1 px, 0.1°, 0.001 of a scale, 0.002 for the rest. A token in a string is judged by its own unit, `px` and `deg` alike; any other by 1/500 of its range, and never finer than the decimals it's written with (a colour channel's whole byte).
   - Measured, `y` 40→0 px and `opacity` 0→1 (`.tmp/48/density.ts`):

     | Mount animation | Every 60 Hz frame | Thinned |
     |---|---|---|
     | spring, default (170/26) | 67 stops, 3,357 B | 21 stops, 1,057 B |
     | spring, bouncy (400/10) | 107 stops, 5,403 B | 44 stops, 2,222 B |
     | tween easeOut 1.2 s | 73 stops, 3,670 B | 16 stops, 806 B |

   - Rejected: every frame, at 3–6 KB per spec; a coarser fixed rate, which cuts a bouncy spring's overshoot peaks.
10. **Delivery (Q10):** this ADR, CONTEXT.md's two terms, and the three PRs above. PR 3 adds frame-traced hydration fixtures, with JS off and reduced motion among them, and a SolidStart `/appear` route with `?hydrate=<ms>` for a phone check.

## Consequences

- **A server render's markup changes:**
  - one `<style>` in the head;
  - an `animation: var(--wardic-aN)` in each qualifying element's inline style.

  Server-rendered entrances move from first paint, and play through with JS off.
- **A server render pays:**
  - 77–122 µs once per distinct spec per process, to sample it (Bun, `.tmp/48/server-cost.ts`);
  - per qualifying element, through the Solid binding: about 8 µs with reduced motion's default `"user"` (two sets of rules), about 6 µs with `"never"`. The rest of a 100-element render costs about 4.6 µs per element (the ssr project in Node, PR 3).
- **The CSS's size:** a rule of 1–2 KB per distinct spec, and one `:root` declaration (about 70 B) per element: 10 KB for 100 elements over three specs, before compression.
- **A client pays at mount:** one `getAnimations()` per qualifying element, and a catch-up of one machine step per 1/60 s elapsed, once per run. Nothing per frame.
- **Not covered:**
  - a key an SVG element draws as an attribute (ADR-0014) can't be animated in CSS, so that element keeps its Starting style (since *Amendment (#245)*, only one with no CSS property: `width`, `height`, `d`);
  - a mount animation longer than 60 s;
  - a streamed `Suspense` chunk (since *Amendment (#245)*, only one whose late elements are all `createWard` spreads).

## Pinned by

- core, `packages/test/test/combinators.test.ts`, "startAt":
  - the first tick at `at()`;
  - the catch-up's steps;
  - the Frame at `k / 60` equalling 0 plus `k` steps of 1/60 s;
  - `at` read once, at the first tick;
  - settling in the catch-up;
  - no clamping at `MAX_DT`.

  Its dual type is in `packages/core/test/machine.test.ts`.
- dom, `packages/dom/test/appear.node.test.ts` (AP1–AP12):
  - the rule's name, length and stops;
  - every sample within tolerance;
  - peaks kept, discrete flips kept, colours by their quantum;
  - stops equal to `startAt`'s Frames;
  - no rule for an SVG attribute, for unsafe text, or past 60 s;
  - the cache, the name's inputs, the `animation` value, the sheet.
- dom, `packages/dom/test/appear.browser.test.ts` (HA1–HA6, Chromium; Firefox by hand):
  - the element plays the machine;
  - `find` and `matches`;
  - a Handoff with no jump, leaving nothing running;
  - a finished animation still filling;
  - an undefined custom property playing nothing;
  - a delay.

## Implementation (PR 3)

- **On a server:**
  - The provider holds a render's Appear state in its existing context: a new provider component would have moved every hydration key (ADR-0021, decision 4).
  - `serverWard` (`wardic.<tag>`, `createWard`) and the component wrap enter each element. A Variant child joins its parent's group through the server's variant context (`appearGroup`), in render order.
  - `useAssets` writes `<style data-wardic-appear>` with `innerHTML`. Solid escapes a text child, which breaks CSS quoting.
  - A user style's own `animation` is known only when `ward()` is called, so it vetoes the entry after the fact. The element keeps its own `animation`, and its slot stays undefined.
- **Timings:**
  - A child under `when: "beforeChildren"` starts at its parent's settle: the machine's own, stepped in 1/60 s as the sampler does (`Keyframes.settled`, past the rule's trimmed end).
  - Summed in 1/60 s steps, a 0.3 s tween lands just past 0.3 at its 18th step and settles there, but a 0.5 s tween lands just short at its 30th step and settles at the 31st. The settle comes from stepping the machine, not from the duration.
  - A forever-repeating tween is sampled as two runs and the `repeatDelay` after them, with no delay before: one CSS cycle, played `infinite`, its own delay in `animation-delay`. Two runs make the cycle exact for every `repeatType`.
- **The Handoff's start:** `elapsed − animation-delay − the rule's own hold + the client's transition delay`.
  - The difference is a `when` wait the client waited itself. Under it, a child can start a frame before the server's timing said; core's `startAt` holds a negative start.
- **The spec's key:**
  - Canonical text: sorted keys, `undefined`s left out, and an easing by `Easing.nameOf` (the Penner set by name; `cubicBezier`, `steps` and `spring` by their call). An app's own easing function has no name, so its element waits for hydration.
  - Written directly, once per element: built with `Match.value` per value and a sorting `JSON.stringify` replacer, the binding added 26 µs per element; profiled down to 8.
- **Found on the way:**
  - #243: a stagger's `from` (`"last"`, `"center"`) sat in the transition a spring decodes `from` from, and every leg failed. Machines now get a transition without its orchestration fields (`motionOf`).
  - In PR 1: a sampled jump holds to halfway between its frames, and `startAt` holds a negative start.
- **The hydration tests read each frame after its callbacks** (a task posted from `requestAnimationFrame`). Read inside the callback, they saw the engine's previous frame: the engine's tick is a later callback.
- **The hand check, `/appear`** in `examples/solid-start-basic`, with `?hydrate=<ms>`. Headless (`.tmp/48/drive-appear.ts`):
  - hydrated at once, at 300 ms, at 1.2 s, and under reduced motion: every element OK (played by CSS or in its delay, no step at the Handoff, the CSS animation gone);
  - with JS off, each ends at its target and holds; `/ssr` 14/14 with `appear={false}`.

### Pinned by (PR 3)

- `packages/solid/test/appear.ssr.test.tsx`, AR1–AR10:
  - the slot and the head's rule;
  - the off switches;
  - each refusal;
  - reduced motion's three settings;
  - stagger by `from` and direction;
  - `when` both ways;
  - an infinite cycle;
  - hydration keys unchanged;
  - no head;
  - a component wrap and a spread.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, AH1–AH8: server render, then hydration, every frame compared with the machine at its time. That covers a spring and a tween handed off mid-flight, a late hydration, JS off, a stagger, `when`, a loop and reduced motion.
- `packages/solid/test/stagger-when.browser.test.tsx` (f), (g): #243.
- `packages/core/test/easing.test.ts`: `Easing.nameOf`.

## Implementation (PR 1)

- **`Machine.startAt(at)`** reads `at` at a run's first tick. It catches up by stepping `0`, then `CATCH_UP_DT` at a time, then the remainder, stopping at a settled Frame. A negative `delay` is a single step, clamped at `MAX_DT`, so it can't stand in.
- **A negative `at()` holds the start for that long.** PR 3's hydration test found the need. A child under `when: "beforeChildren"` can be let go by its client parent a frame before the server's computed wait ends, and clamped to 0 it ran a frame ahead of its CSS.
- **A spec's machine is a thunk,** built only when its rule isn't cached: a server render builds a mount animation's legs once per spec per process, not once per element.
- **The sampler copies each Frame before the next step.** `springValues` rewrites one Frame per run in place, and the first build's first stop read as the settled one.
- **A rule ends where every later Frame is within tolerance of the settled one,** and draws that Frame as the settled one. A 0.5 s tween stepped in 1/60 s settles a frame after it arrives, when the steps' sum crosses its duration; its rule lasts 0.5 s.
- **A jump holds the Frame before it to halfway, then steps.** A loop's seam (352.5° then 0° on the next frame), a `steps()` easing, a snap, a discrete flip: a line between the two stops drew, on a frame between them, a value the engine never draws. PR 3's hydration test caught a loop spinning backwards. `jumpAt` finds them: a change of text, or a move past its tolerance and four times its neighbours'. Halfway, not a hair before the later Frame: display frames land on the 60 Hz stops give or take a vsync's jitter, and a hold ending 0.17 ms before a stop caught them mid-step.
- **The rule fills forwards, not both.** Through a stagger's delay the element shows its inline Starting style. A reduced rule's first stop has its positional keys already snapped, and the client's snap holds them at their start until the delay ends (ADR-0029); filling backwards showed them snapped early, a step at the Handoff on the phone check's drive.
- **Unsafe text is refused:** `<`, `>`, `{`, `}`, `;`, `\` and `/*` in a declaration. A value from an app's config could otherwise end the `<style>` it sits in.
- **`release` only removes the inline `animation`:** that ends the CSS animation at the task's style update, and a `cancel()` as well changed nothing (a surviving mutation).
- **The elapsed-time read sits at the first tick, not at mount,** so its frame is the one the CSS was drawing. Inside a `requestAnimationFrame` callback, an animation's `currentTime` is the frame's.

## Amendment (#245): SVG attributes, layout nodes and streamed chunks

#245 took up what decision 4 and *Consequences* left out: an SVG element's attribute keys, layout nodes, and a `Suspense` chunk streamed after the shell. Grilled 2026-10-19, Q1–Q6, all A. It lands in three PRs, in this order.

1. **All three, in three PRs (Q1):** SVG attributes, then layout nodes, then streamed chunks, the largest, last.
2. **SVG attributes (Q2): the presentation properties always, the geometry behind `@supports`.**
   - An svg-inner element's keys are attributes (ADR-0014), and CSS can't set an attribute. But a stylesheet's or an animation's value of a property beats a presentation attribute, so a keyframe draws the attribute as its property. At the Handoff the engine writes the attribute in the same task that removes the CSS animation, and the attribute takes over value for value.
   - **Always:** `opacity`, `fill`, `stroke`, `stroke-width`, `fill-opacity`, `stroke-opacity`, `stroke-dasharray`, `stroke-dashoffset`, `stop-color`, `stop-opacity`, `flood-color` and `flood-opacity`, unitless as the attribute is. `pathLength`, `pathOffset` and `pathSpacing` are the stroke dash, so a line drawing itself plays; the `pathLength="1"` beside it never changes and is left to the Starting style.
   - **Behind `@supports`:** SVG 2's geometry, `cx`, `cy`, `r`, `rx`, `ry`, `x` and `y`, in px. Chrome and Firefox draw them from CSS; Safari only in part. A rule lists the ones it writes (`Keyframes.supports`). The binding defines its whole orchestrated group under one `@supports` for every one its members write, so a browser without them keeps the group at its Starting style rather than half of it (decision 4's "whole across the tree", per browser). The reduced block too.
   - **Still waiting for hydration:** `width` and `height`, since `@supports (width: 0px)` holds for HTML in every browser and can't tell whether one draws a `<rect>`'s from CSS (the grilled list had them; found while building); `d`, which Safari has no property for; and `points` and filter primitives' attributes, which have none anywhere.
   - **Thinned by what they mean:** a bare number on an svg-inner element was judged as "the rest", at 0.002, so `cx` from 0 to 100 would have kept nearly every frame. Now a user unit is a CSS px, 0.1; an opacity 0.002; a normalised dash 0.001 of the path.
   - Rejected: the presentation properties alone (a circle growing waits for hydration everywhere); the geometry without a guard (a browser that ignores `cx` in a keyframe holds it still, then jumps at the Handoff).
3. **Layout nodes (Q3): measured past the running animation.** The mount's Measure pass runs at the end of the hydration task, a frame before the Handoff, and clears each node's inline `transform` while it reads; a CSS animation's `transform` beats an inline style, so the box would include wherever the CSS had got. A node whose element still runs its Appear animation (its inline style names its slot, until the Handoff removes it: the flag the grill had in mind, kept by the element) gets an inline `transform: none !important` while the pass reads boxes, which beats an animation in the cascade, then its old value back. The CSS animation's timeline isn't touched: Motion's `MotionCancelOptimisedAnimation` around its measure, without the cancel and replay. Rejected: handing off before the measure (a second Handoff path reading its time away from the frame it draws, which decision 6 chose against); allowing every key but `transform`; refusing them still.
4. **Streamed chunks (Q4): one lazy `<style>` per chunk, moved into the head by the client.**
   - Solid's `$df` inserts a late chunk's server HTML until the page's first delegated event (`_$HY.done`), so a chunk is always inserted, and hydrated at once if the JS is already running. An element in it is at its Starting style only until the JS runs: the gap decision 3 left.
   - **On the server:** once the provider's `useAssets` callback has run (the shell is flushed), every element entering is late. A late element with no late Wardic ancestor renders a server-only thunk after itself, which resolves once its siblings have rendered; the first to resolve writes a `<style data-wardic-appear>` with every entry since the last write, the `@keyframes` this response hasn't sent and their `:root` declarations, and any later one writes nothing. The node is server text with no hydration key: a node that took keys moved the client's and lost list items on the next update (probed).
   - **On the client:** the provider copies those rules into its head sheet and removes the nodes, at setup for chunks that landed before the JS, and through a `MutationObserver` until `DOMContentLoaded` (the stream's end) for later ones, which runs before Solid hydrates the chunk. Copying first keeps a running animation's rule in place through every style update.
   - Rejected: leaving the nodes (a hydrated list keeps a `<style>` between its items, shifting `:nth-child`, until it next updates); a node per element as it renders (orchestration only from what's known then).
5. **A late Variant child of a group led earlier (Q5): a fresh mount from when its chunk lands.** Its CSS starts when `$df` inserts it, so its delay is `delayChildren` and its stagger among that group's late children in the chunk, with no wait on the leader's `beforeChildren`: the leader started at first paint, and CSS can't wait on another element's animation. The client's own timing differs (a chunk that landed before the JS hydrates in one pass with the shell, its items continuing the group's stagger; probed), but the Handoff carries each element on from where its CSS drew, whatever delay the client gives it. A group led inside the chunk plays as in the shell. Rejected: continuing the group's indices (a first late item waiting a stagger step per shell child, long after they finished); holding a late child of an earlier group until hydration.
6. **Delivery (Q6):** an Amendment section per PR's part, here; the README's Appear section; **Late chunk** in CONTEXT.md with PR 3; tests and mutations per PR; `bench:solid` for PRs 2 and 3, which touch client paths; and the SolidStart `/appear` route growing with each, checked on a phone.

7. **A layout node's own `x` and `y` are left out on the server (Q7, asked while building PR 2, A).** The client doesn't draw them: a layout node's transform is its projection's, which owns translate and weaves in only its own rotate, skew and scale (ADR-0016, the renderer's `buildProjectionTransform`). The server's Starting style drew them, so a layout node with `initial={{ y: 40 }}` stood 40 px off until hydration, then jumped, and stayed off with JS off; an Appear rule drawing them would have jumped at the Handoff instead, and one leaving them out would have shown the inline translate through. Now its Starting style and its Appear rule are drawn through its projection at rest (`Projection.AT_REST`), as its first commit draws it: at its box, its other keys animating. Its rule's name says so (`Spec.projected`), so the client's spec only matches a layout node's. Rejected: refusing an Appear animation for a layout node with `x` or `y` (the jump at hydration stays); drawing a layout node's own `x` and `y` on the client, as Motion does, which reopens ADR-0016. *Reversed by ADR-0009 *Amendment (#363)*: the client draws a layout node's own translate on its projection, so its Starting style and its Appear rule draw it too, as the client does.*
   - **No layout animation can start before hydration:** the engine measures a node first in the mount's Measure pass, and a plain node doesn't animate its first measurement, so its first layout animation follows a change after mount; a shift before the JS runs just reflows. The mount pass is the only measurement an Appear animation can still be running for, which is all decision 3 needs to cover.

### Pinned by (PR 1, SVG attributes)

- `packages/dom/test/appear.node.test.ts`:
  - **AP14:** presentation attributes unitless; a line's stroke dash, its `pathLength` left out and judged at 0.001; `cx` and `r` in px, judged as an HTML `x` is, and listed in `supports`; an opacity attribute at 0.002; `width` and `d` refused.
  - **AP15:** a sheet defines a slot under `@supports` for its rules' geometry and the group's the binding passes, the reduced block too, one condition with its properties in order.
  - **AP8** and **AP12** refuse `stdDeviation` now that `cx` plays.
- `packages/dom/test/appear.browser.test.ts`, **HA7** (Chromium and Firefox): a circle's `cx`, `r`, `stroke-width` and `opacity` and a path's dash play the machine from CSS, and the Handoff to attributes draws where the CSS was.
- `packages/solid/test/appear.ssr.test.tsx`, **AR12:** a `<g>` leading a circle and a path, all three under the circle's condition, in both blocks; a rect writing no geometry outside it; a `width` animation held.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, **AH10:** a circle and a line, server-rendered and hydrated mid-flight, every frame the machine.

### Implementation (PR 1, SVG attributes)

- **dom:** `declarationsOf` draws an svg-inner element's routed attributes as declarations: the presentation set unitless, the geometry set with `px` on a bare number, `pathLength="1"` left out, anything else refused with its names. `Keyframes.supports` lists the geometry a rule writes, in order; `Slot.define(play, reduced?, supports?)` files the slot's declarations under `@supports (p:0px) and …` for its rules' and the binding's, the reduced block's under the same condition inside the media query. `thin` takes the tag, and a bare number on an svg-inner element is judged by `svgTolerance`.
- **solid:** `timings` carries each play's `supports` from the rule it already looked up, and notes whether any rule writes geometry. Only then does `groupSupports` walk each entry to the top of its orchestration and gather the group's.
- **Server cost,** a 100-element render (a staggered list of 50 and 50 cards) in the ssr project, five rounds interleaved with main: Appear's share went from about +8.2 to +8.7 µs per element. The first build looked each element's rule up again and sorted an empty condition every `define`, +1.5 µs; skipping the group pass when no rule writes geometry, and the empty condition at once, took it to the half microsecond left, the sheet's per-`define` bookkeeping.
- **Chromium takes a unitless `cx` in a keyframe:** the `px` is pinned by the node and ssr tests (a mutation dropping it passed the browser ones). And `Easing.easeOut` doesn't exist: a first AP14 tween given it ran linear.
- **The hand check:** `/appear` gained a circle growing across and a line drawing itself. Headless (`.tmp/245/drive-appear.ts`), 12/12 OK hydrated at once, at 300 ms, at 1.2 s and under reduced motion; with JS off the circle ends at `cx` 120 and the line drawn.

### Pinned by (PR 2, layout nodes)

- `packages/dom/test/projection-appear.browser.test.ts`:
  - **PA1:** a node registered while its element's Appear animation scales it is measured at its box; the same animation runs on, not restarted; the inline transform is back as it was, at its own priority.
  - **PA2:** `measureLayoutBox` reads past it too.
  - **PA3:** an app's own CSS animation isn't an Appear one, and stays in the box, as before.
- `packages/dom/test/appear.node.test.ts`, **AP16:** a layout node's spec is drawn through its projection at rest, its own translate left out and not judged (a `y`-only one is one stop at rest), though it settles with it, and named apart.
- `packages/solid/test/appear.ssr.test.tsx`:
  - **AR13:** a `layout`, a `layoutId` and a component wrap's layout node: Starting style and rule with no translate, the rotate and opacity kept; a plain element's with it, named apart.
  - **AR3** no longer counts a layout node among the refused.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, **AH11:** a layout card entering with scale, opacity and its own `y`: never drawn off its box, handed off mid-flight, every frame the machine; then a layout change animates from its true box and size, not the scaled box the CSS drew at mount.

### Implementation (PR 2, layout nodes)

- **core:** `Projection.AT_REST`, a node drawn at its own box: no delta, no ancestors' scale.
- **dom:**
  - `Appear.pending(element)`: the inline style still names an Appear slot, so its animation runs, not yet handed off; a string read, no style resolved. The Measure pass's transform reset gives such a node an important `transform: none` while it reads (the restore puts the old value back at its own priority); so does `measureLayoutBox`.
  - `Spec.projected`: the sampler projects each stop with `AT_REST`, judges only the keys a projection draws (not `x`, `y` or the `translate*` keys), and names the rule apart.
- **solid:** `isLayoutNode` and `drawnAtRest` give every Starting style site, client and server, `createWard` and the component wrap, a layout node's values with `AT_REST`; `MountAnimation.layout` reaches the server's spec and the client's Handoff check; the refusal is gone.


### Pinned by (PR 3, streamed chunks)

- `packages/dom/test/appear.node.test.ts`, **AP17:** a sheet's `css()` writes what's new since its last call, a rule the head sent not again, the slots defined since; `chunkStyle` wraps it, "" for none.
- `packages/dom/test/appear.browser.test.ts`, **HA8:** a chunk's `<style>` adopted into the head, its node gone, its element's animation the same one, running on; in an iframe document still loading, a chunk landing later is moved as it lands, and after `DOMContentLoaded` nothing watches.
- `packages/solid/test/appear.ssr.test.tsx`, **AR14** (`renderToStream`, piped): one keyless `<style>` in the chunk, after its first root; the rules the head didn't send; the shell group's late children staggered among themselves from 0; a group led in the chunk as in the shell; the head holding none of the chunk's slots.
- `packages/solid/test/appear.hydrate.browser.test.tsx`, **AH12:** a list's items streamed in a chunk that lands before the JS (`serverStreamPage`, the chunk placed by its own `$df` script): each plays from the landing, every frame the machine through the Handoff; no `<style>` among the items after hydration; a later list update keeps them in order.

### Implementation (PR 3, streamed chunks)

- **dom:** `Sheet.css()` writes what's new since its last call. `chunkStyle(css)` is a late chunk's `<style data-wardic-appear-chunk>` as server text. `adoptChunks(document)`, once a document, moves each into a head `<style>`, those already there at once, and while the document is loading a `MutationObserver` the rest, until `DOMContentLoaded`.
- **solid, server:** `serverAppear` writes a batch at a time. Its `css()`, the head's, marks the shell flushed. An element entered after is late, and the chunk's root when no late element is around it (`within` counts the late elements a render is inside). `wardic.<tag>` and `wardic.create` render a root as `[element, thunk]`, the thunk `{ t: chunk() }`, server text with no hydration key. `timings` takes the batch: a group's children are those in it, and a leader outside it is waited on by no one.
- **solid, client:** the provider calls `adoptChunks(document)` while hydrating, before its subtree hydrates.
- **Server cost,** the 100-element render of PR 1's measure, five rounds interleaved with main: level, Appear on and off. A first build cost about +0.4 µs an element both ways: a `WeakMap` from each server ward to its entry, and a closure, an `Option` and a `Bool.match` per element for what only a late element needs. The ward keeps its entry under a symbol now, and an element in the shell, nearly all, renders through guards that allocate nothing.
- **An equivalent mutation:** making a second `adoptChunks` call skip its sweep once the document is watched survives every test, and changes nothing a page sees. The guard holds only while the document loads, when the observer moves each chunk as it's inserted.
- **Not covered:** a chunk whose late elements are all `createWard` spreads has no root to write its style: those elements keep their Starting style until hydration, as before.
- **Seen on the way:** a chunk landing after hydration mounts its items as late joiners, with no stagger of their own (index 0, total 1), yet they stagger as the CSS did. The Handoff starts each run its CSS delay in (`startAtOf`), a negative start, which holds it.
- **The hand check:** `/appear` gained a list its shell leads, its items streamed `?data=<ms>` after. On a production build, headless (`.tmp/245/drive-stream.ts`, `.tmp/245/trace-late.ts`):
  - the chunk before the JS (`?data=300&hydrate=1500`), reduced motion too: every item OK, no chunk style left, the list's children only its items;
  - after the JS (`?data=1200`): the style landed in the list and was moved before the chunk hydrated, and the items faded in staggered.

## Note (#448, 2026-10-28): a key already at its target isn't sampled

The client's first Retarget starts no Leg for a key already at its target (ADR-0005, *Amendment (#448)*), so the server leaves one out too: a key whose `initial`, coerced to its target's shape, is its target isn't in the rule, and an element whose every key is there has none, as one whose `initial` equalled its `animate` had none before. The two specs stay one, and the Handoff matches (`keyOf`). An `auto` already at its target no longer stops the rule. Pinned by AR21 and AH13.

## Amendment (#585, 2026-11-04): the provider's `appear="explain"` says why an element waits

**Found writing the Server rendering guide (#558).** Decision 4 had a `wardic.hydration` debug log say why each element that fails a rule keeps its Starting style. It could never be seen. The provider logged it with `Effect.runSync`, outside the app's `env`, since a server render builds no runtime: Effect's default level, `Info`, dropped it, and no logger or level an app merges into `env` reached it.

**Grilled on #585: C, then `appear="explain"`.** The rejected options:
- **A. Log it through `env`'s logger and level.** A server can't build `env`: it holds `DomLive`, which needs a page, and Effect builds a Layer whole, not its logging part alone.
- **B. Warn in development** for an element that has an `initial` but can't play. Solid 1's server build has no `DEV`, so it would rest on `process.env.NODE_ENV`, which some runtimes (Workers) don't have; and most refusals aren't mistakes (`appear={false}`, a key with no `initial` on an element with no entrance).
- **D. Drop the log,** and rely on the guide's list of what plays.

**Decided.**
1. **The provider's `appear` also takes `"explain"`** (both bindings). It plays every element as `true` does, and the server says, at Warning, why each element that doesn't play waits for the JavaScript, as the render finds it: `wardic.appear: <div> (width) waits for the JavaScript: width's start and target don't take one shape`. An element is named by its tag and the keys its mount animates: a `w.*` element's `class` and `id` don't reach its ward on a server. It's logged with Effect's own logger (`Effect.runSync`), for the reason above.
2. **Without it, nothing is kept or said:** the reasons the debug log collected for every element are gone, and so is the log.
3. **Every refusal is said,** the intentional ones too (`appear={false}`, no `initial`): the provider asked. An element whose two plays, normal and reduced, fail alike is named once.

**Tests:** AR30 (Solid 1) and AR25 (Solid 2): a page with an element that plays, one with no `initial`, one with a length in two units and one whose style sets an `animation` says three lines under `"explain"`, in render order, and nothing under `true` or no `appear`. Both fail without the fix.

## Amendment (#706, 2026-11-12): a Batch's members

A `createBatch` member's server start (ADR-0069, *Amendment (#665)*, Q63) stood at `initial` until hydration: its entrance played once the page's JS had run. A Batch's members each have their own targets, so a rule per member (this ADR's per-spec rules) is a thousand rules for a thousand members. Grilled 2026-11-12, Q1–Q21; built in two PRs, core's and dom's (#723), then the bindings'.

**Decided.**
1. **Both bindings, both forms and `Reorder.BatchGroup`, the entrance alone (Q1, Q16).** A server has no exits or gestures. A Batch Reorder group's `initial` keys but `x` and `y` move to their identity as an item enters (Q20, found here: they never moved, ADR-0072 *Note (#706)*), so its entrance is a fade or a grow at each item's place; its places don't move.
2. **Opt-in, a Batch's own `appear: true` (Q21, amending Q5's default).** A Batch that doesn't ask draws its start as before, and the provider's `"explain"` says nothing of it. Elements keep theirs on by default. The provider's `appear={false}` turns a Batch's off too.
3. **One rule a set of transitions, each member's own values as custom properties (Q2 A).**
   - The rule's stops are each key's progress, sampled from a core Batch of one member at 60 Hz (the client's own stepping) and thinned by `thin` at the key's tolerance at its longest move, rounded up to a power of two: the span, part of the rule's name, so Batches whose longest moves are near share a rule.
   - A key every member that moves shares the start and target of is written into the rule; one whose values differ reads `--wardic-<key>0` (start) and `--wardic-<key>1` (target) from the member's element, a stop `calc(var(--wardic-x1) * 0.29199)`. A member that doesn't move plays nothing and shares nothing.
   - When a transform key moves, the rule's `transform` is the element's whole: every transform key off its identity is in it, as it is or as the member's own.
   - **Members whose transitions differ** (a Default transition toward a scale of 0 is its own) are groups: a rule, and a slot, each.
   - Rejected: a `linear()` easing on a single `to` keyframe (keys on different transitions inside one `transform` can't share it, decision 2's reason; Safari 17.2 and later); a rule per member (1,000 places, about 1 MB).
4. **A `:root` slot per rule group, each member's delay its own (Q2, Q6; amended after PR 1, Q17).** Under `"user"`, only a stylesheet can pick the reduced rule, so a group's slot (`--wardic-aN: <rule> 0.82s linear 1 forwards`, no delay) is defined twice, the reduced one under the media query. A member's inline `animation` names the slot and gives its own delay as the shorthand's second time, `var(--wardic-a3) 0.035s`. A longhand `animation-delay` after a `var()` shorthand left the inline `animation` unreadable (probed in Chromium and Firefox), which `Appear.pending` reads; a delay in the slot too would be a third time, and the member's `animation` invalid.
5. **Each member's delay is its stagger by its rank among the members that move (Q2),** the count the client's change makes.
6. **The Handoff, per member (Q3).**
   - Core's `Batch.retarget` takes `startAt: (slot) => seconds`, read at the member's first step in a start pass before the loops (which only clear a flag): the keys the change turned at that time, a spring by its closed form and a tween by its curve, from the speed they came with; its other moving keys a step on.
   - The first change after members arrive running their Appear animation (the arrival's, or a Batch Reorder group's own first), whichever comes first, starts each so, and every change before that one's first step starts them the same way, a member arriving then among them: none is let go at that step from a start it was never drawn at.
   - A client looks for them only while it hydrates and its Batch asked (`appear: true`): a member's element running a Wardic element's own Appear animation, under a Batch that didn't, stays that element's. Under one that did, the Batch's slot is the member's `animation`, which vetoes the element's own (its own style sets one), and `Appear.find` passes over a Batch's rule (two hashes in its name, an element's one), so a Wardic element there doesn't take its Batch's animation for its own; its own entrance plays from hydration.
   - The page's Appear animations are read once a task (`Appear.findAll`, one `document.getAnimations()`), each member's matched by its element, released in that task. Members a change didn't move are released after its first step, or at once when nothing moves.
   - **Measured (Q3):** Chromium's `Element.getAnimations()` costs about a whole document's sort each (1,000 members in one list: 5.6 s for all of them, the document's 5.6 ms; 5,000: 174 ms; in rows of 50, 0.6 and 6 ms). Firefox's per-element reads are cheap, its document's 2 to 19 ms. ADR-0044's per-element `find` pays the same with many Appear elements: #724.
7. **No rest snap at the Handoff (Q8).** The shared curve can't make each member's rest snap (0.5 px past a 5 px move), so a member's start partway is drawn where its closed form has it, unsnapped (`valueAt`'s `rests`), and lands at its next step, as at any landing: at most 0.5 px, or 0.005 of opacity.
8. **Names (Q9).** The rule's name is `wardic-b<hash(key)>-<hash(keys, shared values, spans)>`, `key` the member's transitions as canonical text and whether motion is reduced or skipped (`batchKeyOf`, the same on both sides). In development, a client checks the first part (`Appear.matchesBatch`) once per rule it meets, and notes a mismatch at Debug; members' values aren't checked. A production build has no check (Solid's `DEV`), and no `batchKeyOf`.
9. **What waits (Q4):** a transition holding an ease with no name (the whole Batch); a member whose own `style` sets an `animation` (it keeps it, and still counts in the stagger); a value that isn't a finite number.
10. **Reduced motion and `skipAnimations` (Q6):** as an element's. A 0 s tween lands as its delay ends, at that very time (core's `Batch`, found here), so a skipped Batch's rule is 0 s at the targets and reduced motion's Snap is at its first stop.
11. **Late chunks and SVG (Q7):** a Batch in a streamed chunk plays when a Wardic element in that chunk brings the chunk's CSS (Solid 1's thunk, Solid 2's head patch); with none, its members wait. An SVG member's `rotate` or `scale` turns about the SVG's origin until the Handoff; `transform-box: fill-box; transform-origin: center` in its own style is the remedy.

12. **Its cost to a client that doesn't take one over (Q11).** The Handoff's code (`batch-handoff.ts`, with dom's `findAll`, `matchesBatch` and `elapsedOf`) loads with `import()` the first time a hydrating Batch has a member running its Appear animation, its members drawn by their CSS meanwhile. dom's `pending`, `release` and `PREFIX` are a module of their own (`appear-slot.ts`), as a bundler puts a module in one chunk: with the reads, they kept the reads in the first chunk. `bun run size --base main`: `s1-batch` +0.7%, `s2-batch` +0.6% gzipped (+1.3% and +1.1% before the split). A client-only Batch pays one boolean at setup: `bench:solid --batch --n 1000` against `main`'s source, 2 runs each, its change 0.385 and 0.370 ms against 0.380 and 0.360, its frame 0.800 and 0.740 against 0.770 and 0.790, its mount 6.6 and 6.7 against 6.2 and 6.6 (within `main`'s own spread); `bench:core --base main`'s Batch workloads level in Bun, Node and Chromium (B28's step).
    - **The Handoff, measured (Chromium, a grid in one parent):** at 1,000 members the longest frame as it hydrates is 33–50 ms (the reads 9.6 ms), against 16.7 ms without; at 5,000, 367–383 ms (the reads 188, the start pass 6, the release 2; the rest the browser drawing again as 5,000 composited CSS animations end), against 16.8. The reference says so, and opt-in leaves it to the app.

**Found on the way, in core's `Batch`:** a step of 0 s landed every spring of a member whose keys run their own transitions on its target (`stepRuled` skipped the matrix at `dt <= 0`), live on a Clock tick of 0 s (#723); and a 0 s tween held its start a step past its delay's end (its resolved duration, `Number.EPSILON`), landing now by its duration as given.

### Pinned by

- core, `packages/core/test/batch.test.ts`: B23–B26 (`startAt`), B27 (a 0 s step), B28 (a 0 s tween at its delay's end).
- dom, `packages/dom/test/appear.node.test.ts` AP18–AP21 (the rule against each member's own Batch, its shapes, names and spans, the sheet's slot); `appear.browser.test.ts` HA9–HA12 (one rule, each element its member, in Chromium and, by hand, Firefox; the Handoff; `findAll`; `find` passing over a Batch's rule).
- solid, `batch-appear.ssr.test.tsx` BS1–BS8 on each binding (the rule and slot, opt-in and the off switches and `"explain"`, reduced motion and a skip, keyed, groups, late chunks, a Batch Reorder group, a stagger over the members that move); `batch-appear.hydrate.browser.test.tsx` BH1–BH8 on each binding (a member beside a Wardic element frame for frame through the Handoff, a staggered grid against each member's Batch, a late hydration, JS off, reduced motion, a group's fade, a Wardic element on a member's element and a vetoed member, a Batch without `appear` leaving a Wardic element its own); `reorder-batch.browser.test.tsx` BG11 (Q20).

