# @wardic/example-solid2-start

A sandbox for the Solid 2 binding, `@wardic/solid/unstable/v2` (#209), in
[`@solidjs/vite-plugin`](https://v2.solidjs.com)'s start mode: streaming server rendering,
hydration, and Appear animations, with the Solid 1 example's hand checks
(`examples/solid-start-basic`) on the same pages.

```sh
# from the repo root
bun install

# then, from this directory
bun dev                                    # http://localhost:3000
bun run build && WARDIC_SAVE_LOG=1 bun start   # production build + serve
```

`bun start` runs the plugin's Node server (`dist/server/node.js`) on `PORT` (3000) and `HOST`. With
no `HOST` it listens on every interface, so give it one (`HOST=127.0.0.1`).

How it's put together:

- **Start mode with an authored entry pair.** `src/entry-server.tsx` streams
  `<Document><App /></Document>`, and `src/entry-client.tsx` hydrates it (after `?hydrate=<ms>`
  when the URL asks), running the hand checks' reports (`@wardic/example-hand-checks`).
  `src/Document.tsx` references the client entry itself.
- **File routes.** `fileRoutes()` (`filesystem-routing`) builds the route manifest from
  `src/routes`, and `@solidjs/router`'s `createRouter` mounts it (`src/router.ts`). With
  `httpMethods`, a route module may export `POST`: `src/middleware.ts` answers them
  (`src/routes/api/save-log.ts`).
- **Solid 2 for the binding's source.** `@wardic/solid` ships TypeScript source whose `solid-js`
  is Solid 1 (its own binding's peer). `vite.config.ts` dedupes `solid-js` and `@solidjs/web` so
  the app's Solid 2 is the one it runs on, and bundles the `@wardic` packages for the server
  (`ssr.noExternal`); `tsconfig.json` maps `solid-js` to Solid 2's types for every importer.

## `/ssr`: the hydration check (#41)

The Solid 1 example's `/ssr` on Solid 2 (see its README): every element kind rendered on the
server, then hydrated, with a hydration report under the page. Where Solid 1 has `use:wardic`,
this page has a ward given to `ref` (`ward-ref`, client-only, so no server Starting style, by
design). A kept ward is spread (`spread`): its Starting style is in the server's HTML.

Run it as the Solid 1 example's: JavaScript off (the server's paint), throttled (each element
moves to rest after hydration with no jump, every row OK), reduced motion (the readout is
`false` in the server's paint and `true` after mount; an `x` offset snaps to rest, as ADR-0029
asks, and every row is OK), then drag, reorder, and toggle.

## `/appear`: Appear animations (#48)

Each element's mount animation plays in CSS from first paint, from the head's `<style>` (Solid
2's head registry), and the engine takes it over at hydration. The report judges each element:
PLAYED, SMOOTH through the Handoff, and DONE.

- `?hydrate=1500`: hydrate 1.5 s in, so the Handoff falls mid-flight.
- `?data=<ms>` (default 400): when the streamed list's data resolves on the server. Its items
  come in a late `<Loading>` chunk, with their rules as a head patch (#245). `?data=300&hydrate=1500`
  lands the chunk before the JS; `?data=1200` after it.
- JavaScript off: everything plays to its end and holds.
- Reduced motion: positional keys snap, opacity animates.

## Logs

**Save log to repo**, under either report, writes `logs/<timestamp>.json` here (gitignored), in
dev or a production build started with `WARDIC_SAVE_LOG=1`.
