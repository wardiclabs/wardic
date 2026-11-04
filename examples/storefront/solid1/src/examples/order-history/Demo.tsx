import { createAsync } from "@solidjs/router"
import { formatDay, formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Order, Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, LazyWardic, useAnimateLayout, w } from "@wardic/solid"
import { createSignal, For, Show, Suspense } from "solid-js"
import { orders, products } from "~/lib/store.ts"
import { layout } from "~/lib/layout-feature.ts"

// An order's pieces fade in once its row has started to open, and out quickly as it closes.
const reveal = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { type: "tween", duration: 0.2, delay: 0.1 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

const SORTS = { newest: "Newest first", oldest: "Oldest first", total: "Highest total" } as const
type Sort = keyof typeof SORTS
const SORT_KEYS = Object.keys(SORTS) as ReadonlyArray<Sort>

/** `orders` in `sort`'s order: they come newest first. */
function sortedBy(orders: ReadonlyArray<Order>, sort: Sort): ReadonlyArray<Order> {
  if (sort === "oldest") return [...orders].reverse()
  if (sort === "total") return [...orders].sort((a, b) => b.total - a.total)
  return orders
}

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function OrderHistory() {
  return (
    <LazyWardic features={[layout]}>
      <OrderHistoryDemo />
    </LazyWardic>
  )
}

function OrderHistoryDemo() {
  const history = createAsync(() => orders())
  const all = createAsync(() => products())
  const [open, setOpen] = createSignal<string>()
  const [sort, setSort] = createSignal<Sort>("newest")
  const animateLayout = useAnimateLayout()

  // A re-sort moves the orders without resizing any, and nothing else tells them they've moved:
  // declare it, so each one animates from where it is now, inside the scrolled panel too.
  const sortBy = (next: Sort) => animateLayout(() => setSort(next))
  const toggle = (id: string) => {
    if (open() === id) setOpen(undefined)
    else setOpen(id)
  }
  const productOf = (id: string): Product | undefined => {
    const list = all()
    if (list === undefined) return undefined
    return list.find((product) => product.id === id)
  }

  return (
    <section class="orders-panel" aria-label="Your orders">
      <header class="orders-head">
        <h2>Your orders</h2>
        <label class="sort">
          <span>Sort</span>
          <select value={sort()} onChange={(event) => sortBy(event.currentTarget.value as Sort)}>
            <For each={SORT_KEYS}>{(key) => <option value={key}>{SORTS[key]}</option>}</For>
          </select>
        </label>
      </header>
      <Suspense fallback={<p class="muted">Loading your orders…</p>}>
        {/* A scrolling panel: Wardic measures each row where it's drawn, however far the panel has
            scrolled, so opening one lower down moves the rows below it, and nothing else. */}
        <Show when={history()}>
          {(list) => (
            <ul class="orders">
              <For each={sortedBy(list(), sort())}>
                {(order) => (
                  <w.li class="order" layout>
                    <w.button class="order-summary" layout="position" aria-expanded={open() === order.id} onClick={() => toggle(order.id)}>
                      <span class="order-id">{order.id}</span>
                      <span class="order-day">{formatDay(order.placedOn)}</span>
                      <span class="status" data-status={order.status}>
                        {order.status}
                      </span>
                      <span class="order-total">{formatPrice(order.total)}</span>
                    </w.button>
                    <AnimatePresence initial={false} mode="popLayout">
                      <Show when={open() === order.id}>
                        <w.ul class="order-lines" layout="position" {...reveal}>
                          <For each={order.lines}>{(line) => <OrderLine line={line} product={productOf(line.productId)} />}</For>
                        </w.ul>
                      </Show>
                    </AnimatePresence>
                  </w.li>
                )}
              </For>
            </ul>
          )}
        </Show>
      </Suspense>
    </section>
  )
}

function OrderLine(props: { readonly line: Order["lines"][number]; readonly product: Product | undefined }) {
  return (
    <li>
      <img src={photoOf(props.line.productId).small} width="40" height="40" alt="" />
      <Show when={props.product}>{(product) => <span>{product().name}</span>}</Show>
      <span class="muted">× {props.line.quantity}</span>
    </li>
  )
}
