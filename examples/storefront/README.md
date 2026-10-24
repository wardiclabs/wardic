# Kiln & Co., the storefront showcase

A made-up ceramics and glass shop whose every feature is a Wardic example: the demo, a short "why", and the code, on one page per pattern (#296). It's built twice, once per binding, so each shows its own Solid's way of doing things.

| App | Stack | Shows |
|---|---|---|
| [`solid1`](solid1) | SolidStart 2.1 on Solid 1.9, `@wardic/solid` | Solid 1 patterns: `createAsync` over Solid Router's `query`, `action`, `<Suspense>` |
| [`solid2`](solid2) | Solid 2 on `@solidjs/vite-plugin` (`start: true`, `ssr: true`, `serverFunctions: { components: true }`), `@wardic/solid/unstable/v2` | Solid 2 patterns: async memos under `<Loading>`, server components, and the binding's async values |
| [`shared`](shared) | | What both use: the catalog and photos, the stylesheet, the examples' words, the store, the smoke test |

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

## The store

The shop's data is served by server functions over one store, written in Effect (`shared/src/server`):
- `Schema` decodes what each call is sent, and typed errors (`UnknownProduct`, `SimulatedFailure`, `InvalidArguments`) become a readable message at the edge (`runFor`).
- Each part is a `Context.Service` with its `layer`: `Catalog`, `Carts`, `Latency`, and the `Visitor` each app provides from its cookie.
- It keeps everything in memory for the server process's life. A restart empties every cart.

Its tests (`shared/test`) run with the repo's `bun run test`.

## Check it

`bun run test:storefront`, from the root, builds both apps and smoke-tests each production build. It opens every example's route in Chromium and checks:
- the page answers with no error or warning logged, and no hydration mismatch;
- the demo moves, then settles.

Each page's screenshot lands in the app's `.smoke/`.

## Add an example

1. Its words go in `shared/src/examples.ts`: its area, title, "why", what reduced motion does, and the selector the smoke test watches.
2. Its demo goes in each app's `src/examples/<id>/Demo.tsx`. That file is what the page shows as the code, so keep it about the pattern.
3. Its route goes in `src/routes/<area>/<id>.tsx`, which renders `<ExamplePage id="<id>" demo={Demo} />`.

## The photos

Every product photo is CC0, most of them museums' open-access photography. [`shared/images/CREDITS.md`](shared/images/CREDITS.md) lists each source. The names, prices and descriptions are made up.
