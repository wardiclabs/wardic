# Server render and hydration: no runtime on the server, the server's values until mount

A server render builds no Effect runtime (#41). Each Wardic element renders its **Starting style** (ADR-0003's `project(resolveInitial(config))`) and its static attributes, both computed purely. A client hydrating that markup renders exactly the same until the element mounts: the **Hydration hold**. From mount on, everything runs as in a client-only render. DomLive is client-only, and building it on a server fails with a clear error.

This amends ADR-0003 (the hold), ADR-0006 (a component wrap's `style` until mount) and ADR-0020 (its server-render test runs on DomLive).

## Why

- **Every Wardic element threw on a server.**
  - Inside `<WardicProvider env={DomLive}>`, which SolidStart renders on the server by default, every `wardic.*` element and every `useWardic` call threw `ReferenceError: requestAnimationFrame is not defined` (2026-09-30, at `4d2fa2b`).
  - The provider built its runtime, flush gate and projection system as it rendered. Resolving any one service builds all of DomLive, and three of its four layers read browser globals as they build. Re-measured 2026-10-01 at `9531ff4`: Clock, Input and Probe fail; Renderer builds.
  - The SolidStart example's route returned `HTTP 500` with only a bare provider on it.
- **A runtime on a server costs every request and does nothing there.**
  - Server-rendering the provider added about 119 µs to a bare page, and building DomLive with stubbed globals took 165 µs (Bun 1.3.13).
  - A server has no Refresh frames, and Solid's server build runs no effects, so no animation can start there.
- **Motion builds no runtime on a server.**
  - It skips its VisualElement when there's no `window` ([motion/index.tsx:112](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/motion/index.tsx#L112)).
  - It renders the style purely from its visual state, with the DOM style builder imported directly ([use-props.ts:3](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/render/html/use-props.ts#L3), [:34-49](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/render/html/use-props.ts#L34-L49)).
  - Both are unchanged in `motion` 13.5.0.

## Decisions (grilled 2026-10-01 against Motion @ `16c6122` and `motion` 13.5.0 at runtime)

- **A server render builds no runtime (decision 1).**
  - It renders the Starting style and the static attributes:
    - the drag defaults (`draggable="false"`, `user-select`, `touch-action`);
    - the Reorder group's `overflow-anchor: none` and its items in `values` order;
    - the user's own style merged in.
  - This is ADR-0003 as written ("zero runtime spin-up").
  - The rule is about a server *render*. An engine running on a server for its own sake, with a timer-driven Clock, stays possible (*server-live resume*, deferred below).
- **One Environment Layer; on a server, the DOM's `project` (decision 2).**
  - `env` stays a single Effect Layer, extended the Effect way. `Layer.merge(DomLive, X)` adds or replaces a service, and the later Layer wins (effect 4.0.0-rc.117).
  - A Layer can only be built whole (`Layer.ts:54-57`). So on a server the binding projects with `@wardic/dom`'s `project`, the function DomLive's Renderer wraps, as Motion's binding imports `buildHTMLStyles`.
  - The client keeps the Environment's Renderer.
  - A custom Renderer that projects the Starting style differently from the DOM's: while hydrating, the client seeds with the DOM's `project` as well (the Hydration hold), so hydration keeps the server's style. The Environment's Renderer takes over at the first frame, which a cold-path `wardic.hydration` debug log notes. An element that never animates keeps the server's projection.
- **The binding knows it's on a server (decision 3).**
  - One `isServer` check, from `solid-js/web` (`@solidjs/web` in Solid 2). It reports what Solid is doing (rendering to a string), not which globals exist.
  - On a server the provider builds no gate and no projection system, and holds an unbuilt runtime (`ManagedRuntime.make`, 0.92 µs).
  - The client builds exactly when it did before; ADR-0017's Priming tick and ADR-0018's end-of-task pass are timed against that. Since #51 it builds on first need: *Amendment (#51)*.
  - The server work the check calls is framework-free in `@wardic/dom`, so another binding gets it for free: the Starting style, the style merge and the drag defaults.
- **A lean server path (decision 4).**
  - On a server, `useWardic` and the `wardic.*` wrapper skip the spine and Solid's `splitProps` and `mergeProps`. They build the same markup from the helpers the client uses: 30.4 µs per element → about 9 µs (8.4–10 across runs).
  - Hydration keys must not move. In Solid 1.9, `createUniqueId`, every `createComponent` and every element's key draw from one counter (solid-js 1.9.13 `server.js:375-407`, `web/dist/server.js:608-611`). So the server keeps the client's `createUniqueId` calls and component boundaries, `Dynamic` included.
  - Rendering through `ssrElement` directly (5.1 µs) was rejected, because it depends on `Dynamic`'s internals.
- **A component wrap gets its Starting style through `style` until mount (decision 6).**
  - `wardic.create(Component)` keeps the one requirement the v0.1 plan set: forward the ref. Frames still go through the ref (ADR-0006's commit sink).
  - Until its first frame is committed (on a server, in the hydration render, and on the client until the engine's first commit), the component receives `style` = the user's style + the Starting style + the drag defaults, and `draggable`.
  - From then on it receives only the user's style, plus the drag defaults (an empty style when there's neither: `undefined` would make Solid remove the whole attribute, inline styles Wardic didn't write included). The switch happens inside the first commit, in the frame flush, not in a Measure pass's: the gate calls the commit sink's `beforeFirstCommit` just before its first patch, outside the frame's `batch()`, so Solid removes the Starting-style keys and the commit writes the first frame with no paint in between. Switching at mount painted the element without its Starting style when it mounted inside a frame callback, whose first commit is a frame later; switching in a Measure pass, whose patch may carry only a `layout` node's projection, did the same.
  - Measured in Chromium 147 with five component shapes, each animating `opacity` 0 → 1, and the user's own style changed after it settles:

    | Component shape | Motion 13.5.0 | Copying Motion literally into Solid | This decision | `useWardic` on the component |
    |---|---|---|---|---|
    | forwards its ref only | animates | animates | animates | never animates |
    | ref and `style` on its root | animates | **reset to `opacity: 0`** by the user's style change | animates | animates |
    | ref on the root, `style` on an inner element | **content invisible for good** | **content invisible for good** | animates | animates the inner element |
    | reads `props.style` once (Solid) | – | animates | animates | **invisible for good** |
    | `style` but no ref | **invisible for good, no warning** | throws "forward your ref" | throws | **invisible for good, no warning** |

  - Motion keeps its initial style on the prop, and React writes only the keys that changed. Solid's `style()` writes every key again (solid-js 1.9.13 `web.js:289-298`), so keeping the Starting style on the prop resets animated keys.
- **DomLive is client-only, and says so (decision 7).**
  - `ClockDomLive`, `InputDomLive` and `ProbeDomLive` each check, as their build starts, for the global they need (`requestAnimationFrame`, `document`, `window`). Without it they fail with: "*Layer* can't be built here: there is no *global* (a server render?). Wardic's runtime is client-only (ADR-0003): use it on the client once the element has mounted, never during a server render."
  - `RendererDomLive` builds anywhere.
  - Motion guards `requestAnimationFrame` because it creates its frame loop at module load ([frame.ts:4-11](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/frameloop/frame.ts#L4-L11)). Importing `@wardic/dom` creates nothing, so a server build of DomLive is always a mistake.
  - Under Solid 2's async rendering, a DomLive that looked its globals up lazily would turn that mistake into a hung request: a server waits for an animation that never gets a frame.
- **The Hydration hold for client-only values (decision 8).**
  - On a server, a client-only hook returns a fixed value and starts nothing:
    - `createHover`, `createPress`, `createFocus` and `createInView` → `false`;
    - `createDrag` → `null`;
    - `createReducedMotion` → `false`;
    - `streamToSignal` → its `initial`;
    - `fromAtom` → its new optional `serverValue`, and without one, decision 7's error.
  - A hydrating client renders that same value until mount, then the live one. A client-only render is unchanged.
  - Motion's `useReducedMotion` returns `null` on a server and the live value on the client's first render, which can break hydration.
- **The Effect hooks (decision 9).**
  - `runScoped` and `useWardicFiber` start nothing on a server. They return a fiber that has already ended by interruption, so joining it never hangs.
  - A hydrating client starts them at mount.
  - `useWardicGate` returns a gate that does nothing.
  - Running anything on the runtime during a server render is decision 7's error.
- **Nothing reads the DOM on a server.**
  - During a server render, nothing reads the DOM, the Environment or the runtime.
  - An element's own value (a computed style, an attribute) can only be read on the client, after mount.
  - A base value for a key no config sets must come from the config or from pure defaults on a server, and can be read from the element only after mount (#47, ADR-0022).
- **Tested by hydrating, not by Solid's warnings (decision 10).**
  - Solid 1.9.13 doesn't report most hydration mismatches: an element with a different tag under the same key keeps the server's node, and a different style is patched silently (measured). Only a key with no node throws, in its development build.
  - So a browser test project renders fixtures on the server in Node, through the project's Vite, and hydrates them in Chromium. It checks:
    1. the structure against a client-only render;
    2. that every server node is claimed;
    3. the server's Starting style;
    4. the first paint after hydration;
    5. the value the element settles at.

## Considered Options

- **Make DomLive build anywhere and build the runtime on every server render.** Rejected (decision 1):
  - about 120–185 µs and a throwaway runtime per request;
  - every Environment would have to build without its platform;
  - ADR-0003's "zero runtime spin-up" would no longer hold.
- **A separate server Environment that the provider picks.** Rejected (decision 1): the same per-request cost, and a second Environment whose `project` must never drift from the DOM's.
- **Building the runtime lazily with no server check.** Rejected (decision 3): the client's build would move into the first mount effect, and a later setup-time call would build on a server unnoticed.
- **An Environment value carrying its Renderer beside its Layer** (`{ layer, renderer }`, then `{ renderer, services }`). Chosen at first, then reversed (decision 2): it splits the one Effect Layer a user provides and extends.
- **Motion's `style` prop as is**, and **`useWardic` spread onto the component.** Rejected (decision 6), as measured above.
- **Lazy global lookups in DomLive**, as Motion does. Rejected (decision 7): a mistaken build would succeed silently, or hang.
- **Relying on Solid's hydration warnings.** Rejected (decision 10): it reports only a missing key.

## Consequences

- **New surface:**
  - `@wardic/dom` exports its pure `project`, the Starting-style helpers and an inert Reorder controller for a server render (Tier 2, for binding authors);
  - `fromAtom` gains an optional `serverValue`;
  - the gate's commit sink gains an internal `beforeFirstCommit`;
  - the provider, `useWardic`, the `wardic.*` wrapper and the client-only hooks gain a server branch.
  - Nothing changes on any per-frame path.
- **Costs:**
  - on a server, 0.92 µs for the unbuilt runtime per provider and about 9 µs per element (a 100-element harness);
  - on the client, one signal write per component wrap at its first commit, and per held hook at mount while hydrating; the gate loops, once per frame flush, over the component wraps still waiting for their first commit (usually none).
- **Solid 2** ([upgrade-targets.md](../plans/upgrade-targets.md)):
  - `onMount` becomes `onSettled`;
  - an effect's `compute` half runs on a server, and so do both halves of a render effect;
  - every owner and element key draws from its parent's child counter, so decision 4's rule becomes "the same owners in the same order";
  - `ssrSource: "client"` is Solid 2's own client-only marker.
- **Since #132** the server's stand-ins are `FlushGate.inert` and `ReorderController.inert` in dom's modules, with an inert Layer for a server that runs an Effect program (ADR-0041).
- **Deferred:**
  - server-live resume (ADR-0003's resumability option, #48);
  - the wrapper's own cost, and moving `wardic.div` onto the commit path (#49);
  - inheriting a parent's `initial` variant (ADR-0007, #50);
  - building the runtime lazily on the client (#51; done, *Amendment (#51)*);
  - the gate's frames through the Environment (#52).
- **Pinned by:**
  - `@wardic/dom`, node tier: `server-guard.node.test.ts` (G1–G8: each Layer's client-only error, `project` exported, nothing read at import) and `starting-style.node.test.ts` (ST1–ST14); `svg.browser.test.ts`'s SVG-T1 (the split by tag equals the split by element);
  - the server tier, on DomLive: `packages/solid/test/server.ssr.test.tsx` (SV1–SV18: every element kind's Starting style, the client-only hooks' server values, the Effect hooks, the client-only error, the hydration keys against `9531ff4`'s, no runtime built, reactive props over Wardic's keys, string styles) and `reorder.ssr.test.tsx` (SS0–SS6);
  - the hydration project, `packages/solid/vitest.hydrate.config.ts`: `server-render.hydrate.browser.test.tsx` (HY1–HY6 for fixtures F0–F12, HY-L1–HY-L4 for a custom Renderer, and HY-H1–HY-H3 for the Hydration hold of client-only values), in Chromium (and in Firefox through a local config);
  - `create-shapes.browser.test.tsx` (CS1–CS10: the component shapes, including a mount inside a frame callback, a `layout` wrap, and inline styles Wardic didn't write);
  - the SolidStart example's `/ssr` route and its hydration report (`examples/solid-start-basic`), the hand check.

## Amendment (#57, 2026-10-06): an identity `initial` server-renders `transform: none`

- The Starting style stays `project(resolveInitial(config))`, and `project` now writes `transform: none` when every transform key is at its **Identity** (ADR-0023). So `initial={{ scale: 1 }}` (or `x: 0`, `z: 0`, `rotate: "0deg"`) server-renders `transform: none`, where it rendered `transform: scale(1)`, and an `initial` with a non-identity key renders only that key's function. It's Motion's server markup (`motion` 13.5.0, `renderToString`: S1–S3, S6, S7, S11, S12 in [identity-transform.md](../research/identity-transform.md)).
- The hydrating client holds the same Starting style (the Hydration hold), and a custom Renderer's hydration seed is the DOM's `project` (decision 2), so server and client still agree by construction. The first frame after mount continues from `none`.
- Not taken: opting the Starting style out to keep the identity functions. It would no longer be `project(resolveInitial(config))`, and the first frame after mount would switch `scale(1)` to `none`.
- **Pinned by** `starting-style.node.test.ts` ST15–ST16, `server.ssr.test.tsx` SV20 and the hydrate project's F15 (held, then animated) and F16 (held at rest).

## Amendment (#79, 2026-10-12): decision 6's switch is every element's, and `style` gives up the keys Wardic holds

ADR-0034 decides it.
- **A `useWardic` spread, and so `wardic.*`, takes decision 6's switch.** The gate commits its frames onto the element, so its `style` carries the Starting style until the first commit, and from then on the user's style. The server render and the Hydration hold are unchanged: they're the same `style` until that commit.
- **After the first commit, `style` is the user's style without the keys the gate holds,** on component wraps too. Decision 6's "only the user's style" let a reactive user style write over an animated key, and a CSS-text style wipe every key Wardic wrote. Wardic's value now wins a key while it drives it, and a CSS-text style is parsed.
- **The switch runs inside the frame's `batch()`,** with every other element's, not outside it, before any commit. A first commit still lands with no paint in between.
- **The table's last column, `useWardic` on the component,** now follows the ref: the gate commits onto the element the ref reaches.
  - Ref on the root, `style` on an inner element: the root animates, and the inner element shows the Starting style until the first commit (`style-fallback.browser.test.tsx` F6).
  - Forwards its ref only: animates (F7).
  - Reads `props.style` once: shows the Starting style, then animates (F8).
  - `style` but no ref: never animates, as before. Unlike a component wrap, it gives no warning (inferred from the code: the spine starts on the ref).

## Amendment (#50, 2026-10-12): the server renders each element's variant context, and a Variant child's inherited `initial`

ADR-0007's *Amendment (#50)* sets the rule: every Wardic element hands its children a variant context, and a Variant child inherits its ancestor's `initial` and `animate` names. On a server it resolves through the same function as on the client (`variant-node.ts`), once.

- **The same nesting.** An element that changes what its children read renders its variant context's Provider where the client does: it has variants of its own, or it sets `inherit={false}`. Each Provider is a component boundary and draws a hydration key (decision 4). The decision is made once, at setup, from the same props on both sides, so the nesting never changes after mount. Only the names inside the context follow later changes.
- **Names only, read once.** The server's context carries the names and inert orchestration: stagger and `when` are timing and never change the markup.
- **The markup comes from `initial` only.** A Variant child's Starting style is its own `initial`, else its ancestor's `initial` name resolved against its own `variants`. The inherited `animate` name never reaches the markup, as before. Motion's server render is the same: its values come from `animate` only under `initial={false}`, which Wardic doesn't have.
- **The Hydration hold is unchanged.** The client's first render resolves the same names to the same Starting style, and holds it until the first commit (the hydrate project's F18: a variant list entering from its `initial` name).
- **The keys fixture changed in one place** (SV15, re-recorded): the `wardic.span` with `variants` under `Spread`'s `ward.Provider` now renders its own Provider. Every other key is still 9531ff4's.
- **Rejected: a Provider on every element** (the grill's first answer, before measuring). It cost about 1.2 µs per plain element on a server, +37% of a `wardic.div`'s server render (1,000 elements, 9 alternating pairs: 3.09 → 4.25 ms), for nothing a child could read.

## Amendment (#51, 2026-10-15): the client builds on first need

Decision 3's client bullet changes. A client `WardicProvider` used to build its runtime, flush gate and projection system as it rendered, even with nothing animated under it. Now it builds on first need:
- **The runtime** builds itself on its first run. Making it builds nothing; it's Effect's `ManagedRuntime`.
- **The gate, the projection system and the reduced-motion inputs** (the Probe's preference, the Positional keys) build together, the first time a Wardic element or hook reads any of them from context. That's during the first element's render.

A provider with nothing from Wardic under it, say at an app's root over a route that doesn't animate, builds nothing.

- **Measured** on the bench server: a Vite production build, a fresh page per rep, 15 reps. The render task of a provider over a plain `div`, against the `div` alone (`.tmp/51/`):

  | | Chromium 147 | Firefox 148 |
  |---|---|---|
  | plain `div` | 0.39 ms | 0.18 ms |
  | provider + `div`, before | 4.28 ms | 2.12 ms |
  | provider + `div`, after | 0.76 ms | 0.26 ms |

  - **The build itself,** inside the first element's render now: the runtime 2.7 ms in Chromium and 1.7 in Firefox, and the projection system 0.85 and 0.12.
  - **What an idle provider no longer sets up:** the Probe's `prefers-reduced-motion` media query, its window `resize` listener and its media-query `change` listener. It set no frames before either: the Clock idles.
  - #51's 165 µs was Bun with the globals stubbed.
- **Why decision 3's timing reason no longer holds:**
  - **The Priming tick is gone** (ADR-0033).
  - **The end-of-task Measure pass is ordered as before:** the build happens at the first read, in the first element's render, before any element registers with the gate or the projection system. `measure-pass-timing` and `clock-cold-start` pass unchanged.
  - **The build is inline:** a `ManagedRuntime`'s first run builds its Layer before it returns (checked with DomLive in Chromium), so the first element's synchronous `runSync`s and forks keep working.
- **The *Considered option* rejected above,** "building the runtime lazily with no server check", stays rejected. The server check stays, and the server path is unchanged (SV1–SV18). The client's build moves into the first element's render, not into a mount effect.
- **Grilled 2026-10-15, all A:**
  - **The first read builds it** (Q1). Rejected: building at the first use, which would need stand-ins for the gate and projection on calls the gate makes every frame; keeping the eager build.
  - **The pieces build together** (Q2). Every `useWardic` element registers its values with the projection system at mount, so per-piece laziness would save nothing. Reading the runtime alone builds none of them.
  - **Checks** (Q3) and **this amendment** (Q4).
- **Defaults stated:**
  - **A build failure surfaces at the first element.** An `env` that fails to build now fails at the first element's render, caught by the nearest error boundary there, not at the provider.
  - **Teardown:** a provider that never built disposes only its unbuilt runtime.
- **Pinned by** `packages/solid/test/provider-lazy.browser.test.tsx`:
  - LZ1: a provider with nothing from Wardic under it builds nothing over several frames;
  - LZ2: the first element builds it during its render, with one gate however often it's read, and animates;
  - LZ3: a never-built provider unmounts cleanly and builds nothing on its way out;
  - LZ4: one that built disposes what it built, its projection system's `resize` listener included. That's main's teardown too, unpinned until now.

  LZ1 and LZ3 fail on main. Five single-point mutations of the provider are all caught: an eager build, no memo, a build in teardown, no teardown, and a build on reading the runtime.

## Amendment (#48, 2026-10-19): Appear animations play through the Hydration hold

ADR-0044 decides it, on decision 1's opening: still no runtime on a server, and the markup now carries CSS.
- **A qualifying element's mount animation plays from first paint:** its inline style names `animation: var(--wardic-aN)`, and the head's `<style>` holds the rule and the custom property. That is the **Appear animation**. With no rule, an element keeps its Starting style until mount, as before.
- **The Hydration hold still holds the element's own style;** the CSS animation draws over it until the **Handoff**, which decision 6's switch (`beforeFirstCommit`) carries out: the first commit writes the engine's frame and removes the CSS animation in one task.
- **"Deferred: server-live resume (#48)"** is closed by it: the gap before hydration was the problem, and no server engine is needed.
