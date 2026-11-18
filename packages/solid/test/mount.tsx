// Mounting for the Solid 2 binding's browser tests (#209): `@solidjs/web`'s `render` into a host
// on the page, disposed and removed after each test (`@solidjs/testing-library` is Solid 1's).
import type { JSX } from "@solidjs/web"
import { render } from "@solidjs/web"
import { afterEach } from "vitest"

const mounted: Array<() => void> = []
afterEach(() => {
  for (const unmount of mounted.splice(0).reverse()) unmount()
})

/** Render `ui` into a fresh host; `unmount` disposes it, and every one left is disposed after the test. */
export const mount = (ui: () => JSX.Element): { readonly host: HTMLElement; readonly unmount: () => void } => {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(ui, host)
  let done = false
  const unmount = (): void => {
    if (done) return
    done = true
    dispose()
    host.remove()
  }
  mounted.push(unmount)
  return { host, unmount }
}
