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
   - The server steps the mount animation through core's machines and the DOM's `project`, and writes it as one `@keyframes` rule. The element's inline style gets `animation: … linear both`.
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
   - **An element that fails a rule keeps its Starting style,** and the `wardic.hydration` debug log says why.
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
- **A server render pays (Bun, `.tmp/48/server-cost.ts`):**
  - 77–122 µs once per distinct spec per process, to sample it;
  - about 2 µs per element for a cached spec (its name's hash and the lookup);
  - 1.4 µs per element for a sheet's slot and definition.

  ADR-0021 measured about 9 µs per element for the rest of a server render.
- **The CSS's size:** a rule of 1–2 KB per distinct spec, and one `:root` declaration (about 70 B) per element: 10 KB for 100 elements over three specs, before compression.
- **A client pays at mount:** one `getAnimations()` per qualifying element, and a catch-up of one machine step per 1/60 s elapsed, once per run. Nothing per frame.
- **Not covered:**
  - a key an SVG element draws as an attribute (ADR-0014) can't be animated in CSS, so that element keeps its Starting style;
  - a mount animation longer than 60 s;
  - a streamed `Suspense` chunk.

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

## Implementation (PR 1)

- **`Machine.startAt(at)`** reads `at` at a run's first tick. It catches up by stepping `0`, then `CATCH_UP_DT` at a time, then the remainder, stopping at a settled Frame. A negative `delay` is a single step, clamped at `MAX_DT`, so it can't stand in.
- **A negative `at()` holds the start for that long.** PR 3's hydration test found the need. A child under `when: "beforeChildren"` can be let go by its client parent a frame before the server's computed wait ends, and clamped to 0 it ran a frame ahead of its CSS.
- **A spec's machine is a thunk,** built only when its rule isn't cached: a server render builds a mount animation's legs once per spec per process, not once per element.
- **The sampler copies each Frame before the next step.** `springValues` rewrites one Frame per run in place, and the first build's first stop read as the settled one.
- **A rule ends where every later Frame is within tolerance of the settled one,** and draws that Frame as the settled one. A 0.5 s tween stepped in 1/60 s settles a frame after it arrives, when the steps' sum crosses its duration; its rule lasts 0.5 s.
- **A jump holds the Frame before it until a hair before it.** A loop's seam (0→360° on one frame), a `steps()` easing, a snap or a discrete flip: a line between the two stops drew, on a frame that fell between them, a value the engine never draws (PR 3's hydration test caught a loop spinning backwards). `jumpAt` finds them: a change of text, or a move past its tolerance and four times its neighbours'.
- **Unsafe text is refused:** `<`, `>`, `{`, `}`, `;`, `\` and `/*` in a declaration. A value from an app's config could otherwise end the `<style>` it sits in.
- **`release` only removes the inline `animation`:** that ends the CSS animation at the task's style update, and a `cancel()` as well changed nothing (a surviving mutation).
- **The elapsed-time read sits at the first tick, not at mount,** so its frame is the one the CSS was drawing. Inside a `requestAnimationFrame` callback, an animation's `currentTime` is the frame's.
