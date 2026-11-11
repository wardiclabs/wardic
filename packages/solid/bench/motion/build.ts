/**
 * `bench:motion`'s pages (#615), production builds, minified, for the browsers an app ships to
 * (`APP_TARGET`, as `bench:solid` builds its own), into `dist/`:
 *
 * - `wardic.js`: the working tree's `@wardic/solid` on Solid 1, each `@wardic/*` from its source;
 * - `wardic-v2.js`: its Solid 2 binding, on Solid 2's compile without its dev checks;
 * - `motion.js`: React with framer-motion, from `react/`'s own install, which the workspace doesn't
 *   take.
 *
 * Each also carries its plain page (`?kind=plain`): the same elements with no animation library.
 */
import { join } from "node:path"
import { build, type InlineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import { solid2 } from "../../vite.solid2.ts"
import { APP_TARGET } from "../sides.ts"

const D = import.meta.dirname
const DEPS = join(D, "react", "node_modules")
const SOLID_INDEX = join(D, "..", "..", "src", "index.tsx")

/** The pages' bare imports resolved as `@wardic/solid`'s own are: Solid from its install, not the repo root's. */
const resolveAsSolid: Plugin = {
  name: "resolve-as-solid",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === undefined || !importer.startsWith(D)) return null
    if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null
    return this.resolve(source, SOLID_INDEX, { ...options, skipSelf: true })
  },
}

/**
 * Vite's client conditions with `@wardic/source` first, so each `@wardic/*` resolves to its source, as
 * the repo's own configs have it (`scripts/wardic-source.ts`), and never to a `dist/` an earlier build
 * left (#554).
 */
const CONDITIONS = ["@wardic/source", "module", "browser", "development|production"]

/** One page's build: `entry` into `dist/<file>`, as one script a page loads. */
const page = (entry: string, file: string, plugins: NonNullable<InlineConfig["plugins"]>, alias: NonNullable<NonNullable<InlineConfig["resolve"]>["alias"]> = []): InlineConfig => ({
  configFile: false,
  logLevel: "warn",
  mode: "production",
  root: D,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins,
  resolve: { alias, conditions: CONDITIONS },
  build: {
    outDir: join(D, "dist"),
    emptyOutDir: false,
    minify: true,
    target: [...APP_TARGET],
    lib: { entry: join(D, entry), formats: ["iife"], name: "probe", fileName: () => file },
  },
})

/** Builds the three scripts the pages load. */
export const buildPages = async (): Promise<void> => {
  await build(page("wardic-page.tsx", "wardic.js", [resolveAsSolid, solid()]))
  // Solid 2's resolution first, so the page's `solid-js` is Solid 2's.
  await build(page("wardic-v2-page.tsx", "wardic-v2.js", [solid2({ dev: false }), resolveAsSolid]))
  await build(
    page("motion-page.ts", "motion.js", [], [
      { find: /^framer-motion$/, replacement: join(DEPS, "framer-motion") },
      { find: /^react$/, replacement: join(DEPS, "react") },
      { find: /^react\/(.*)$/, replacement: join(DEPS, "react", "$1") },
      { find: /^react-dom$/, replacement: join(DEPS, "react-dom") },
      { find: /^react-dom\/(.*)$/, replacement: join(DEPS, "react-dom", "$1") },
    ]),
  )
}
