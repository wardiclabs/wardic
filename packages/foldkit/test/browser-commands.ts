// The browser command registered in packages/foldkit/vitest.hydrate.config.ts (#794), typed once for every
// test file that imports this module, beside Solid's (`packages/solid/test/browser-commands.ts`): a
// `declare module` block adds to `BrowserCommands`, so each command is declared once, under its own name.
import type {} from "vitest/browser"

/** What {@link BrowserCommands.serverRenderProgram} returns. */
export interface ServerRenderedProgram {
  /** The program's markup, hydratable: its root stamped, each `w.*` element's identity marked, the chunk first among the Provider element's children. */
  readonly html: string
  /** The server render's error, first line; `""` when it rendered. */
  readonly error: string
}

declare module "vitest/browser" {
  interface BrowserCommands {
    /**
     * Server-render the program `exportName` of `file` (relative to packages/foldkit) in Node, through
     * Foldkit's `renderToString` under `buildId`, where the package reads its `node` condition (the
     * foldkit-hydrate project only). The export makes a fixture record (`hydrate-fixtures.ts`), its `program` the config.
     */
    serverRenderProgram: (file: string, exportName: string, buildId: string) => Promise<ServerRenderedProgram>
  }
}
