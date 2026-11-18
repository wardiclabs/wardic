# Wardic Northlight, the storefront showcase

A made-up ceramics and glass shop whose every feature is a Wardic example: the demo, a short "why", and the code, on one page per pattern (#296). It's built three times, once per binding, so each shows its own framework's way of doing things: the two Solid bindings, and Foldkit's (#795).

| App | Stack | Shows |
|---|---|---|
| [`solid2`](solid2) | Solid 2 on `@solidjs/vite-plugin` (`start: true`, `ssr: true`, `serverFunctions: { components: true }`), `@wardic/solid`, Kobalte 2.0 (an alpha) | Solid 2 patterns: async memos under `<Loading>`, server components, and the binding's async values |
| [`solid1`](solid1) | SolidStart 2.1 on Solid 1.9, `@wardic/solid/v1` (deprecated), Kobalte 0.13; not deployed (#566) | Solid 1 patterns: `createAsync` over Solid Router's `query`, `action`, `<Suspense>` |
| [`foldkit`](foldkit) | Foldkit 0.171 on Vite with `@foldkit/vite-plugin`'s server-rendered build and `@foldkit/node`, `@wardic/foldkit`, the store over Effect RPC | Foldkit patterns: the Model as the one state, Messages for every callback, Commands over the store, a page's first paint from the Flags the server rendered with |
| [`shared`](shared) | | What all three use: the catalog and photos, the stylesheet, the examples' words, the store, the apps' addresses, the smoke test |

## The examples

| Area | Example | Shows |
|---|---|---|
| Entrances | The product grid | `variants`, `staggerChildren` |
| Entrances | Stock that fills in as it arrives | `animate` read from the store's count: the meters wait for it, then fill; each says when it has settled (Solid 2: `<Loading>`, `isPending(() => bar.settled())`; Solid 1: `<Suspense>` with a transition, `onAnimationComplete`) |
| Layout | A product opens into its detail view | `layoutId` twins between a scrolled page and a `position: fixed` view, `layout="position"` |
| Layout | Filter the shop, switch the view | `layout` with `<AnimatePresence mode="popLayout">`, a grid ↔ list switch |
| Layout | Tabs on a product page | a `layoutId` indicator, `<AnimatePresence mode="wait">` |
| Layout | Add to cart, and see it's done | a button whose width follows its label |
| Layout | Questions that open in place | `layout` with scale correction; Open all through `createInstantTransition` |
| Layout | A cart drawer that keeps up | optimistic lines (Solid 2: an optimistic store; Solid 1: pending submissions) |
| Layout | Order history in a scrolling panel | a re-sort through `animateLayout`, inside a scrolled panel |
| Gestures | Notifications you swipe away | `drag="x"` with `dragSnapToOrigin`, a throw that flies on, an undo window, `<AnimatePresence mode="popLayout">` (Solid 2: one `action` around `next("settled")`) |
| Gestures | A wishlist you rearrange by hand | `Reorder.Group` / `Reorder.Item` (Solid 2: one list everyone shares, live across windows through `live()`; Solid 1: each visitor's, saved with `onReorderEnd`) |
| Gestures | Arrange a room, at any zoom | `drag` with `dragConstraints` inside a zoomed plan, under `WardicConfig`'s `transformPagePoint={correctParentTransform(() => plan)}` |
| Presence | "Added to cart", in toasts that make room | `<AnimatePresence mode="popLayout" anchorX="right" anchorY="bottom">` over `layout` toasts: a leaving one is popped out of the stack, pinned by its bottom right, and the others close the gap as it fades |
| Presence | A photo gallery that slides the way you go | `<AnimatePresence custom>` with variants as functions: the leaving photo reads the latest direction from the presence; no distance under reduced motion |
| Presence | A quick view whose list leaves before it | `<AnimatePresence propagate>` inside the dialog: its suggestions run their exits when the dialog leaves, and it waits for them |
| Presence | Saved for later, moved to the cart | a `layoutId` twin in the header's cart button, both photos `layoutCrossfade={false}`: the photo flies from its row into the cart along an `arc()`, one photo, not two crossfading; the move is optimistic, the row back if the store refuses (Solid 2: an optimistic store; Solid 1: by hand) |
| Page transitions | From the catalogue to a piece's own page | two Solid Router routes under a layout whose outlet sits in `<AnimatePresence mode="popLayout">`: each page leaves by itself, with no `key`, and a `layoutId` photo flies from its card into the piece's page and back, bowing along an `arc()`; each card's "Add" keeps its press from the card's with `propagate={{ tap: false }}`; another piece keys the page's content (`<Show keyed>`) |
| Page transitions | Waiting for a piece's details (Solid 2 only) | a page whose details are an async memo over the store: a `<Loading>` of its own shows a skeleton and the `layoutId` photo, outside it, flies at once; without one the router's transition keeps the catalogue until they land (`useIsRouting`) |
| Live values | A closer look at the glaze | a magnifier: `createSpring` follows the pointer, `createTransform` maps it to custom properties the lens reads |
| Live values | A reading bar for the studio's story | `createScroll` of a panel, its progress as a bar's `scaleX` and, through `createTransform`, the minutes left |
| Live values | A lookbook with depth | `createScroll` with a `target` and an `offset` per banner: the photo and the words drift opposite ways |
| Live values | The studio's story, revealed as you read | `whileInView` with `viewport` (`root`, `amount`, `once`), staggered Variant children |
| Live values | Cards that catch the light | `createSpring`s of the pointer, mapped to a tilt and to where a light sits; the light comes on by a variant on a custom property; the hover heard through `card.when("hover")` / `("hoverEnd")` (Solid 1: `onHoverStart` / `onHoverEnd` and the element's `pointermove`) |
| Live values | Announcements that take turns | `createCycle` steps through the messages under `AnimatePresence mode="wait"`; `createAnimationFrame`'s `delta` fills a bar's `scaleX`, held while hovered, paused, or while `createPageInView()` is `false` (#443) |
| Server rendering | A banner that arrives before the JavaScript | `initial` / `animate` with a stagger, played from the first paint by the server's CSS (Appear animations), taken over by the JavaScript where the CSS has got to |
| With a component library | A size guide in Kobalte's dialog | `w.create` over Kobalte's `Dialog.Overlay` and `Dialog.Content`, `forceMount` with `<AnimatePresence>`: Kobalte keeps focus, Escape and the scroll lock |
| With a component library | Sort the shop with Kobalte's select | `w.create(Select.Content)` growing from the edge Kobalte opens it from (`--kb-select-content-transform-origin`); `layout` cards re-sorted through `animateLayout` |
| With a component library | A piece's details in Kobalte's tabs | a `layoutId` underline inside Kobalte's triggers; each panel a `w.create(Tabs.Content)` that fades in whenever Kobalte shows it |
| Shipping less | Rearrange the room: drag loads when you ask | `LazyWardic` with `features={() => import(…)}`: the room's section renders on Rearrange and fetches `drag` then, and "Slow connection" holds the import back to show the cost |

## Run it

The apps need Node 24 (SolidStart 2 requires it), which the repo's dev shell has:

```sh
nix develop
cd examples/storefront/solid1   # or solid2, or foldkit
bun run dev                     # http://localhost:3101 (solid2: 3102, foldkit: 3104)
```

Their production builds serve on 4101, 4102 and 4104 (`bun run preview` in the Solid apps, `bun run start` in `foldkit`, after `bun run build`).

The Foldkit app has its first four areas (entrances, layout, gestures and presence); the rest, and its deployment beside the others, come with the storefront's second PR (#795).

The header's switches:
- **Reduce motion** sets the provider's `reducedMotion` to `"always"`, so you can see what every demo does under it.
- **The theme** cycles system, light and dark.
- **⚙ (the store)** sets the delay on each request (300 ms to start with), or makes the next request fail, so loading states and rollbacks show when you want them.

Any page takes `?hydrate=2000`, to hydrate that many milliseconds late as a slow network would, or `?hydrate=off`, to never hydrate, as with JavaScript off: what plays before the JavaScript then shows on its own. Solid 2's `src/client-setup.ts` is the plugin's `start.clientSetup`, which its generated entry awaits before `hydrate()` (its start mode takes an authored client entry only with an authored server entry beside it); Solid 1's `src/entry-client.tsx` waits before it mounts.

## Deploy it

[`deploy/`](deploy) runs the apps it deploys (Solid 2's; Solid 1's isn't, #566) on one VPS behind Caddy, each on its own subdomain with HTTPS, and a landing page on the domain: a Docker image, a compose file, a one-time server setup, and a deploy script. Its README has the steps.

## The store

The shop's data is served by server functions over one store, written in Effect (`shared/src/server`):
- `Schema` decodes what each call is sent, and typed errors (`UnknownProduct`, `SimulatedFailure`, `InvalidArguments`) become a readable message at the edge (`runFor`).
- Each part is a `Context.Service` with its `layer`: `Catalog`, `Carts`, `Orders`, `Wishlists`, `Notifications`, `Latency`, and the `Visitor` each app provides from its cookie.
- A wishlist move is "put it after this one", applied to the list as it is when it arrives, so it means the same whatever others moved meanwhile. `wishlistChanges` is the list now, then each change, as a `Stream` over a `PubSub`; `streamFor` hands it to a `live()` server function as an async iterable, and the Foldkit app's rpc streams it.
- A visitor's past orders are made up from their id, the same each visit, dated back from the store's clock.
- It keeps everything in memory for the server process's life, one store a process: its runtime is kept on `globalThis`, since a bundler can load a module more than once in a process (the Next.js app's route handlers and pages each had their own, #366). A restart empties every cart.

Its tests (`shared/test`) run with the repo's `bun run test`.

## Check it

`bun run test:storefront`, from the root, builds the three apps and smoke-tests each production build. It opens every example's route in Chromium and checks:
- the page answers with no error or warning logged, and no hydration mismatch;
- the demo moves, then settles, after the clicks or drags the example asks for (`interact`) when it waits for the visitor. A live feed's open connection doesn't count against the network going quiet.

It also reaches each example as a visitor does, from the gallery by its link, so the router renders it in the browser and its server functions are called from there; each must render its demo with nothing logged.

It also checks the store from the browser, in a context of its own: the visitor's cookie is kept, and the store settings' switch, an action whose settings the browser fetches again, still shows them.

Each page's screenshot lands in the app's `.smoke/`.

## Add an example

1. Its words go in `shared/src/examples.ts`: its area, title, "why", what reduced motion does, the selector the smoke test watches, and what it does first, if anything (a selector to click, `drag:<selector>:<dx>:<dy>`, or `scroll:<selector>:<dy>`).
2. Its demo goes in each app's `src/examples/<id>/Demo.tsx`. That file is what the page shows as the code, so keep it about the pattern.
   Its elements are the Slim one, `w.*`: the provider gives every page `domAnimation` alone, and `strict` makes a Complete element an error in development (#526). A demo that lays out or drags brings `layout` or `drag` itself, wrapping its markup in `<LazyWardic features={[layout]}>`, so the pages that don't never load them.
3. Its route goes in `src/routes/<area>/<id>.tsx`, which renders `<ExamplePage id="<id>" demo={Demo} />`.
   An example whose demo is pages of its own (the catalogue, #479) makes that route a layout instead: it renders `<ExamplePage>` with a demo around its outlet, `props.children`, and its pages go in `src/routes/<area>/<id>/`.
4. An example for one binding's pattern alone (Solid 2's `<Loading>` in a page, say) names its apps in `apps`: only their galleries list it and their smoke tests open it.

## The photos

Every product photo is CC0, most of them museums' open-access photography. [`shared/images/CREDITS.md`](shared/images/CREDITS.md) lists each source. The names, prices and descriptions are made up.
