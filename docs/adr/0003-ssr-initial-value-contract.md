# SSR initial-value contract

The initial style for an animated element is resolved **synchronously and purely** as `project(resolveInitial(config))` — never by running the engine or a Stream — so the server emits it with zero runtime spin-up and the client hydrates with a bit-identical seed (no mismatch). That single resolved value is the one source of truth: it seeds the SSR style, the hydration seed, **and** the animation Stream's `from`, so frame 1 flows continuously out of the seed with no snap. A *static or variant-name* `initial` is SSR-serialized; a *function* `initial` is treated as client-only first-frame (it may flash), because "is it a function?" is decidable whereas "is it pure?" is not.

## Considered Options

- **Run the engine for one `dt=0` frame to extract the initial** — rejected: requires an Effect runtime + one-tick Clock spin-up per animated element on every server render, and a fragile synchronous `runSync` extraction, to buy "no drift" that pinning `from` to the resolved value already gives for free.
- **Run a function `initial` on the server** — rejected: it reads runtime state (signals, `window`, time) that differs server↔client, producing hydration mismatches, and runs arbitrary user code in the synchronous render path.
- **Two-pass / resumability serialization** — deferred: guarantees a match even for computed initial, but couples Wardic to a specific SSR framework's hydration mechanism; revisit only if computed-initial-SSR becomes a real demand.

## Consequences

Measurement-dependent initial (`%`→`px`, `layout`/FLIP starts) cannot be resolved on the server and will flash — a hard boundary, since layout is post-mount. A function `initial` silently forfeits SSR, so the binding should dev-warn when it sees one. The reactive render path writes a signal per frame (N writes/frame for N elements); the imperative `applyTo` path is cheaper at scale and exists partly for that reason.

## Amendment (#41, 2026-10-01): the server builds nothing; a hydrating client holds the server's values

The contract holds as written, and ADR-0021 implements it: a server render builds no runtime, and DomLive fails if it's built on a server. One addition: the Starting style is also what a hydrating client renders until the element mounts. So is every other value the server rendered, such as a client-only hook's `false` (the **Hydration hold**, ADR-0021, decision 8). The engine starts at mount from the Starting style, as before.

## Amendment (#47, 2026-10-02): a key `initial` doesn't set starts from its Base value

The seed holds for every key `initial` sets. A key it doesn't set (an `animate` key, a gesture's, an exit's) has no Starting style. The animation's `from` for it is its Base value's start links: its `style` value, else the element's Own value, read on the client after mount, never on a server (ADR-0022). Before, it started at 0, and a hydrating client blinked such a key to 0 at mount.

## Amendment (#134, 2026-10-13): `initial={false}` starts at `animate`

Motion's `initial={false}` renders an element at its `animate` and skips its mount animation (`.reference/motion` at `16c6122`: `use-visual-state.ts:87-92` and `:112`, `animation-state.ts:441`). Wardic took a values map or a variant name only, so the only way to skip a mount animation was to repeat `animate` in `initial`. The grill (2026-10-13) took Motion's rule.

1. **With `initial={false}` the Starting style is the element's `animate`, resolved once at setup (Q1)**: a values map as it is, a name through `variants`. A **Variant child** with no `animate` of its own takes the name its ancestor hands down, as Motion's `context.animate`. It is the seed, the server's markup and the style the hydration render keeps, so the element paints at its target from the first frame. Keys `animate` doesn't name start from their Base values (ADR-0022). Wardic's `animate` has no keyframe arrays and no `transitionEnd`, so Motion's last-keyframe rule doesn't arise. Rejected: starting from the Base values and making the first Retarget jump to `animate`, which renders the server without the `animate` values and snaps after hydration.
2. **Only the mount is held (Q3)**, as Motion's `isInitialRender && blockInitialAnimation`: the first Retarget starts nothing, every `animate` key being there already, and orchestration has nothing to sequence. Anything that turns on after the mount animates as usual: a later `animate` change, hover, press, focus and `whileInView`, an element in view at mount included, since its observer reports after the mount. Rejected: starting states true at mount at their targets, which isn't Motion's and can't be server-rendered.
3. **Every surface that reads `initial`** takes `false` (`initial?: WardicValues | string | false`): `wardic.*`, `wardic.create(Component)`, `useWardic`, and their server renders. `use:ward` stays client-only. `@wardic/dom`'s `resolveInitial` resolves it (`initial: false` with `animate`), so every binding renders the same Starting style.
4. **The layout lab** (Q6): scenario 15's board gains three mount cells, judged on its `start` and `end` lines: an element, a Variant child, and an `<AnimatePresence initial={false}>`'s child.

The Base value side is ADR-0022's *Amendment (#134)*; the hand-down and `<AnimatePresence initial>`, ADR-0007's.

### Measured

`.tmp/vel/` (framer-motion 13.4.0, Chromium 147 and Firefox 148, 3 runs each), each mounted on a step and read every frame:

| Scene | Motion | this change |
|---|---|---|
| `mount-false`: `initial={false} animate={{ opacity: 0.5, x: 100 }}` | first painted at 0.5 and x 100; no step | the same |
| `mount-false-list`: a list with `initial={false} animate="shown"`, three Variant items, `staggerChildren` | each item first painted at its `shown` 0.6; no step | the same |
| `presence-false`: `<AnimatePresence initial={false}>`, a child `initial={{ opacity: 0 }} animate={{ opacity: 0.5 }}`, out and back in | first painted at 0.5; the re-entry starts at 0.001–0.008 and fades in | first painted at 0.5; the re-entry starts at 0.013 (its first painted frame is one step in, ADR-0033) and fades in |

The layout lab, scripted (`.tmp/vel-lab/drive.ts`, `ONLY=s15n`): the three no-mount cells read `start from 0.500 (base 0.5) ✓` and `end settled at 0.500 ✓` on each Remount, the presence's later entry `start from 0.013 (base 0) ✓`. On main's engine the cells start at 0.987 or 0.013 and fail their `start` line.

The SolidStart sandbox's `/ssr` (ADR-0021's hand check) has the same three, as the `held` rows. Its hydration report reads them **MOVED** unless the server paints them at their `animate` and they stand still in every frame after hydration. Driven headless (`.tmp/vel/ssr-report.ts`), 3 runs each in Chromium and Firefox: 14/14 OK, each held row at 0.500 from the server's paint to settled. A hand run in Chrome is the same. With JavaScript off, the server's markup carries `opacity:0.5` and `translateX(24px)`. Toggled out and back in, the presence's child fades in from its `initial`. On main's packages the three read MOVED: the server painted 1.00 (or 0.25 for the presence's child), then they moved. The old FLASH rule passed them, since their first paint was within 0.15 of the server's.

### Pinned by

- `packages/solid/test/initial-false.ssr.test.tsx`, IS1–IS9: the server renders `animate` (a map, a name, through `useWardic` and a component wrap), a Variant child's inherited `false`, a child's own `initial` kept, an element naming no variants keeping its `false` to itself, `inherit={false}`, and `<AnimatePresence initial={false}>` (IS9 its guard).
- `packages/solid/test/initial-false.browser.test.tsx`, IF1–IF11, painted values read every frame: no motion at mount (a `wardic.div`, `useWardic`, a component wrap, before the first frame too); a later `animate` change and a hover animate (IF3, IF4); a key dropped from `animate` stays where it started, or goes to its `style` value (IF5, IF6, IF10); Variant children start at the list's `animate` and follow it; the presence's first child held, its later entry animated (IF9); IF2 a guard.
- `server-render.hydrate.browser.test.tsx`, fixtures F19–F21: the markup carries `animate`, and nothing moves at the first paint after hydration or after it.
- `packages/core/test/base-value.test.ts` B13, B14: the chain's `started` link after `style`.
- On main, IS1–IS4, IS6, IS8, IF1, IF4–IF11 and F19–F21's HY3 (F19 and F21's HY4 too) fail; the others pin what main already did.
- Mutation-checked: 14 single-point mutations of the new code, each failing the test meant for it.
