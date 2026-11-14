import { Tabs } from "@kobalte/core/tabs"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { w } from "~/lib/wardic-layout.ts"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { product } from "~/lib/store.ts"

// Kobalte's panel, taking Wardic's motion props: the ward goes on the element it renders. Kobalte
// renders a panel only while its tab is chosen, and each time it does, the panel's element enters
// afresh, from `initial`.
const Panel = w.create(Tabs.Content)

// A panel fades up in each time its tab is chosen.
const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "tween", duration: 0.2 },
} as const

// The piece's details, in its catalog's order: its size, its material, its care.
const TABS = ["Size", "Material", "Care"]

export default function DetailsTabs() {
  const piece = createMemo(() => product("moon-vase"))
  const [tab, setTab] = createSignal("Size")
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
                      <w.span class="tab-indicator" layoutId="details-underline" />
                    </Show>
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
            <For each={TABS}>
              {(name, index) => (
                <Panel class="tab-panel" value={name} {...fadeIn}>
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
