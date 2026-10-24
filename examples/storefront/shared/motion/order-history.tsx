// The order history in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. A
// re-sort is only the new order: Motion measures every layout element each time React renders it.
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

interface Order {
  readonly id: string
  readonly placedOn: string
  readonly total: string
  readonly lines: ReadonlyArray<string>
}

type Sort = "newest" | "oldest"

export function OrderHistory({ orders }: { readonly orders: ReadonlyArray<Order> }) {
  const [sort, setSort] = useState<Sort>("newest")
  const [open, setOpen] = useState<string | null>(null)
  const sorted = sort === "oldest" ? [...orders].reverse() : orders

  return (
    <section className="orders-panel">
      <header className="orders-head">
        <h2>Your orders</h2>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </header>
      <ul className="orders">
        {sorted.map((order) => (
          <motion.li key={order.id} className="order" layout>
            <motion.button className="order-summary" layout="position" onClick={() => setOpen(open === order.id ? null : order.id)}>
              {order.id} · {order.placedOn} · {order.total}
            </motion.button>
            <AnimatePresence initial={false} mode="popLayout">
              {open === order.id && (
                <motion.ul key="lines" className="order-lines" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {order.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.li>
        ))}
      </ul>
    </section>
  )
}
