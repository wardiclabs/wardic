// Shared helpers for the server tier (`*.ssr.test.tsx`, packages/solid/vitest.ssr.config.ts):
// render under a WardicProvider with Solid's server build, and read the markup back.
// Not a test file itself (the project collects `*.ssr.test.tsx` only).
import { DomLive } from "@wardic/dom"
import { WardicProvider, type WardicEnv } from "@wardic/solid"
import { createComponent, type JSX } from "solid-js"
import { renderToString } from "solid-js/web"
import { expect } from "vitest"
import type { Tag } from "./markup.ts"

export { type Tag, tagsOf } from "./markup.ts"

/**
 * Server-render `ui` inside `<WardicProvider env={env}>` (DomLive by default, as an app
 * does). `createComponent` is what the JSX compiles to, so the hydration keys match.
 */
export const serve = (ui: () => JSX.Element, env: WardicEnv = DomLive): string =>
  renderToString(() =>
    createComponent(WardicProvider, {
      env,
      get children() {
        return ui()
      },
    }),
  )

/** Motion's drag defaults on a server-rendered tag, with `touchAction` for its axis. */
export const expectDragDefaults = (t: Tag, touchAction: string): void => {
  expect(t.attrs.draggable, `${t.name} draggable`).toBe("false")
  expect(t.style["touch-action"], `${t.name} touch-action`).toBe(touchAction)
  expect(t.style["user-select"], `${t.name} user-select`).toBe("none")
  expect(t.style["-webkit-user-select"], `${t.name} -webkit-user-select`).toBe("none")
  expect(t.style["-webkit-touch-callout"], `${t.name} -webkit-touch-callout`).toBe("none")
}
