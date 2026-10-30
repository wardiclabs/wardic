"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { addToCart } from "~/lib/store.ts"

interface Toast {
  readonly id: number
  readonly kind: "added" | "failed"
  readonly text: string
}

// A toast rises in at the bottom of the stack and shrinks away as it goes. Each is a layout
// element: when one goes, the presence pops it out of the stack (mode="popLayout"), and the others
// slide into its place while it fades. The stack sits in its corner, so one that goes is pinned by
// its bottom right (anchorX, anchorY): if the stack resizes as it goes, it stays in the corner.
const toastMotion = {
  initial: { opacity: 0, y: 24, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.9, transition: { type: "tween", duration: 0.18 } },
  transition: { type: "spring", stiffness: 420, damping: 32 },
} as const

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "poppy-plate"].includes(product.id))

/** How long a toast stays, and how many show at once: a fourth pushes the oldest out. */
const STAYS_MS = 4000
const AT_MOST = 3

export default function Toasts() {
  const [toasts, setToasts] = useState<ReadonlyArray<Toast>>([])
  const nextId = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const all = timers.current
    return () => all.forEach(clearTimeout)
  }, [])

  const dismiss = (id: number) => setToasts((all) => all.filter((toast) => toast.id !== id))
  const show = (kind: Toast["kind"], text: string) => {
    const id = nextId.current++
    setToasts((all) => [...all, { id, kind, text }].slice(-AT_MOST))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      dismiss(id)
    }, STAYS_MS)
    timers.current.add(timer)
  }

  const buy = async (product: Product) => {
    try {
      // A server action: it refreshes the page, so the header's count reads the cart again.
      await addToCart(product.id, 1)
      show("added", `${product.name} is in your cart.`)
    } catch (error) {
      show("failed", `${product.name} wasn't added: ${messageOf(error)}`)
    }
  }

  return (
    <div className="toast-demo">
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
              <motion.button className="button quiet" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => buy(product)}>
                Add to cart
              </motion.button>
            </li>
          )
        })}
      </ul>
      <ol className="toasts" aria-live="polite" aria-label="Notifications">
        <AnimatePresence mode="popLayout" anchorX="right" anchorY="bottom">
          {toasts.map((toast) => (
            <motion.li key={toast.id} className="toast" data-kind={toast.kind} layout {...toastMotion}>
              <span>{toast.text}</span>
              <button className="icon-button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                ✕
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
