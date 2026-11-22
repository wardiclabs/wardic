# #881: step 0's probes (#564, ADR-0073)

Four probes, run 2026-11-22 against `main` at a9399b49: Solid 2.0.1, Chromium through Vitest's browser mode (Playwright), and Node through Vitest's `node` environment. No product code.

```sh
bunx vitest run --config .tmp/564-step0/vitest.browser.config.ts --silent=false          # probes 1, 2 and 4, Chromium
bunx vitest run --config .tmp/564-step0/vitest.node.config.ts --silent=false             # probe 3, Node, the browser condition
CONDITIONS=node bunx vitest run --config .tmp/564-step0/vitest.node.config.ts --silent=false   # probe 3, Node's own conditions
```

## 1. A pending read in `animate` (8c, decision 21): as hoped, with one catch

`p1-pending-target.browser.test.tsx`. The scene's shape: the ward is made in a component that renders nothing, under `<Loading>`, and given an element outside the region (`ward(config)(el)`), as `ward(mesh, …)` will be. A 300 ms tween, x read each painted frame.

| Probe | What it did |
|---|---|
| P1a, first load (data at 300 ms) | still at x 0 until the data landed, then one flight to 100; no errors |
| P1b, a refetch | held at 100 for the 250 ms the memo was pending, then one flight to 200; no backtrack |
| P1c, the index changes as its list refetches | held at 100, then one flight to 250, the new list's: no stop at 200, the old list's value at the new index |
| P1d, no boundary | the same as P1a, with no error |
| P1e, `initial: { x: 50 }` | **x 0, the Subject's own value, until the data landed; then 50 → 100**. `initial` is written when the ward starts, not while it waits |
| P1e, the region | **no fallback** while only the ward's read is pending; with a sibling rendering the data, the fallback shows |

So the spine holds the Subject still while `animate` is pending and flies once it resolves: no throw, no `undefined`, no second retarget. The catch: a Subject already drawn sits at its own value until then, and `initial` lands with the data. On the DOM the held region hides that (async-config's AC1); in a scene nothing hides it.

## 2. `onSettled` under `<Loading>` and `<Reveal>` (8k, decision 21): not in the scene's shape

`p2-onsettled.browser.test.tsx`. a's data lands at 300 ms, b's at 100 ms.

| Probe | `onSettled` | `<Reveal>` |
|---|---|---|
| P2a, DOM's shape: data read in JSX | 303 ms, after the data | — |
| P2b, scene's shape: data read only in a ward's config, rendering nothing | **8 ms, before the data** (301 ms) | — |
| P2c, data read only in a `createEffect` compute, rendering nothing | **1 ms**; the effect applied at 301 ms | — |
| P2d, DOM's shape, two siblings | both at 301 ms | b held until a: both revealed at 316 ms |
| P2e, scene's shape, two siblings, compute reads | **both at 0 ms** | **not ordered**: b's effect at 101 ms, a's at 301 ms |
| P2f, scene's shape, two siblings, ward reads | both at 4 ms | **not ordered**: b animated at 132 ms, a at 332 ms |
| P2g, rendering an expression that reads the data and draws nothing | **both at 302 ms** | **ordered**: b's effect held to 302 ms; fallbacks shown |

`onSettled` and `<Reveal>` follow what a component *renders*. A component that renders nothing doesn't join its boundary, whatever its computations read: `onSettled` runs at once, `<Loading>` shows no fallback, and `<Reveal>` doesn't order it. Rendering a read that draws nothing (`<>{() => (data(), undefined)}</>`) joins it: the fallback, `onSettled` after the data, and the reveal order all come back.

## 3. A context over `null` components in Node (decision 26): yes, on the browser condition, read inside a root

`p3-node-tree.node.test.tsx`, Vitest's `node` environment: no `document`, no `window`.

| Conditions | Solid's build | What ran |
|---|---|---|
| `browser`, `development` | client (`isServer` false) | the context read; effects ran and re-ran; `onSettled` and every cleanup in order on dispose; an async memo under `<Loading>` applied once it landed; `@wardic/solid`'s root imported (82 exports) |
| Node's own (`node`, `development`) | server (`isServer` true) | component bodies only: no effect, no `onSettled` |

Two things a `TestStage` needs: its node-tier project resolves Solid on the `browser` condition, and it mounts the tree itself, read inside a root, as a renderer would (`children(tree)` and a render effect reading it): built JSX that nothing reads runs its components outside any owner, and their effects never run. Vite's client pipeline (a custom environment, `env-node-client.ts`) changed nothing.

## 4. Solid's effect under a pumped loop (decision 19, Q7): a frame late, as inferred

`p4-pumped-effect.browser.test.tsx`, 30 frames each, Chromium. three's `setAnimationLoop` calls its callback from `requestAnimationFrame` (`WebGLAnimation.js`, `context.requestAnimationFrame(onAnimationFrame)`), the XR session's while presenting, so a rAF callback stands in for it.

| Probe | `render()` read |
|---|---|
| P4a, `frame(t)` then `render()` in one callback | **last frame's value, 30 of 30 frames** |
| P4b, `frame(t)`, `flush()`, `render()` | this frame's, 30 of 30 |
| P4c, window rAF, the writer's callback asked first | this frame's, 30 of 30: Solid's microtask flush runs between the callbacks |
| P4d, window rAF, the renderer's callback asked first | the writer's previous frame, as its order allows |

ADR-0073 decision 19's inference holds, now measured: in the Host loop's one callback, Solid's own effect lands a frame late. `flush()` before `render()` lands it in time.

## What this asks of ADR-0073

- **Decision 19:** "an inference" becomes measured (P4a), with `flush()` as the way Solid lands it now (P4b).
- **Decision 21's 8c:** confirmed in the scene's shape (P1a–P1d).
- **Decision 21's 8k, and decision 10's "pending: it waits":** a scene hook rendering nothing doesn't join `<Loading>` or `<Reveal>` (P2b, P2e, P2f), and an object already drawn shows its own pose until its data lands (P1e). It joins only through what the component renders (P2g).
- **Decision 26:** `TestStage`'s node tier on the `browser` condition, with a mount of its own (probe 3).

## The owner's decisions (2026-11-22)

- **An opt-in renderable, `held`:** a scene hook's handle (`createSceneObject`'s, a scene `ward`'s) has `held`, which renders nothing and reads the hook's pending Subject and config. A component that returns it (`return card.held`) joins its `<Loading>` and `<Reveal>`: the fallback, `onSettled` after the data, the reveal order (P2g). `return null` still works: the object enters once its data lands (P1), with no fallback or reveal order. A ward itself can't be returned: it's a ref callback, which Solid would call.
- **A Scene object joins when ready:** `createSceneObject` adds its object once its ward can start, its Subject and every pending config key landed, `initial` written in the same frame, so its first drawn frame shows `initial`. A `ward(mesh, …)` on an object already drawn keeps its own pose until its data lands, which the docs say.
