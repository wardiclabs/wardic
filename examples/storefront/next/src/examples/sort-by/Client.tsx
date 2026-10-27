"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion } from "motion/react"
import { Select } from "radix-ui"
import { Suspense, use, useState } from "react"

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

export function SortBy({ pieces }: { readonly pieces: Promise<ReadonlyArray<Product>> }) {
  const [order, setOrder] = useState("Featured")
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="sort-head">
        <h2>The shop</h2>
        <Select.Root value={order} onValueChange={setOrder} open={open} onOpenChange={setOpen}>
          <Select.Trigger className="select-trigger" aria-label="Sort by">
            <span className="muted">Sort by</span>
            {/* Its text, given: Radix reads it from the items, which aren't rendered while the list is closed. */}
            <Select.Value>{order}</Select.Value>
            <Select.Icon>⌄</Select.Icon>
          </Select.Trigger>
          {/* forceMount: Radix keeps its list mounted, and Motion's presence decides when it goes, so
              it can shrink away. */}
          <AnimatePresence>
            {open && (
              <Select.Portal forceMount>
                {/* position="popper" places the list against its button, and writes the edge it opens
                    from into this variable: it grows from there. */}
                <Select.Content asChild forceMount position="popper" sideOffset={6}>
                  <motion.div className="select-list" style={{ transformOrigin: "var(--radix-select-content-transform-origin)" }} {...grow}>
                    <Select.Viewport>
                      {ORDERS.map((name) => (
                        <Select.Item key={name} value={name} className="select-item">
                          <Select.ItemText>{name}</Select.ItemText>
                          <Select.ItemIndicator>✓</Select.ItemIndicator>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </motion.div>
                </Select.Content>
              </Select.Portal>
            )}
          </AnimatePresence>
        </Select.Root>
      </div>
      <Suspense fallback={<p className="muted">Loading the shop…</p>}>
        <Pieces pieces={pieces} order={order} />
      </Suspense>
    </div>
  )
}

// Each card is a layout element: Motion measures it as React renders the new order, and it slides there.
function Pieces(props: { readonly pieces: Promise<ReadonlyArray<Product>>; readonly order: string }) {
  const pieces = use(props.pieces)
  return (
    <ul className="shop-items" data-view="grid">
      {sortedBy(pieces, props.order).map((piece) => (
        <Card key={piece.id} piece={piece} />
      ))}
    </ul>
  )
}

function Card({ piece }: { readonly piece: Product }) {
  const photo = photoOf(piece.id)
  return (
    <motion.li className="shop-item" layout>
      <div className="photo">
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 640px) 50vw, 240px" width={photo.width} height={photo.height} alt={piece.name} />
      </div>
      <span className="name">{piece.name}</span>
      <span className="price">{formatPrice(piece.price)}</span>
    </motion.li>
  )
}
