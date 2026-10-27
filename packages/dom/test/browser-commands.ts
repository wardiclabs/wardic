// The browser commands registered in packages/dom/vitest.browser.config.ts, typed once for every
// test file that imports this module.
import type {} from "vitest/browser"

declare module "vitest/browser" {
  interface BrowserCommands {
    /** Two full garbage collections (#418): a `WeakRef` read after it is empty if nothing else holds its target. */
    collectGarbage: () => Promise<void>
  }
}
