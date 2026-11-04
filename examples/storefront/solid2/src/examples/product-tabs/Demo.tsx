import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, Loading, Match, Show, Switch } from "solid-js"
import { product } from "~/lib/store.ts"
import { layout } from "~/lib/layout-feature.ts"

const TABS = ["Description", "Details", "Delivery"] as const
type Tab = (typeof TABS)[number]

// The panel that's going fades up and out, then the next fades up in (mode="wait").
const panel = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: "tween", duration: 0.18 },
} as const

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function ProductTabs() {
  return (
    <LazyWardic features={[layout]}>
      <ProductTabsDemo />
    </LazyWardic>
  )
}

function ProductTabsDemo() {
  const piece = createMemo(() => product("lagoon-vase"))
  const [tab, setTab] = createSignal<Tab>("Description")
  const photo = photoOf("lagoon-vase")
  return (
    <Loading fallback={<p class="muted">Loading the piece…</p>}>
      <article class="product-page">
        <div class="photo">
          <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 720px) 100vw, 420px" width={photo.width} height={photo.height} alt={piece().name} />
        </div>
        <div class="product-info">
          <h2 class="name">{piece().name}</h2>
          <p class="price">{formatPrice(piece().price)}</p>
          <div class="tabs" role="tablist" aria-label="About this piece">
            <For each={TABS}>
              {(name) => (
                <button class="tab" role="tab" aria-selected={String(tab() === name) as "true" | "false"} aria-controls="piece-panel" onClick={() => setTab(name)}>
                  {name}
                  {/* One indicator, under whichever tab is selected: its layoutId carries it from tab to tab. */}
                  <Show when={tab() === name}>
                    <w.span class="tab-indicator" layoutId="tab-indicator" />
                  </Show>
                </button>
              )}
            </For>
          </div>
          <div class="tab-panel" id="piece-panel" role="tabpanel" aria-label={tab()}>
            <AnimatePresence mode="wait" initial={false}>
              {/* keyed: each tab is a new child, so the last one leaves before it enters. */}
              <Show when={tab()} keyed>
                {(name) => (
                  <w.div {...panel}>
                    <PanelFor tab={name} piece={piece()} />
                  </w.div>
                )}
              </Show>
            </AnimatePresence>
          </div>
        </div>
      </article>
    </Loading>
  )
}

function PanelFor(props: { readonly tab: Tab; readonly piece: Product }) {
  return (
    <Switch>
      <Match when={props.tab === "Description"}>
        <p>{props.piece.description}</p>
      </Match>
      <Match when={props.tab === "Details"}>
        <ul class="details">
          <For each={props.piece.details}>{(detail) => <li>{detail}</li>}</For>
        </ul>
      </Match>
      <Match when={props.tab === "Delivery"}>
        <p>Ships in two to three working days, wrapped in recycled paper. Delivery is free over $100, and you can return a piece within 30 days, unused and in its box.</p>
      </Match>
    </Switch>
  )
}
