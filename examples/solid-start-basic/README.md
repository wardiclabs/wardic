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
