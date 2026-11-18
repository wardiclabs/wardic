import { readFileSync, writeFileSync } from "node:fs"
import * as Effect from "effect/Effect"
import { injectIntoTemplate, renderToString } from "foldkit/experimental/server"
import { app, BUILD_ID } from "./app.ts"

// The server's render, run once at build time by Node (`node dist/server/entry-server.js`): the page as a
// server would answer it, written over the client build's `index.html` for `vite preview` to serve. The
// render is hydratable under the build id the client gives `wardic.hydrate`. A promise chain, not a
// top-level await: Vite's server build keeps the client's target.
const template = readFileSync("dist/index.html", "utf8")
Effect.runPromise(renderToString(app, { buildId: BUILD_ID })).then((rendered) => {
  writeFileSync("dist/index.html", injectIntoTemplate(template, rendered, { containerId: "app" }))
})
