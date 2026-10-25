# Wardic Northlight, the storefront showcase

A made-up ceramics and glass shop whose every feature is a Wardic example: the demo, a short "why", and the code, on one page per pattern (#296). It's built twice, once per binding, so each shows its own Solid's way of doing things.

| App | Stack | Shows |
|---|---|---|
| [`solid1`](solid1) | SolidStart 2.1 on Solid 1.9, `@wardic/solid` | Solid 1 patterns: `createAsync` over Solid Router's `query`, `action`, `<Suspense>` |
| [`solid2`](solid2) | Solid 2 on `@solidjs/vite-plugin` (`start: true`, `ssr: true`, `serverFunctions: { components: true }`), `@wardic/solid/unstable/v2` | Solid 2 patterns: async memos under `<Loading>`, server components, and the binding's async values |
| [`shared`](shared) | | What both use: the catalog and photos, the stylesheet, the examples' words, the store, the Motion snippets, the smoke test |

## The examples

| Area | Example | Shows |
|---|---|---|
| Entrances | The product grid | `variants`, `staggerChildren` |
| Layout | A product opens into its detail view | `layoutId` twins between a scrolled page and a `position: fixed` view, `layout="position"` |
| Layout | Filter the shop, switch the view | `layout` with `<AnimatePresence mode="popLayout">`, a grid ↔ list switch |
| Layout | Tabs on a product page | a `layoutId` indicator, `<AnimatePresence mode="wait">` |
| Layout | Add to cart, and see it's done | a button whose width follows its label |
| Layout | Questions that open in place | `layout` with scale correction |
| Layout | A cart drawer that keeps up | optimistic lines (Solid 1: pending submissions; Solid 2: an optimistic store) |
| Layout | Order history in a scrolling panel | a re-sort through `animateLayout`, inside a scrolled panel |
| Gestures | Notifications you swipe away | `drag="x"` with `dragSnapToOrigin`, a throw that flies on, an undo window, `<AnimatePresence mode="popLayout">` (Solid 2: one `action` around `next("settled")`) |
| Gestures | A wishlist you rearrange by hand | `Reorder.Group` / `Reorder.Item` (Solid 1: each visitor's, saved with `onReorderEnd`; Solid 2: one list everyone shares, live across windows through `live()`) |
| Server rendering | A banner that arrives before the JavaScript | `initial` / `animate` with a stagger, played from the first paint by the server's CSS (Appear animations), taken over by the JavaScript where the CSS has got to |

## Run it

Both apps need Node 24 (SolidStart 2 requires it), which the repo's dev shell has:

```sh
nix develop
cd examples/storefront/solid1   # or solid2
bun run dev                     # http://localhost:3101 (solid2: 3102)
```

The header's switches:
- **Reduce motion** sets the provider's `reducedMotion` to `"always"`, so you can see what every demo does under it.
- **The theme** cycles system, light and dark.
- **⚙ (the store)** sets the delay on each request (300 ms to start with), or makes the next request fail, so loading states and rollbacks show when you want them.

Any page takes `?hydrate=2000`, to hydrate that many milliseconds late as a slow network would, or `?hydrate=off`, to never hydrate, as with JavaScript off: what plays before the JavaScript then shows on its own. Solid 1's `src/entry-client.tsx` waits before it mounts; Solid 2's `src/client-setup.ts` is the plugin's `start.clientSetup`, which its generated entry awaits before `hydrate()`. (Solid 2's start mode takes an authored client entry only with an authored server entry beside it.)

## The store

The shop's data is served by server functions over one store, written in Effect (`shared/src/server`):
- `Schema` decodes what each call is sent, and typed errors (`UnknownProduct`, `SimulatedFailure`, `InvalidArguments`) become a readable message at the edge (`runFor`).
- Each part is a `Context.Service` with its `layer`: `Catalog`, `Carts`, `Orders`, `Wishlists`, `Notifications`, `Latency`, and the `Visitor` each app provides from its cookie.
- A wishlist move is "put it after this one", applied to the list as it is when it arrives, so it means the same whatever others moved meanwhile. `wishlistChanges` is the list now, then each change, as a `Stream` over a `PubSub`; `streamFor` hands it to a `live()` server function as an async iterable.
- A visitor's past orders are made up from their id, the same each visit, dated back from the store's clock.
- It keeps everything in memory for the server process's life. A restart empties every cart.

Its tests (`shared/test`) run with the repo's `bun run test`.

## Check it

`bun run test:storefront`, from the root, builds both apps and smoke-tests each production build. It opens every example's route in Chromium and checks:
- the page answers with no error or warning logged, and no hydration mismatch;
- the demo moves, then settles, after the clicks or drags the example asks for (`interact`) when it waits for the visitor. A live feed's open connection doesn't count against the network going quiet.

It also reaches each example as a visitor does, from the gallery by its link, so the router renders it in the browser and its server functions are called from there; each must render its demo with nothing logged.

It also checks the store from the browser, in a context of its own: the visitor's cookie is kept, and the store settings' switch, an action whose settings the browser fetches again, still shows them.

Each page's screenshot lands in the app's `.smoke/`.

## Add an example

1. Its words go in `shared/src/examples.ts`: its area, title, "why", what reduced motion does, the selector the smoke test watches, and the clicks it makes first, if any (a selector, or `drag:<selector>:<dx>:<dy>`).
2. Its demo goes in each app's `src/examples/<id>/Demo.tsx`. That file is what the page shows as the code, so keep it about the pattern.
3. Its route goes in `src/routes/<area>/<id>.tsx`, which renders `<ExamplePage id="<id>" demo={Demo} />`.
4. If porting it from Motion isn't mechanical, its Motion version goes in `shared/motion/<id>.tsx` (React, `motion/react`), with the example's `motion` field naming it and saying what differs. The page shows it under "Coming from Motion". The shared package's `typecheck` checks it against `motion`, React and their types, which are its dev dependencies only.

## The photos

Every product photo is CC0, most of them museums' open-access photography. [`shared/images/CREDITS.md`](shared/images/CREDITS.md) lists each source. The names, prices and descriptions are made up.
