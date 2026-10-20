import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"
import type { BrowserCommand } from "vitest/node"
import { solid2 } from "./vite.solid2.ts"
import { BROWSER_COMMANDS, PREBUNDLED } from "./vitest.browser.config.ts"

// Server render → hydration tests for the Solid 2 binding (#209 PR 4a, ADR-0021, ADR-0045), as
// `vitest.hydrate.config.ts` has them for Solid 1. A fixture is rendered twice from one module: on
// the server, in Node, by the commands below (this project's Vite loads it with Solid 2's server
// compile, `@solidjs/web`'s server build), and in Chromium, where the test hydrates that markup
// with the hydratable client compile. `solid2({ hydratable: true })` compiles both: `generate:
// "ssr"` for the server load, hydratable DOM code for the browser.
//
// A fixture renders without a document, so its head tags (`useHead`'s, an Appear animation's
// `<style>`) come back through `renderToString`'s `onHead` and `renderToStream`'s.
//
// Files are `test/v2/**/*.hydrate.browser.test.tsx`; the root vitest.browser.config.ts runs this
// project with the others (`bun run test:browser`).

interface Rendered {
  readonly html: string
  readonly head: string
  readonly script: string
  readonly error: string
}

/** The server's `@solidjs/web` and the fixtures module, through this project's Vite. */
const load = async (vite: { readonly ssrLoadModule: (id: string) => Promise<Record<string, unknown>> }, file: string) => ({
  web: (await vite.ssrLoadModule("@solidjs/web")) as Record<string, (...args: Array<unknown>) => unknown>,
  mod: (await vite.ssrLoadModule(file)) as Record<string, () => unknown>,
})

/**
 * Server-render `exportName` from `file` (relative to this package) under `renderId`, so fixtures
 * sharing one page don't share hydration keys. Returns the markup, the head tags, and the hydration
 * script, or the error's first line.
 */
const serverRender2: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (ctx, file, exportName, renderId): Promise<Rendered> => {
  try {
    const { web, mod } = await load(ctx.project.vite, file)
    let head = ""
    const html = web.renderToString!(() => mod[exportName]!(), {
      renderId,
      onHead: (h: string) => {
        head = h
      },
    }) as string
    return { html, head, script: web.generateHydrationScript!() as string, error: "" }
  } catch (e) {
    return { html: "", head: "", script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

/**
 * Stream `exportName`: `renderToStream` piped, each write as the stream sends it. The head comes
 * first through `onHead`; then the shell, then each late `<Loading>` chunk (its `<template>` and the
 * script that places it, with its head patch).
 */
const serverStream2: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (ctx, file, exportName, renderId) => {
  try {
    const { web, mod } = await load(ctx.project.vite, file)
    let head = ""
    const writes: Array<string> = []
    await new Promise<void>((resolve) => {
      const stream = web.renderToStream!(() => mod[exportName]!(), {
        renderId,
        onHead: (h: string) => {
          head = h
        },
      }) as { readonly pipe: (w: { readonly write: (v: string) => void; readonly end: () => void }) => void }
      stream.pipe({ write: (chunk) => void writes.push(chunk), end: () => resolve() })
    })
    return { writes, head, script: web.generateHydrationScript!() as string, error: "" }
  } catch (e) {
    return { writes: [] as Array<string>, head: "", script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid2({ hydratable: true })],
  resolve: { conditions: ["development", "browser"], dedupe: ["effect"] },
  // The @wardic packages ship TypeScript and JSX source, and Solid 2 resolves through the plugin:
  // bundle them for the server load too.
  ssr: { noExternal: [/@wardic\//, "solid-js-2", "@solidjs/web", "@solidjs/signals"] },
  optimizeDeps: { include: [...PREBUNDLED], exclude: ["solid-js-2", "@solidjs/web", "@solidjs/signals"] },
  test: {
    name: "v2-hydrate",
    include: ["test/v2/**/*.hydrate.browser.test.{ts,tsx}"],
    setupFiles: ["./test/browser-setup.ts", "./test/v2/diagnostics-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { ...BROWSER_COMMANDS, serverRender2, serverStream2 },
    },
  },
})
