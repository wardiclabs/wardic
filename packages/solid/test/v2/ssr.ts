// Server renders for the Solid 2 binding's server tests (#209): under its WardicProvider, with
// `@solidjs/web`'s server build. Not a test file itself.
import { DomLive } from "@wardic/dom"
import { WardicProvider, type WardicEnv } from "@wardic/solid/unstable/v2"
import { type JSX, renderToString } from "@solidjs/web"
import { createComponent } from "solid-js"

export { type Tag, tagsOf } from "../markup.ts"

/** Server-render `ui` inside `<WardicProvider env={env}>` (DomLive by default, as an app does). */
export const serve = (ui: () => JSX.Element, env: WardicEnv = DomLive): string =>
  renderToString(() =>
    createComponent(WardicProvider, {
      env,
      get children() {
        return ui()
      },
    }),
  )
