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
  - The client builds exactly when it did before; ADR-0017's Priming tick and ADR-0018's end-of-task pass are timed against that.
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
  - A base value for a key no config sets (#47) must come from the config or from pure defaults on a server, and can be read from the element only after mount.
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
- **Deferred:**
  - server-live resume (ADR-0003's resumability option, #48);
  - the wrapper's own cost, and moving `wardic.div` onto the commit path (#49);
  - inheriting a parent's `initial` variant (ADR-0007, #50);
  - building the runtime lazily on the client (#51);
  - the gate's frames through the Environment (#52);
  - #47.
- **Pinned by:**
  - `@wardic/dom`, node tier: `server-guard.node.test.ts` (G1–G8: each Layer's client-only error, `project` exported, nothing read at import) and `starting-style.node.test.ts` (ST1–ST14); `svg.browser.test.ts`'s SVG-T1 (the split by tag equals the split by element);
  - the server tier, on DomLive: `packages/solid/test/server.ssr.test.tsx` (SV1–SV18: every element kind's Starting style, the client-only hooks' server values, the Effect hooks, the client-only error, the hydration keys against `9531ff4`'s, no runtime built, reactive props over Wardic's keys, string styles) and `reorder.ssr.test.tsx` (SS0–SS6);
  - the hydration project, `packages/solid/vitest.hydrate.config.ts`: `server-render.hydrate.browser.test.tsx` (HY1–HY6 for fixtures F0–F12, HY-L1–HY-L4 for a custom Renderer, and HY-H1–HY-H3 for the Hydration hold of client-only values), in Chromium (and in Firefox through a local config);
  - `create-shapes.browser.test.tsx` (CS1–CS10: the component shapes, including a mount inside a frame callback, a `layout` wrap, and inline styles Wardic didn't write);
  - the SolidStart example's `/ssr` route and its hydration report (`examples/solid-start-basic`), the hand check.
