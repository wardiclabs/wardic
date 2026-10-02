# Server render and hydration (#41): what Solid, Effect and Motion do, and what it costs

> **Read at:** 2026-10-01 (UTC) · **Sources:**
> - `solid-js@1.9.13` (the repo's, `packages/solid/node_modules/solid-js`): `dist/server.js`,
>   `web/dist/server.js`, `web/dist/web.js`, `web/dist/dev.js`.
> - `solid-js@2.0.0-rc.13` and `@solidjs/web@2.0.0-rc.13` (`@solidjs/signals@0.13.13`), the `next`
>   tags on 2026-10-01, installed from npm: `dist/server.js`, `web.js`.
> - `effect@4.0.0-rc.117` (`src/Layer.ts`, `src/ManagedRuntime.ts`, `src/Latch.ts`).
> - Motion at `motiondivision/motion@16c61222c4166bbef5ff6ab0051192faa79fa8c8` (`.reference/motion`),
>   and `motion@13.5.0` (framer-motion and motion-dom 13.5.0, the latest on 2026-10-01) with React
>   19.3.0 at runtime.
> - Vitest 5.0.2 (`dist/chunks/plugin.d.*.ts`).
>
> Wardic paths are prefixed `wardic:` and read at `9531ff4` (before the fix) unless a commit is
> given. The decisions are ADR-0021; this page is the evidence behind them.

## Summary

At `9531ff4` every Wardic element threw on a server, because the provider built its Effect
runtime as it rendered and three of DomLive's four layers read browser globals as they build.
Motion never builds its runtime on a server, and Solid's server build runs only component setup,
so Wardic's fix renders each element's Starting style purely and builds nothing there. A runtime
on a server cost 99–165 µs per request and did nothing; after the fix a provider renders in
14–24 µs per request (a bare page is about 10 of it) and a `wardic.div` costs about 9 µs (it was
30). Solid 1.9.13 doesn't report most
hydration mismatches, so the tests and the hand check compare markup and nodes themselves.

## What failed at `9531ff4`

- Building each DomLive layer with no DOM (`Layer.build` under Bun): `ClockDomLive` died with
  `ReferenceError: requestAnimationFrame is not defined`, `InputDomLive` with `document is not
  defined`, `ProbeDomLive` with `window is not defined`; `RendererDomLive` built.
- The provider built the runtime, the flush gate and the projection system while rendering
  (`wardic:packages/solid/src/provider.tsx:74-86`); the gate and the projection system resolved
  the Renderer with `runSync` at once (`gate.ts:125`, `projection.ts:477`, `:495`), which builds all
  of DomLive.
- The SolidStart example's route (a bare `<WardicProvider env={DomLive}>`) returned `HTTP 500` on
  its production build, with the `ReferenceError` serialized into the hydration data.

## Solid 1.9.13 on a server, and while hydrating

- Only component setup runs: `createEffect` and `onMount` do nothing (`dist/server.js:78`, `:119`);
  `createRenderEffect` and `createMemo` run once (`:67-77`, `:84`).
- `renderToString` disposes its root on a `setTimeout` (`web/dist/server.js:199-201`), so a
  provider's `onCleanup` runs on the server after the render.
- `createUniqueId`, every `createComponent` and every element's hydration key draw from one
  counter (`dist/server.js:375-407`, `web/dist/server.js:608-611`). A server path may skip any
  work that doesn't draw from it, but must keep every `createUniqueId` call and component boundary.
- `isServer` is a constant: `true` in `web/dist/server.js:763`, `false` in `web/dist/web.js:700`.
- A client knows it's hydrating: `sharedConfig.context` is set for the length of `hydrate()`
  (`web/dist/web.js:357-360`).
- The client's `style()` writes every key again on each re-run: it empties its record of the
  previous values before comparing (`web/dist/web.js:289-298`).
- Hydration reports little (measured in Chromium, development build): an element with a different
  tag under the same key claims the server's node with no error, and a different `style` is
  patched silently. Only a key with no node throws (`web/dist/dev.js:375-379`).

## Solid 2.0.0-rc.13 (for the Solid 2 port)

- No `onMount`; `onSettled` does nothing on a server but draws an id (`dist/server.js:1828-1831`).
- `createEffect(compute, effect)` runs `compute` on a server; `createRenderEffect` runs both halves
  (`:998-1061`).
- Every owner and element key draws from its parent's child counter (`allocateOwner` `:72-74`,
  `getNextContextId` `:9-14`); `createComponent` is `Comp(props)` (`:1873-1875`).
- `ssrSource: "client"` skips a computation on a server, and its read needs a `<Loading>` boundary
  (`:999-1002`, `:377`).
- `isServer` is exported by `@solidjs/web` (`server.js:4278`; `web.js:2002`).

## Effect `4.0.0-rc.117`

- A Layer only has `build(memoMap, scope)` (`src/Layer.ts:54-57`): one service can't be read from
  a merged Layer without building all of it.
- `ManagedRuntime.make` builds nothing; the Layer builds on the first `run*`
  (`src/ManagedRuntime.ts:309-323`, `:347-370`). An unbuilt `make(DomLive)` costs 0.7–0.9 µs.
- `Layer.merge(a, b)`: the later Layer wins for a service both provide; a Layer providing extra
  services is accepted where fewer are required (`interface Layer<in ROut, …>`).
- A build defect surfaces from `runSync` as a plain `Error` with its message.
- `Latch.makeUnsafe` / `await` / `open` (`src/Latch.ts:161`, `:87`, `:216`): a fiber can exist at
  setup and start its effect at mount. `Effect.runFork(Effect.interrupt)` gives a fiber already
  ended by interruption (1.1 µs warm).

## Motion

- On a server it never creates the VisualElement: `motion/index.tsx:112`
  (`if (!isStatic && typeof window !== "undefined")`), unchanged in 13.5.0
  (`dist/es/motion/index.mjs:52`). The style comes from the pure visual state
  (`use-visual-state.ts:60-132`, which also inherits a parent's `initial` variant and handles
  `initial={false}`) through `buildHTMLStyles`, imported directly (`render/html/use-props.ts:3`).
- Its frame loop is created at module load, with `requestAnimationFrame` guarded
  (`motion-dom/src/frameloop/frame.ts:4-11`; 13.5.0 `frame.mjs:5`).
- `motion.create(Component)` passes `style` (and the drag props) to the component
  (`use-render.ts:46-47`, `use-props.ts:34-83`); its VisualElement keeps `latestValues` current
  (`VisualElement.ts:396-397`, `:577`), and React writes only changed keys.
- `useReducedMotion` returns `null` on a server and the live value on the client's first render
  (`use-reduced-motion.ts`, `state.ts:6`).
- At runtime (13.5.0, React 19.3.0, Chromium 147), five component shapes animating opacity 0 → 1,
  then the user's style changed:

  | Shape | Motion | Wardic, after #41 |
  |---|---|---|
  | forwards its ref only | animates | animates |
  | ref and `style` on its root | animates | animates |
  | ref on the root, `style` on an inner element | content stays invisible | animates |
  | reads `props.style` once (Solid) | – | animates |
  | `style` but no ref | invisible, no warning | throws "forward your ref" |

## What a server render costs

Measured with Bun 1.3.13 / vitest 5.0.2, Solid's server build, a page of 100 elements under a
provider, three rounds of 400 renders, median (`.tmp/ssr/*`, `packages/solid/.tmp/*`, gitignored):

| | `9531ff4` (TestLive runtime) | After #41 (DomLive, never built) |
|---|---|---|
| a provider, per request (with a bare page, about 10 µs alone) | 128.5 µs (99 µs TestLive's runtime; 165 µs DomLive's with stubbed globals) | 14–24 µs across runs |
| `<wardic.div>`, per element | 30.4 µs | 8.4–10 µs (about 3.3× the harness floor in every run) |
| a `useWardic` spread, per element | 9.8 µs | 3.4–4.3 µs |

Most of a `wardic.div`'s cost at `9531ff4` was Solid's server `splitProps` (7.4 µs with 21 motion
props), `Dynamic` (4.5 µs) and the double spread, not the runtime (0.34 µs per lookup).

## After the fix

- Node and server tiers: 394/394. The hydration project: 85/85 in Chromium and in Firefox. The
  component shapes: 10/10 in Firefox. The full browser gate: 478/479, RB1 the only failure.
- The SolidStart example: `/` and `/ssr` return 200 on the production build; the `/ssr` hydration
  report is 11/11 OK in Chromium 147 and Firefox 148, on the build and on dev.
- `projection-resize-block` RB1 fails in the full browser gate on this branch and at `9531ff4`
  alike (a fixed 50 ms wait for a `resize` event), and passes alone (#53).

## Not checked

- Safari / WebKit.
- Solid 2's hydration flag, and running Wardic on Solid 2 at all.
- Solid's production build's hydration reporting.
- How Motion's component path avoids resetting styles under React re-renders, beyond the memoized
  style (inferred from React's prop diff).
