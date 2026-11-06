// Wardic's Solid 2 side (`@wardic/solid/unstable/v2`, `DomLive`), or plain Solid 2 divs with
// `?kind=plain`: bench:solid's page-v2. Each update is written then `flush()`ed, so Solid 2 applies it
// in the timed task, as `flushSync` does for React's.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { type JSX, render } from "@solidjs/web"
import { createSignal, flush, For, Show } from "solid-js"
import { addStyle, atIn, install } from "./timing.ts"

const params = new URLSearchParams(location.search)
const n = Number(params.get("n") ?? "1000")
const kind = params.get("kind") ?? "wardic"
const [shown, setShown] = createSignal(false)
const [target, setTarget] = createSignal({ o: 1, c: "rgb(255, 255, 255)" })
const items = Array.from({ length: n }, (_, i) => i)
const host = addStyle()
const Wardic = () => (
  <WardicProvider env={DomLive}>
    <Show when={shown()}>
      <For each={items}>
        {() => <wardic.div class="b" initial={{ opacity: 0, "background-color": "rgb(0, 0, 0)" }} animate={{ opacity: target().o, "background-color": target().c }} />}
      </For>
    </Show>
  </WardicProvider>
)
const Plain = () => (
  <Show when={shown()}>
    <For each={items}>{() => <div class="b" style={{ opacity: String(target().o), "background-color": target().c }} />}</For>
  </Show>
)
/** The page each `?kind` renders: Wardic's elements, else plain Solid's. */
const PAGES: Record<string, () => JSX.Element> = { plain: Plain, wardic: Wardic }
const Page = PAGES[kind] ?? Wardic
render(() => <Page />, host)
flush()
install(n, {
  show: (s) => {
    setShown(s)
    flush()
  },
  target: (o, c) => {
    setTarget({ o, c })
    flush()
  },
  count: () => host.querySelectorAll(".b").length,
  at: (o, c) => atIn(host, o, c),
})
