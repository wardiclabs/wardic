import { playwright } from "@vitest/browser-playwright"
import solidPlugin from "vite-plugin-solid"
import { configDefaults, defineConfig } from "vitest/config"
import type { BrowserCommand } from "vitest/node"
import { wardicSource } from "../../scripts/wardic-source.ts"

// Server render → hydration test project for @wardic/solid (ADR-0021, decision 10).
//
// A fixture is rendered twice from one module: on the server, in Node, by the
// `serverRender` command below (the project's own Vite loads it with Solid's server
// build), and in Chromium, where the test hydrates that markup with the hydratable client
// build. `solidPlugin({ ssr: true })` compiles both: `generate: "ssr"` for the server
// load, hydratable DOM code for the browser. The plain solid browser project compiles
// non-hydratable code, so it excludes these files.
//
// Solid 1.9.13 doesn't report most hydration mismatches (a different tag under the same
// key claims the server's node; a different style is patched), so the tests compare the
// markup and the nodes themselves.
//
// Files are `test/**/*.hydrate.browser.test.tsx`; the root vitest.browser.config.ts runs
// this project with the other two (`bun run test:browser`).

/**
 * Server-render `exportName` from `file` (relative to this package) with Solid's server
 * build, under `renderId` so fixtures sharing one page don't share hydration keys. Returns
 * the markup and the hydration script, or the error's first line.
 */
const serverRender: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (
  ctx,
  file,
  exportName,
  renderId,
) => {
  const vite = ctx.project.vite
  const web = await vite.ssrLoadModule("solid-js/web")
  try {
    const mod = await vite.ssrLoadModule(file)
    const html: string = web.renderToString(() => mod[exportName](), { renderId })
    return { html, script: web.generateHydrationScript() as string, error: "" }
  } catch (e) {
    return { html: "", script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

/**
 * Server-render `exportName` as a page with a head (#48, ADR-0044): what `useAssets` injects before
 * `</head>` (an Appear animation's `<style>`) comes back as `head`, and the rest as `html`. The
 * fixture's markup and hydration keys are `serverRender`'s.
 */
const serverRenderPage: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (
  ctx,
  file,
  exportName,
  renderId,
) => {
  const vite = ctx.project.vite
  const web = await vite.ssrLoadModule("solid-js/web")
  try {
    const mod = await vite.ssrLoadModule(file)
    const page: string = web.renderToString(() => web.ssr(["<head></head>", ""], mod[exportName]()), { renderId })
    const head = /^<head>([\s\S]*?)<\/head>/.exec(page)?.[1] ?? ""
    return { html: page.replace(/^<head>[\s\S]*?<\/head>/, ""), head, script: web.generateHydrationScript() as string, error: "" }
  } catch (e) {
    return { html: "", head: "", script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

/**
 * Stream `exportName` as a page with a head (#245): `renderToStream` piped, each write as the stream
 * sends it. The first is the shell (its head with `useAssets`' injection, its scripts); a late
 * `Suspense` chunk follows as its `<template>` and then the script that places it (`$df`).
 */
const serverStreamPage: BrowserCommand<[file: string, exportName: string, renderId: string]> = async (ctx, file, exportName, renderId) => {
  const vite = ctx.project.vite
  const web = await vite.ssrLoadModule("solid-js/web")
  try {
    const mod = await vite.ssrLoadModule(file)
    const writes: Array<string> = []
    await new Promise<void>((resolve) => {
      web.renderToStream(() => web.ssr(["<head></head>", ""], mod[exportName]()), { renderId }).pipe({
        write: (chunk: string) => void writes.push(chunk),
        end: () => resolve(),
      })
    })
    return { writes, script: web.generateHydrationScript() as string, error: "" }
  } catch (e) {
    return { writes: [] as Array<string>, script: "", error: String(e).split("\n")[0] ?? String(e) }
  }
}

/** Emulate `prefers-reduced-motion: reduce` (or clear it) on the test page and its frames. */
const emulateReducedMotion: BrowserCommand<[reduce: boolean]> = async (ctx, reduce) => {
  await ctx.page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" })
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [wardicSource(), solidPlugin({ ssr: true })],
  resolve: {
    conditions: ["development", "browser"],
    dedupe: ["solid-js", "effect"],
  },
  // The @wardic packages ship TypeScript + JSX source: bundle them for the server load too.
  ssr: { noExternal: [/@wardic\//] },
  // Pre-bundled up front, as the dom project does: a first import mid-run reloads the page.
  optimizeDeps: {
    include: [
      "culori/fn",
      "effect/Array",
      "effect/Boolean",
      "effect/Cause",
      "effect/Channel",
      "effect/Combiner",
      "effect/Context",
      "effect/Data",
      "effect/Deferred",
      "effect/Duration",
      "effect/Effect",
      "effect/Equal",
      "effect/Equivalence",
      "effect/ErrorReporter",
      "effect/Exit",
      "effect/Fiber",
      "effect/FiberHandle",
      "effect/FiberSet",
      "effect/Function",
      "effect/Hash",
      "effect/Inspectable",
      "effect/Iterable",
      "effect/Latch",
      "effect/Layer",
      "effect/Logger",
      "effect/LogLevel",
      "effect/ManagedRuntime",
      "effect/Match",
      "effect/Metric",
      "effect/MutableRef",
      "effect/Number",
      "effect/Option",
      "effect/Order",
      "effect/Pipeable",
      "effect/Predicate",
      "effect/PubSub",
      "effect/Queue",
      "effect/RcMap",
      "effect/RcRef",
      "effect/reactivity",
      "effect/Record",
      "effect/References",
      "effect/Result",
      "effect/Scheduler",
      "effect/Scope",
      "effect/Stream",
      "effect/String",
      "effect/Tracer",
      "effect/UndefinedOr",
    ],
  },
  test: {
    name: "hydrate",
    include: ["test/**/*.hydrate.browser.test.tsx"],
    // The Solid 2 binding's hydration tests run in their own project (vitest.hydrate-v2.config.ts).
    exclude: [...configDefaults.exclude, "test/v2/**"],
    // Polyfill setImmediate (Effect's scheduler needs it; absent in real browsers).
    setupFiles: ["./test/browser-setup.ts"],
    server: { deps: { inline: [/solid-js/, /@solidjs\/testing-library/] } },
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { emulateReducedMotion, serverRender, serverRenderPage, serverStreamPage },
    },
  },
})
