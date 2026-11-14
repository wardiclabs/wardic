/**
 * Where a sample's `~/lib/wardic.ts`, the reader's Wardic instance (#516), resolves on each binding: for
 * the examples check (`solid-examples.test.ts`) and the testing samples' runs under jsdom
 * (`packages/solid/vitest.jsdom*.config.ts`). The Solid 1 samples' typecheck says the same in
 * `samples/tsconfig.solid1.json`, which can't import it.
 */
import { join } from "node:path"

/** How a sample imports the reader's Wardic instance. */
export const INSTANCE_IMPORT = "~/lib/wardic.ts"

/** The module it resolves to: the Solid 1 samples' own, and the site's, which runs the Solid 2 samples. */
export const instanceModule = {
  solid1: join(import.meta.dirname, "../samples/solid1-wardic.ts"),
  solid2: join(import.meta.dirname, "../src/lib/wardic.ts"),
} as const
