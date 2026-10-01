// Shared helpers for the server tier (`*.ssr.test.tsx`, packages/solid/vitest.ssr.config.ts):
// render under a WardicProvider with Solid's server build, and read the markup back.
// Not a test file itself (the project collects `*.ssr.test.tsx` only).
import { DomLive } from "@wardic/dom"
import { WardicProvider, type WardicEnv } from "@wardic/solid"
import { createComponent, type JSX } from "solid-js"
import { renderToString } from "solid-js/web"
import { expect } from "vitest"

/** One opening tag in server markup: its name, attributes and parsed inline style. */
export interface Tag {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly style: Readonly<Record<string, string>>
}

/** Every opening tag in `html`, in document order, with its attributes and its parsed inline style. */
export const tagsOf = (html: string): ReadonlyArray<Tag> =>
  [...html.matchAll(/<([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)].map(([, name, rest]) => {
    const attrs = Object.fromEntries([...rest!.matchAll(/([^\s=>]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k!, v ?? ""]))
    const style = Object.fromEntries(
      (attrs.style ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d !== "")
        .map((d) => {
          const i = d.indexOf(":")
          return [d.slice(0, i).trim(), d.slice(i + 1).trim()]
        }),
    )
    return { name: name!, attrs, style }
  })

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
