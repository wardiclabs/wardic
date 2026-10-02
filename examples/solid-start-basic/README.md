# @wardic/example-solid-start-basic

A minimal [SolidStart](https://start.solidjs.com) app used as a live sandbox for the
`@wardic/*` packages. It renders through SSR, so it exercises Wardic's SSR-correctness
story as the binding grows.

```sh
# from the repo root
bun install

# then, from this directory
bun dev      # http://localhost:3000
bun run build && bun start   # production build + serve
```

The home route imports a marker from `@wardic/core`, `@wardic/dom`, and `@wardic/solid`
to prove the workspace chain resolves and builds. Swap it for real demos as the engine
and Solid binding gain features.

The `@wardic/*` packages are listed in `ssr.noExternal` (see `app.config.ts`) because
they ship TypeScript source — Vite transpiles them (and, later, runs the Solid JSX
transform on any `.tsx` they add).

## `/ssr`: the hydration check (#41)

`/ssr` renders every Wardic element kind on the server, then hydrates it (ADR-0021):
`wardic.div`, a `useWardic` spread, `wardic.create(Card)` in three shapes, a `drag="x"`
element, a `Reorder.Group`, an SVG `wardic.circle`, an `AnimatePresence` child, a
`layout` element in a `LayoutGroup`, and a `createReducedMotion()` readout. Each starts
faded and offset, as the server rendered it, and moves to rest once it hydrates.

Under the page, a **hydration report** judges each element:

- **OK**: hydration kept the server's node and attributes, and the first paint after
  hydration shows what the server painted (or the animation's first step from it);
- **FLASH**: the first paint jumped away from the server's paint;
- **MISMATCH**: hydration replaced the node or changed its attributes (or the reduced-motion
  readout wasn't `false` on the server and the live preference after mount).

`card-ref` (a component that applies no style) has no Starting style on the server, by
design; its row is still OK.

Run it in Chrome and Firefox, on `bun dev` (http://localhost:3000/ssr) and once on
`bun run build && WARDIC_SAVE_LOG=1 bun start` (the save-log route answers only in dev, or
with that variable):

1. **JavaScript disabled** (DevTools → Settings → Debugger → Disable JavaScript), reload:
   the server's paint, every element faded and to the left, nothing missing, no 500.
2. JavaScript on, **throttled** (Performance → CPU 6× slowdown, or a slow network),
   reload: the server's paint holds until hydration, then each element moves to rest with
   no jump to its end and back. Every report row is OK.
3. **Reduced motion emulated** (Rendering → Emulate CSS prefers-reduced-motion: reduce),
   reload: the readout is `false` in the server's paint and `true` after mount; no
   MISMATCH.
4. **Drag** the `drag="x"` card, **reorder** the list, toggle the `AnimatePresence` child and
   resize the layout element.
5. **Save log to repo**: the report writes `logs/<timestamp>.json` here (gitignored).

