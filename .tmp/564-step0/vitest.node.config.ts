// #881's Node probe (step 0 of #564): Solid 2's client build, compiled for the DOM, run in Node with
// no DOM at all, as a `TestStage` test would be (ADR-0073, decision 26). `CONDITIONS=node` runs the
// same file on the conditions Node picks by itself, Solid's server build.
import { join } from "node:path"
import { defineConfig } from "vitest/config"
import { solid2 } from "../../packages/solid/vite.solid2.ts"
import { wardicSource } from "../../scripts/wardic-source.ts"

/** `@wardic/*` and `effect` for this folder, outside every package: resolved as packages/solid imports them. */
const fromSolid = () => ({
  name: "probe:from-solid",
  enforce: "pre" as const,
  async resolveId(this: { resolve: (s: string, i: string, o: object) => Promise<unknown> }, source: string, importer: string | undefined, options: object) {
    if (!/^(@wardic\/|effect(\/|$))/.test(source)) return null
    if (importer === undefined || !importer.includes("/.tmp/564-step0/")) return null
    return this.resolve(source, join(import.meta.dirname, "../../packages/solid/package.json"), { ...options, skipSelf: true })
  },
})

const conditions = process.env.CONDITIONS === "node" ? ["node", "development"] : ["browser", "development"]

export default defineConfig({
  root: join(import.meta.dirname, "../../packages/solid"),
  plugins: [fromSolid(), wardicSource(), solid2()],
  resolve: { conditions, dedupe: ["effect"] },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    name: "probe-881-node",
    dir: import.meta.dirname,
    include: ["*.node.test.tsx"],
    environment: process.env.PROBE_ENV === "client" ? join(import.meta.dirname, "env-node-client.ts") : "node",
    server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
  },
})
