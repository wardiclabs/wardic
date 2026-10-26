"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "cut-carafe"].includes(product.id))

/** Three pieces from other shelves, to go with one. */
const pairingsOf = (piece: Product): ReadonlyArray<Product> => PRODUCTS.filter((other) => other.category !== piece.category).slice(0, 3)

// The suggestions slide in after the panel, and out before it: the panel's exit waits a moment, so
// the list visibly goes first.
const panel = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.97, transition: { type: "tween", duration: 0.2, delay: 0.16 } },
} as const

const pairing = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 26, delay: 0.12 } },
  exit: { opacity: 0, x: -16, transition: { type: "tween", duration: 0.16 } },
} as const

export default function QuickView() {
  const [open, setOpen] = useState<Product | null>(null)
  const close = () => setOpen(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <ul className="shelf">
        {SHELF.map((product) => {
          const photo = photoOf(product.id)
          return (
            <li key={product.id} className="shelf-item">
              <div className="photo">
                <img src={photo.small} srcSet={srcsetOf(photo)} sizes="160px" width={photo.width} height={photo.height} alt={product.name} />
              </div>
              <div className="line">
                <span className="name">{product.name}</span>
                <span className="price">{formatPrice(product.price)}</span>
              </div>
              <motion.button className="button quiet" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => setOpen(product)}>
                Quick view
              </motion.button>
            </li>
          )
        })}
      </ul>
      <AnimatePresence>
        {open && <motion.div key="backdrop" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.16 } }} onClick={close} />}
        {open && (
          <div key={open.id} className="detail-frame">
            <motion.article className="quick-view" role="dialog" aria-modal="true" aria-label={open.name} {...panel}>
              <QuickViewBody piece={open} onClose={close} />
            </motion.article>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

function QuickViewBody({ piece, onClose }: { readonly piece: Product; readonly onClose: () => void }) {
  const photo = photoOf(piece.id)
  // "Not for me" takes a suggestion out of the list, which is why the list is a presence of its own.
  const [dismissed, setDismissed] = useState<ReadonlyArray<string>>([])
  const shown = pairingsOf(piece).filter((other) => !dismissed.includes(other.id))
  return (
    <>
      <div className="photo">
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="200px" width={photo.width} height={photo.height} alt={piece.name} />
      </div>
      <div className="quick-view-body">
        <h2 className="name">{piece.name}</h2>
        <p className="price">{formatPrice(piece.price)}</p>
        <p className="muted">{piece.description}</p>
        <h3>Pairs well with</h3>
        <ul className="pairings">
          {/* propagate: when the dialog goes, these leave first, each running its exit, and the
              dialog waits for them. Without it, they'd vanish with it. */}
          <AnimatePresence propagate>
            {shown.map((other) => (
              <motion.li key={other.id} className="pairing" layout {...pairing}>
                <img src={photoOf(other.id).small} width="40" height="40" alt="" />
                <span className="name">{other.name}</span>
                <span className="price">{formatPrice(other.price)}</span>
                <button className="icon-button" aria-label={`Not for me: ${other.name}`} onClick={() => setDismissed([...dismissed, other.id])}>
                  ✕
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      <button className="icon-button close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </>
  )
}
