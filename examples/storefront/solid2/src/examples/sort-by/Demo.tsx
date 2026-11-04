import { Select } from "@kobalte/core/select"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, LazyWardic, useAnimateLayout, w } from "@wardic/solid/unstable/v2"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { products } from "~/lib/store.ts"
import { layout } from "~/lib/layout-feature.ts"

// Kobalte's list, taking Wardic's motion props: the ward goes on the element it renders.
const List = w.create(Select.Content)

// The list grows from the edge it opens from, and shrinks back there as it goes.
const grow = {
  initial: { opacity: 0, scale: 0.94 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.94 },
  transition: { type: "tween", duration: 0.16 },
} as const

const ORDERS = ["Featured", "Price, low to high", "Price, high to low", "Name"]

/** `pieces` in `order`: they come featured first. */
function sortedBy(pieces: ReadonlyArray<Product>, order: string): ReadonlyArray<Product> {
  if (order === "Price, low to high") return [...pieces].sort((a, b) => a.price - b.price)
  if (order === "Price, high to low") return [...pieces].sort((a, b) => b.price - a.price)
  if (order === "Name") return [...pieces].sort((a, b) => a.name.localeCompare(b.name))
  return pieces
}

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function SortBy() {
  return (
    <LazyWardic features={[layout]}>
      <SortByDemo />
    </LazyWardic>
  )
}

function SortByDemo() {
  const pieces = createMemo(() => products())
  const [order, setOrder] = createSignal("Featured")
  const [open, setOpen] = createSignal(false)
  const animateLayout = useAnimateLayout()

  // A re-sort moves the pieces without resizing any, and nothing else tells them they've moved:
  // declare it, so each slides from where it is to its new place.
  const sortBy = (next: string | null) => {
    if (next !== null) animateLayout(() => setOrder(next))
  }

  return (
    <div>
      <div class="sort-head">
        <h2>The shop</h2>
        {/* forceMount: Kobalte keeps its list mounted, and the presence below decides when it goes,
            so it can shrink away. Kobalte's own presence waits only for CSS animations. */}
        <Select
          options={ORDERS}
          value={order()}
          onChange={sortBy}
          open={open()}
          onOpenChange={setOpen}
          forceMount
          gutter={6}
          itemComponent={(props) => (
            <Select.Item item={props.item} class="select-item">
              <Select.ItemLabel>{props.item.rawValue}</Select.ItemLabel>
              <Select.ItemIndicator>✓</Select.ItemIndicator>
            </Select.Item>
          )}
        >
          <Select.Trigger class="select-trigger" aria-label="Sort by">
            <span class="muted">Sort by</span>
            <Select.Value<string>>{(state) => state.selectedOption()}</Select.Value>
            <Select.Icon>⌄</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <AnimatePresence>
              <Show when={open()}>
                {/* Kobalte writes the edge the list opens from into this variable: it grows from there. */}
                <List class="select-list" style={{ "transform-origin": "var(--kb-select-content-transform-origin)" }} {...grow}>
                  <Select.Listbox />
                </List>
              </Show>
            </AnimatePresence>
          </Select.Portal>
        </Select>
      </div>
      <Loading fallback={<p class="muted">Loading the shop…</p>}>
        <ul class="shop-items" data-view="grid">
          <For each={sortedBy(pieces(), order())}>{(piece) => <Card piece={piece} />}</For>
        </ul>
      </Loading>
    </div>
  )
}

function Card(props: { readonly piece: Product }) {
  const photo = photoOf(props.piece.id)
  return (
    <w.li class="shop-item" layout>
      <div class="photo">
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 50vw, 240px" width={photo.width} height={photo.height} alt={props.piece.name} />
      </div>
      <span class="name">{props.piece.name}</span>
      <span class="price">{formatPrice(props.piece.price)}</span>
    </w.li>
  )
}
