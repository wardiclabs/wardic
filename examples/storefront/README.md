# Wardic Northlight, the storefront showcase

A made-up ceramics and glass shop whose every feature is a Wardic example: the demo, a short "why", and the code, on one page per pattern (#296). It's built twice, once per binding, so each shows its own Solid's way of doing things. And once more in Motion, on Next.js (#366): each example's page shows Motion's code beside Wardic's, in a tab, and links to it running.

| App | Stack | Shows |
|---|---|---|
| [`solid1`](solid1) | SolidStart 2.1 on Solid 1.9, `@wardic/solid` | Solid 1 patterns: `createAsync` over Solid Router's `query`, `action`, `<Suspense>` |
| [`solid2`](solid2) | Solid 2 on `@solidjs/vite-plugin` (`start: true`, `ssr: true`, `serverFunctions: { components: true }`), `@wardic/solid/unstable/v2` | Solid 2 patterns: async memos under `<Loading>`, server components, and the binding's async values |
| [`next`](next) | Next.js 16 (App Router) on React 19, `motion/react` | Each example as Motion would write it: server components that start the store's reads, client components that read them with `use()`, server actions, and server-sent events for the shared wishlist |
| [`shared`](shared) | | What all three use: the catalog and photos, the stylesheet, the examples' words, the store, the apps' addresses, the smoke test |

## The examples

| Area | Example | Shows |
|---|---|---|
| Entrances | The product grid | `variants`, `staggerChildren` |
| Entrances | Stock that fills in as it arrives | `animate` read from the store's count: the meters wait for it, then fill; each says when it has settled (Solid 1: `<Suspense>` with a transition, `onAnimationComplete`; Solid 2: `<Loading>`, `isPending(() => bar.settled())`) |
| Layout | A product opens into its detail view | `layoutId` twins between a scrolled page and a `position: fixed` view, `layout="position"` |
| Layout | Filter the shop, switch the view | `layout` with `<AnimatePresence mode="popLayout">`, a grid ↔ list switch |
| Layout | Tabs on a product page | a `layoutId` indicator, `<AnimatePresence mode="wait">` |
| Layout | Add to cart, and see it's done | a button whose width follows its label |
| Layout | Questions that open in place | `layout` with scale correction |
| Layout | A cart drawer that keeps up | optimistic lines (Solid 1: pending submissions; Solid 2: an optimistic store) |
| Layout | Order history in a scrolling panel | a re-sort through `animateLayout`, inside a scrolled panel |
| Gestures | Notifications you swipe away | `drag="x"` with `dragSnapToOrigin`, a throw that flies on, an undo window, `<AnimatePresence mode="popLayout">` (Solid 2: one `action` around `next("settled")`) |
| Gestures | A wishlist you rearrange by hand | `Reorder.Group` / `Reorder.Item` (Solid 1: each visitor's, saved with `onReorderEnd`; Solid 2: one list everyone shares, live across windows through `live()`) |
| Presence | "Added to cart", in toasts that make room | `<AnimatePresence mode="popLayout">` over `layout` toasts: a leaving one is popped out of the stack, and the others close the gap as it fades |
| Presence | A photo gallery that slides the way you go | `<AnimatePresence custom>` with variants as functions: the leaving photo reads the latest direction from the presence; no distance under reduced motion |
| Presence | A quick view whose list leaves before it | `<AnimatePresence propagate>` inside the dialog: its suggestions run their exits when the dialog leaves, and it waits for them |
| Presence | Saved for later, moved to the cart | a `layoutId` twin in the header's cart button: the photo flies from its row into the cart; the move is optimistic, the row back if the store refuses (Solid 1: by hand; Solid 2: an optimistic store) |
| Live values | A closer look at the glaze | a magnifier: `createSpring` follows the pointer, `createTransform` maps it to custom properties the lens reads |
| Live values | A reading bar for the studio's story | `createScroll` of a panel, its progress as a bar's `scaleX` and, through `createTransform`, the minutes left |
| Live values | A lookbook with depth | `createScroll` with a `target` and an `offset` per banner: the photo and the words drift opposite ways |
| Live values | The studio's story, revealed as you read | `whileInView` with `viewport` (`root`, `amount`, `once`), staggered Variant children |
| Live values | Cards that catch the light | `createSpring`s of the pointer, mapped to a tilt and to where a light sits; the light comes on by a variant on a custom property; the hover heard through `card.when("hover")` / `("hoverEnd")` (Solid 1: `onHoverStart` / `onHoverEnd` and the element's `pointermove`) |
| Server rendering | A banner that arrives before the JavaScript | `initial` / `animate` with a stagger, played from the first paint by the server's CSS (Appear animations), taken over by the JavaScript where the CSS has got to |

## Run it

The apps need Node 24 (SolidStart 2 requires it), which the repo's dev shell has:

```sh
nix develop
cd examples/storefront/solid1   # or solid2, or next
bun run dev                     # http://localhost:3101 (solid2: 3102, next: 3103)
```

Their production builds serve on 4101, 4102 and 4103 (`bun run preview` in the Solid apps, `bun run start` in `next`, after `bun run build`). An example's page links to the same example in the other apps, on the host it was asked for at their port, unless `STOREFRONT_SOLID1_URL`, `STOREFRONT_SOLID2_URL` or `STOREFRONT_NEXT_URL` names an app's base URL (`shared/src/apps.ts`).

The header's switches:
- **Reduce motion** sets the provider's `reducedMotion` to `"always"`, so you can see what every demo does under it. In the Next.js app it sets `MotionConfig`'s. Motion reads that as each element mounts, and never again, so there it's kept in a cookie, which the server renders with, and the page's content mounts again when it changes; the header's own buttons follow it from the next page load.
- **The theme** cycles system, light and dark.
- **⚙ (the store)** sets the delay on each request (300 ms to start with), or makes the next request fail, so loading states and rollbacks show when you want them.

Any page takes `?hydrate=2000`, to hydrate that many milliseconds late as a slow network would, or `?hydrate=off`, to never hydrate, as with JavaScript off: what plays before the JavaScript then shows on its own. Solid 1's `src/entry-client.tsx` waits before it mounts; Solid 2's `src/client-setup.ts` is the plugin's `start.clientSetup`, which its generated entry awaits before `hydrate()`. (Solid 2's start mode takes an authored client entry only with an authored server entry beside it.) Next.js hydrates once its `beforeInteractive` scripts have loaded: its proxy hands the root layout the page's `?hydrate=`, and the layout adds one from `/hold-hydration`, which answers that late, or never.

## The store

The shop's data is served by server functions over one store, written in Effect (`shared/src/server`):
- `Schema` decodes what each call is sent, and typed errors (`UnknownProduct`, `SimulatedFailure`, `InvalidArguments`) become a readable message at the edge (`runFor`).
- Each part is a `Context.Service` with its `layer`: `Catalog`, `Carts`, `Orders`, `Wishlists`, `Notifications`, `Latency`, and the `Visitor` each app provides from its cookie.
- A wishlist move is "put it after this one", applied to the list as it is when it arrives, so it means the same whatever others moved meanwhile. `wishlistChanges` is the list now, then each change, as a `Stream` over a `PubSub`; `streamFor` hands it to a `live()` server function as an async iterable, or, in the Next.js app, to a route handler that sends it as server-sent events.
- A visitor's past orders are made up from their id, the same each visit, dated back from the store's clock.
- It keeps everything in memory for the server process's life, one store a process: its runtime is kept on `globalThis`, as Next.js loads a module once for its route handlers and again for its pages. A restart empties every cart.

Its tests (`shared/test`) run with the repo's `bun run test`.

## Check it

`bun run test:storefront`, from the root, builds the three apps and smoke-tests each production build. It fails if an example has no Motion version in the Next.js app. It opens every example's route in Chromium and checks:
- the page answers with no error or warning logged, and no hydration mismatch;
- the demo moves, then settles, after the clicks or drags the example asks for (`interact`) when it waits for the visitor. A live feed's open connection doesn't count against the network going quiet.
- in a Solid app, the code's "Motion · Next.js" tab shows Motion's files in place of the demo's, and links to the example running in the Next.js app.

It also reaches each example as a visitor does, from the gallery by its link, so the router renders it in the browser and its server functions are called from there; each must render its demo with nothing logged.

It also checks the store from the browser, in a context of its own: the visitor's cookie is kept, and the store settings' switch, an action whose settings the browser fetches again, still shows them.

Each page's screenshot lands in the app's `.smoke/`.

## Add an example

1. Its words go in `shared/src/examples.ts`: its area, title, "why", what reduced motion does, the selector the smoke test watches, and what it does first, if anything (a selector to click, `drag:<selector>:<dx>:<dy>`, or `scroll:<selector>:<dy>`).
2. Its demo goes in each app's `src/examples/<id>/Demo.tsx`. That file is what the page shows as the code, so keep it about the pattern.
3. Its route goes in `src/routes/<area>/<id>.tsx`, which renders `<ExamplePage id="<id>" demo={Demo} />`.
4. Its Motion version goes in the Next.js app's `src/examples/<id>/`, as Motion and Next.js would write it: a `Demo.tsx`, a client component, or a server component that starts the store's reads and hands them to a `"use client"` part beside it. It's listed in `src/examples/index.ts`, and the app routes it at the same `/<area>/<id>`. Every file in the folder is what the Solid apps' pages show in their "Motion · Next.js" tab, so it keeps the Solid demo's class names, and the stylesheet and the smoke test work on it unchanged.
5. Where there's something to say about Motion's version, the example's `motion` field says it: a `note` on what differs, shown above the code's tabs in all three apps, and a `summary` of its own where the example's doesn't hold for Motion.

## The photos

Every product photo is CC0, most of them museums' open-access photography. [`shared/images/CREDITS.md`](shared/images/CREDITS.md) lists each source. The names, prices and descriptions are made up.
