import { Tabs } from "@kobalte/core/tabs"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { wardic } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { product } from "~/lib/store.ts"

// Kobalte's panel, taking Wardic's motion props: the ward goes on the element it renders.
const Panel = wardic.create(Tabs.Content)

// A panel fades up in as its tab is chosen; the others wait, hidden, at the start of it.
const panel = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0 },
} as const

// The piece's details, in its catalog's order: its size, its material, its care.
const TABS = ["Size", "Material", "Care"]

export default function DetailsTabs() {
  const piece = createMemo(() => product("moon-vase"))
  const [tab, setTab] = createSignal("Size")
  const stateOf = (name: string) => {
    if (tab() === name) return "shown"
    return "hidden"
  }
  const photo = photoOf("moon-vase")
  return (
    <Loading fallback={<p class="muted">Loading the piece…</p>}>
      <article class="product-page details-tabs">
        <div class="photo">
          <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 720px) 100vw, 420px" width={photo.width} height={photo.height} alt={piece().name} />
        </div>
        <div class="product-info">
          <h2 class="name">{piece().name}</h2>
          <p class="price">{formatPrice(piece().price)}</p>
          {/* Kobalte's tabs: the arrow keys, Home and End, one tab in the Tab order, and the roles. */}
          <Tabs value={tab()} onChange={setTab}>
            <Tabs.List class="tabs" aria-label="About this piece">
              <For each={TABS}>
                {(name) => (
                  <Tabs.Trigger class="tab" value={name}>
                    {name}
                    {/* One underline, inside whichever trigger is selected: its layoutId carries it from tab to tab. */}
                    <Show when={tab() === name}>
                      <wardic.span class="tab-indicator" layoutId="details-underline" />
                    </Show>
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
            {/* forceMount: Kobalte keeps every panel on the page, marking the chosen one
                `data-selected` (the stylesheet hides the rest), so each is there to fade in. */}
            <For each={TABS}>
              {(name, index) => (
                <Panel class="tab-panel" value={name} forceMount variants={panel} initial={false} animate={stateOf(name)} transition={{ type: "tween", duration: 0.2 }}>
                  {piece().details[index()]}
                </Panel>
              )}
            </For>
          </Tabs>
        </div>
      </article>
    </Loading>
  )
}
