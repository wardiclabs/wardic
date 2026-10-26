"use client"
import { formatDay, formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Order, Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion } from "motion/react"
import { Suspense, use, useRef, useState } from "react"

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

interface Props {
  readonly orders: Promise<ReadonlyArray<Order>>
  readonly products: Promise<ReadonlyArray<Product>>
}

export function OrderHistory({ orders, products }: Props) {
  const [sort, setSort] = useState<Sort>("newest")
  // The list is busy from a re-sort until its rows have landed.
  const [sorting, setSorting] = useState(false)
  const sortBy = (next: Sort) => {
    if (next === sort) return
    setSorting(true)
    // A re-sort is only the new order: Motion measures every layout element each time React
    // renders it, so the rows animate from where they were.
    setSort(next)
  }

  return (
    <section className="orders-panel" aria-label="Your orders">
      <header className="orders-head">
        <h2>Your orders</h2>
        <label className="sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => sortBy(event.currentTarget.value as Sort)}>
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORTS[key]}
              </option>
            ))}
          </select>
        </label>
      </header>
      <Suspense fallback={<p className="muted">Loading your orders…</p>}>
        <Orders orders={orders} products={products} sort={sort} sorting={sorting} landed={() => setSorting(false)} />
      </Suspense>
    </section>
  )
}

function Orders({ sort, sorting, landed, ...props }: Props & { readonly sort: Sort; readonly sorting: boolean; readonly landed: () => void }) {
  const orders = use(props.orders)
  const products = use(props.products)
  const [open, setOpen] = useState<string | null>(null)
  // Motion tells each row's layout animation starting and ending, not the whole change's: count
  // the rows on their way, and the list has landed when none is left.
  const moving = useRef(new Set<string>())

  return (
    // A scrolling panel: `layoutScroll` has Motion take its scroll out of what it measures, or a
    // row opened lower down would move by however far the panel has scrolled.
    <motion.ul className="orders" layoutScroll aria-busy={sorting}>
      {sortedBy(orders, sort).map((order) => (
        <motion.li
          key={order.id}
          className="order"
          layout
          onLayoutAnimationStart={() => moving.current.add(order.id)}
          onLayoutAnimationComplete={() => {
            moving.current.delete(order.id)
            if (moving.current.size === 0) landed()
          }}
        >
          <motion.button className="order-summary" layout="position" aria-expanded={open === order.id} onClick={() => setOpen(open === order.id ? null : order.id)}>
            <span className="order-id">{order.id}</span>
            <span className="order-day">{formatDay(order.placedOn)}</span>
            <span className="status" data-status={order.status}>
              {order.status}
            </span>
            <span className="order-total">{formatPrice(order.total)}</span>
          </motion.button>
          <AnimatePresence initial={false} mode="popLayout">
            {open === order.id && (
              <motion.ul key="lines" className="order-lines" layout="position" {...reveal}>
                {order.lines.map((line) => (
                  <OrderLine key={line.productId} line={line} product={products.find((product) => product.id === line.productId)} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </motion.li>
      ))}
    </motion.ul>
  )
}

function OrderLine({ line, product }: { readonly line: Order["lines"][number]; readonly product: Product | undefined }) {
  return (
    <li>
      <img src={photoOf(line.productId).small} width="40" height="40" alt="" />
      {product && <span>{product.name}</span>}
      <span className="muted">× {line.quantity}</span>
    </li>
  )
}
