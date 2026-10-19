# The flush gate commits every element, and `style` is the fallback

#79 profiled the gate's flush at 1,000 elements. Most of it was not the gate: 82–87% was Solid re-running each `wardic.div`'s spread effect, because the gate's signal sink handed every frame to a Solid signal. The grill moves `useWardic`, and so `wardic.*`, onto the commit path that component wraps, `use:ward` and Reorder items already took. The gate commits every element itself, so the signal sink goes. `Renderer.commit` becomes a plain call, and the commit and `project` allocate nothing per element. A binding element's `style` carries Wardic's values only until its first commit. From then on it's the fallback: the user's style, without the keys the gate holds on the element. So while Wardic drives a key its value wins, as it did on `wardic.div` and as Motion's does. At 1,000 elements the flush falls by 72–83%, and the Clock's whole callback, the tick included, by 59–64%. This reverses ADR-0002's "Solid renders reactively" for frames, and amends ADR-0002, ADR-0006, ADR-0021, ADR-0022 and ADR-0031.

## Why

- **The profile** (`.tmp/79-flush/`: N = 1,000 `wardic.div`s on solid's real provider over `DomLive`, Solid's production build, Chromium 147 on the bench server, V8's sampling profiler at 25 µs). Shares of the flush, by workload:
  - Solid's `assign`, the spread's render effect: 82–87% inclusive.
  - The props proxy's traps (`ownKeys`, `getOwnPropertyDescriptor`): 20–25%.
  - `setProperty`: 9–28%. It reaches 28% on the `styled` workload: Solid's `style()` sets every key again on each change, the user's static ones included.
  - The gate's own loop (`project` and the signal set): 8–12%.
- **Why the spread is expensive:**
  - `<Dynamic component={tag} {...rest} {...ward(userProps)} />` compiles to `mergeProps({ component }, rest, () => ward(userProps))`.
  - A function source puts `mergeProps` in Proxy mode, so every frame, each element's one spread effect walks every prop through the proxy's traps, which allocate on each walk.
  - Solid's `style(node, value, prev)` (solid-js 1.9.13 `web.js:281-301`) deletes every previous key, then sets every key again: there's no diff.
- **The options, prototyped and timed** (the same page, 7 paired reps, a fresh cross-origin isolated page each, 5 µs timers; ms of flush per Refresh frame mid-flight; A/A within ±1.7% and ±3%):

  | Workload | main | C: hoist `ward()` | B: `style` on its own effect | A2: commit sink | A3: + a plain commit | A4: + a per-key diff |
  |---|---|---|---|---|---|---|
  | `transform` (`x`, `y`, `scale`) | 4.35 | −48% | −58% | −63% | −71% | −65% |
  | `mixed` (`x`, `opacity`, a colour) | 3.39 | −50% | −57% | −56% | −65% | −59% |
  | `flip` (layout FLIPs) | 3.89 | −53% | −63% | −69% | −79% | −72% |
  | `styled` (a 4-key user style) | 5.06 | −38% | −45% | −67% | −74% | −69% |
  | `partial` (2 of 3 keys still) | 4.41 | | | −64% | −72% | −78.5% |

  - **C** changes no behaviour: every prop still goes through Solid each frame.
  - **B** keeps the signal sink with `style` on its own render effect: Solid still runs one effect per element per frame and sets every key again.
  - **A2** is the commit sink as component wraps had it. Its `runtime.runSync(commit(…))` is one fiber per element per frame: about 20% of the flush (the profile), 0.3–0.4 ms at N = 1,000.
  - **A4**'s diff costs 0.2–0.3 ms when every key changes, and saves 0.3 ms only when most keys stand still.
- **What's left after A3** (profiled): the browser's own `setProperty` (44–56%), `project` (15–32%), `dashCase`'s regex per key per frame (3–11%), and `splitPatch`'s two objects per element (3–6%). Two allocation-free variants, timed against A3 with an A/A copy (A/A within ±2.5%):
  - **A5**, the commit with no routing objects for an HTML element and each key's dash-cased name cached: −5.8% to −16.5%;
  - **A6**, A5 plus a `transform` built by concatenation, not an array joined: −11.6% to −20.1%.
- **Motion renders this way** (`.reference/motion` at `16c6122`, `packages/motion-dom/src/`). A motion value's change stores the value and schedules one render for the frame (`render/VisualElement.ts:575-586`, `:681-687`). That render builds the style from all the element's values and writes `element.style` directly (`render/html/utils/render.ts`). React never re-renders. #130's live values in `style` would take the same path here.

## Decisions (grilled 2026-10-12)

1. **`useWardic` commits through the gate, and the signal sink goes.**
   - `useWardic`, and so `wardic.*`, registers the element itself as its sink, as `wardic.create(Component)`, `use:ward` and `use:reorderItem` did. The gate has one sink shape: `{ target, beforeFirstCommit?, onHeld? }`.
   - Its `style` carries the Starting style until the first commit, through the same switch a component wrap had (ADR-0021 decision 6, run by `beforeFirstCommit`).
   - No frame goes through Solid: an element's `style` re-runs at its first commit and when a key the user's style sets is taken or let go of, never per frame.
   - Motion values (#130), whichever order they take against the Override stack, are written upstream of the gate, so they take this path too.
   - **Rejected:** C, B and A2 (*Why*), and keeping the signal sink beside the commit sink, whose only producer was `useWardic`.
2. **`Renderer.commit` is a plain call: `(target, patch) => void`, like `project`.**
   - The repo's rules decide it: no Effect round trip per frame (docs/agents/effect-first.md), and nothing on the per-frame path is an Effect (docs/agents/pipeable.md). The gate's `runSync` per element broke both, as did the Measure pass's per node.
   - `applyTo` wraps the call in `Effect.sync`, once per Frame.
   - Core is unpublished, so the old signature is gone with no alias (pipeable.md).
3. **Wardic's value wins a key while it drives it, and `style` is the fallback** (#79's grill, CONTEXT.md's **Base value**).
   - **What it fixes:** after the first commit, Solid applies the element's `style` itself, and its `style()` sets every key again on any change. A user's reactive `style` that sets a key Wardic animates would overwrite it, even when only another key changed. Mid-animation the next frame would cover it before paint, but once the animation settles nothing commits again, so the user's value would stay. A `style` given as CSS text is written as `cssText`, which wipes every inline key Wardic wrote. Component wraps had both problems already.
   - **The mechanism:** the gate tells the sink every key it holds on the element whenever that set changes (`onHeld`). It does that before the commit that first writes a key, and after restoring a key that dropped out. The binding's `style` from then on is `fallbackStyle(user, held, defaults, base)`: the user's style over the drag defaults and the base style, without the held keys. A CSS-text style is parsed first. A held-keys change re-runs `style` only when it touches a key the element's own style sets (`heldTouches`).
   - **The order:**
     - A frame's Starting-style switches run first, all in one call to the binding's `batch`.
     - `onHeld` runs outside any `batch`: the gate never flushes inside the binding's own update, so Solid applies the element's `style` before the call returns. Solid removes a newly held key, then the commit writes it, with no paint in between.
     - The binding's `batch` wraps nothing else.
   - **The same rule as Motion's:** Motion ignores a changed `style` value for a key that has animated (`render/utils/motion-values.ts:42`).
   - **The hand-back is unchanged** (ADR-0022): a key back at its `style` value is released, the gate writes the user's current value, and the key returns to the element's `style`.
   - **Where it doesn't reach:** `use:ward` and `use:reorderItem` don't own the element's `style` prop. There, a key both write goes to whichever wrote last, as before, and the directive's doc says so.
   - **Rejected:** last writer wins on every surface, as component wraps had it. That would make both problems `wardic.div` bugs too.
4. **The commit and `project` allocate nothing per element** (A5 and A6).
   - An HTML element's patch is written as it is; an svg-inner element's is still routed (ADR-0014).
   - `dashCase` caches each key's name: keys come from animation configs, so the set stays small.
   - `project` builds `transform` by concatenation.
5. **No per-key diff** (A4). It costs time when every key changes, which is the common frame. It would also skip a key that something else wrote since: the Measure pass's commit, a release's restore, devtools.
6. **`ward()` isn't hoisted out of the spread** (C): with no frame going through Solid, the spread re-runs only for a prop change, so hoisting saves nothing per frame.

## Considered Options

- **C, B, A2 and A4** (*Why*, decisions 1 and 5).
- **A signal sink that writes the element itself, with a per-key diff** (prototype A, −62% to −70%): a commit sink in all but name, which would keep two sink shapes.
- **Keep the Effect `commit` and run one fiber per flush** (`Effect.forEach` over the dirty elements): still an Effect object and a run-loop step per element per frame, against the per-frame rules. Not prototyped.
- **The binding applies the user's style itself** (with a diff, skipping held keys) instead of handing it to Solid: it would move a component wrap's user style from wherever the component puts it to the element the ref reaches.

## Consequences

- **Declared behaviour changes:**
  - **`ward().style` stops carrying animated values** after the first commit: a read of it sees the fallback. Read the element for its current values.
  - **A `useWardic` spread onto a component** animates the element its ref reaches, not wherever the component puts `style` (ADR-0021's table, *Amendment (#79)*).
  - **On `wardic.create(Component)`,** a reactive user `style` no longer overwrites a key Wardic holds, and a CSS-text `style` no longer wipes Wardic's keys.
  - **Solid's `batch()`** wraps only a frame's Starting-style switches. Before, it wrapped every flush.
- **Breaking, for Environment and binding authors:**
  - `Renderer.commit` returns `void`, not an `Effect`.
  - `FlushSink` has no `kind` and no `set`.
  - `FlushGateOptions.batch` runs the switches, not the flush.
  - Core is unpublished, so nothing is aliased.
- **Unchanged:** the server render, the Hydration hold, what ends up on the element, `flushPass`, `release` and the restore of a key that drops out.
- **Glossary:** **Reactive path** goes; **Imperative path** means `applyTo` alone, outside a binding. **Starting style**, **Flush gate** and **Base value** say what this ADR decides.
- **#130** (live values in `style`) is filed with the two orders it could take. Either sits upstream of the gate.

## Implementation in #79's PR

- **core:** `Renderer.commit`'s type, and `applyTo`'s `Effect.sync`.
- **test:** the recording Renderer's `commit`.
- **dom:**
  - `makeFlushGate` (`FlushGate.make` since #132, ADR-0041): one sink shape, a plain `commit`, `onHeld`, and the switches in `batch`.
  - `renderer.ts`: the allocation-free commit and `transform`.
  - `svg.ts`: `dashCase`'s cache.
  - `starting-style.ts`: `fallbackStyle` and `heldTouches`.
  - `projection.ts`: the leaving node's plain `commit`.
- **solid:**
  - `element-style.ts`: `createElementStyle`, the switch and the fallback for `useWardic` and `wardic.create(Component)`.
  - `use-wardic.tsx`: the element as its sink, and the spine's `defaultsInProps`.
  - `wardic.tsx`'s component wrap, `presence.tsx`'s plain `commit`, and the docs.
- **The layout lab:** s8's driver mounts per Run, so its effect fires at the driver's first-commit switch, the one `style` change the gate makes inside its flush.
- **Docs:** the README's `ward()`, and the plans' notes on the reactive bridge (`upgrade-targets.md`, `v0.1.md`).
- **The node guard** (`packages/dom/test/gate.node.test.ts`):
  - every sink's target hears its commits (`gate-harness.ts`'s `sinkOf`, `HEARD`, `HEARD_DOM`);
  - the switches run in one `batch` before any commit, and a pass switches nothing;
  - GH1–GH3: the keys held are heard before the commit that first writes one, after a dropped key's restore, and in a pass;
  - G4: a write from an effect a hook ran waits for the next frame;
  - GK3 and GR1: the restore, then the patch.
- **`starting-style.node.test.ts`:** FS1–FS6, `fallbackStyle` and `heldTouches`.
- **solid's browser tier:**
  - `style-fallback.browser.test.tsx`:
    - F1–F4: a reactive or CSS-text `style` keeps the keys Wardic holds, on `wardic.div` and on a component wrap;
    - F5: a spread's `style` re-runs once, at the first commit;
    - F6–F8: a spread onto a component animates its ref's element, whether the component puts `style` on an inner element, takes no `style`, or reads it once.
    - With the held keys left in `fallbackStyle`, F1 and F3 fail.
  - `gate.browser.test.tsx`: the switches in Solid's `batch()`, and a held-keys signal applied before the commit.
  - `use-wardic.browser.test.tsx`: reads frames off the element, not `ward().style`.
  - `measure-pass-timing`'s two in-flush effects: one from a first commit's switch, one from a held-keys hook.

## Measured on the final code

On the bench server, with `wardic-quiet` and Chromium 147 headless.

- **The flush, per Refresh frame mid-flight** (`.tmp/79-flush/`, the *Why* page, built by `build-flush.ts`, which times the gate's own `flush` on both sides. Main's includes Solid's effect drain, inside its `batch`. Main, an A/A copy of main, and this branch, 7 paired reps of 4 rounds, a fresh cross-origin isolated page each; median [p25–p75]):

  | Workload | main | here | here / main | A/A | Clock's callback, here / main |
  |---|---|---|---|---|---|
  | `transform` | 4.35 ms | 1.08 ms | −74.9% [−75.4, −74.5] | +0.5% [−0.2, +1.7] | −58.6% [−61.6, −57.9] |
  | `mixed` | 3.44 | 0.99 | −71.5% [−72.2, −71.4] | −1.5% [−2.8, −1.3] | −61.2% [−61.9, −60.9] |
  | `flip` | 3.85 | 0.68 | −82.6% [−83.0, −82.3] | −1.9% [−8.2, +0.4] | −64.1% [−65.1, −64.0] |
  | `styled` | 5.12 | 1.11 | −78.4% [−78.8, −78.1] | +0.3% [+0.0, +0.8] | −63.3% [−64.5, −62.9] |
  | `partial` | 4.40 | 0.96 | −77.9% [−78.4, −77.7] | −0.2% [−1.0, +0.7] | −59.1% [−59.9, −58.6] |

  - The sampled mid-flight style has the same keys on both sides, and the same values within the frame timing's jitter between pages (8.444 px here against 8.44413 px; main against its own copy, 8.44427 px against 8.44413 px).
  - A first run read the same effect (−72% to −81%), but a test file ran on the box during its first reps and its A/A spread out to −16% and +21%. The table is the rerun on an idle box.
- **`bun run bench:core --base main`** (11 paired reps, N = 1,000): every workload passes in Bun, Node and Chromium. The noise controls read +1.0%, +0.2% and +0.5%, and Node's bytes per frame are unchanged. Core's per-frame path doesn't change: only `applyTo`'s `Effect.sync`.
- **The layout lab** (`.tmp/73-proto/drive.ts`: scenarios 1–10 and the drags 11–14, cold and warm, 5 runs each), against #73's final run, which is main. Every scenario holds the same frames: 0 from a task (s1, s6, s7, s9, s10), 1 after the frame's tick (s2–s5, s8). First steps agree within 0.2 px, every run is clean, and `framesToMeasure` is 0 wherever a scenario measures. The drags read 0 frames behind and 0 release held. s8 now triggers at a new driver's first-commit switch (its scenario, changed).
- **Gates:** `bun run typecheck` (and the layout lab's), `bun run lint`, `bun run test` (66 files, 713 tests) and `bun run test:browser` (65 files, 648 tests; no "optimized dependencies changed" in the log).

## Note (#130, 2026-10-18): the gate's live outputs

ADR-0043 decision 5: `FlushGate.valueOf(id, key)` is an Atom of the value the gate last committed for the key, set as a commit changes it. An element with no output pays one `undefined` check per commit. Live values themselves are written upstream of the gate, as this ADR's notes for #130 expected.
