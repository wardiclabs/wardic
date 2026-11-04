import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { CATEGORIES, type Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, Loading } from "solid-js"
import { products } from "~/lib/store.ts"

const FILTERS = ["All", ...CATEGORIES] as const
type Filter = (typeof FILTERS)[number]
type View = "grid" | "list"

// A product a filter brings in grows into place; one it takes out shrinks and fades where it was,
// out of the flow (popLayout), while the ones after it slide into its space.
const item = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
} as const

export default function Browse() {
  const all = createMemo(() => products())
  const [filter, setFilter] = createSignal<Filter>("All")
  const [view, setView] = createSignal<View>("grid")
  const shown = createMemo(() => all().filter((product) => filter() === "All" || product.category === filter()))

  return (
    <div class="shop">
      <div class="shop-toolbar">
        <div class="chips" role="group" aria-label="Category">
          <For each={FILTERS}>
            {(name) => (
              <button class="chip" aria-pressed={String(filter() === name) as "true" | "false"} onClick={() => setFilter(name)}>
                {name}
              </button>
            )}
          </For>
        </div>
        {/* Switching the view changes every card's size: each one sees it, and animates from where it was. */}
        <div class="segmented" role="group" aria-label="View">
          <button aria-pressed={String(view() === "grid") as "true" | "false"} onClick={() => setView("grid")}>
            Grid
          </button>
          <button aria-pressed={String(view() === "list") as "true" | "false"} onClick={() => setView("list")}>
            List
          </button>
        </div>
      </div>
      <Loading fallback={<p class="muted">Loading the shop…</p>}>
        <ul class="shop-items" data-view={view()}>
          {/* initial={false}: the products already there when the page opens don't grow in. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <For each={shown()}>{(product) => <Item product={product} />}</For>
          </AnimatePresence>
        </ul>
      </Loading>
    </div>
  )
}

function Item(props: { readonly product: Product }) {
  const photo = photoOf(props.product.id)
  return (
    <w.li class="shop-item" layout {...item}>
      {/* The photo changes size between the views: plain layout, its corners kept round as it scales. */}
      <w.div class="photo" layout>
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 50vw, 240px" width={photo.width} height={photo.height} alt={props.product.name} />
      </w.div>
      {/* Text only travels: layout="position" moves it to its new place without stretching it. */}
      <w.span class="name" layout="position">
        {props.product.name}
      </w.span>
      <w.span class="price" layout="position">
        {formatPrice(props.product.price)}
      </w.span>
      <w.span class="tagline" layout="position">
        {props.product.tagline}
      </w.span>
    </w.li>
  )
}
