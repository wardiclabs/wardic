"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, m } from "motion/react"
import Link from "next/link"
import { startTransition, Suspense, use, useEffect, useOptimistic, useRef, useState } from "react"
import { addToCart } from "~/lib/store.ts"

// "View cart" slides out from behind the button once the piece is in the cart.
const viewCart = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12, transition: { type: "tween", duration: 0.12 } },
} as const

const MotionLink = m.create(Link)

export function AddToCart({ piece }: { readonly piece: Promise<Product> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the piece…</p>}>
      <BuyBox piece={piece} />
    </Suspense>
  )
}

function BuyBox(props: { readonly piece: Promise<Product> }) {
  const piece = use(props.piece)
  const photo = photoOf("poppy-plate")
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  const [failure, setFailure] = useState<string>()
  // "Adding…" is an optimistic value: set inside the transition, it shows at once, and goes back by
  // itself when the transition ends, whether the store answered or refused.
  const [adding, setAdding] = useOptimistic(false)

  // "Added ✓" stays a few seconds, then the button offers to add again.
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(reset.current), [])

  const buy = () =>
    startTransition(async () => {
      setAdding(true)
      setAdded(false)
      setFailure(undefined)
      try {
        // A server action: it refreshes the page, so the header's count reads the cart again.
        await addToCart(piece.id, quantity)
        startTransition(() => setAdded(true))
        clearTimeout(reset.current)
        reset.current = setTimeout(() => setAdded(false), 3000)
      } catch (error) {
        setFailure(messageOf(error))
      }
    })

  return (
    <article className="buy-box">
      <div className="photo">
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="160px" width={photo.width} height={photo.height} alt={piece.name} />
      </div>
      <div className="buy-body">
        <h2 className="name">{piece.name}</h2>
        <p className="muted">{piece.tagline}</p>
        <p className="price">{formatPrice(piece.price)}</p>
        <div className="buy-row">
          <div className="stepper" role="group" aria-label="Quantity">
            <button aria-label="One fewer" disabled={quantity === 1} onClick={() => setQuantity(quantity - 1)}>
              −
            </button>
            <span aria-live="polite">{quantity}</span>
            <button aria-label="One more" disabled={quantity === piece.stock} onClick={() => setQuantity(quantity + 1)}>
              +
            </button>
          </div>
          {/* The button's width follows its label: layout animates the change, and the label,
              layout="position", travels with it instead of stretching. */}
          <m.button className="button accent buy" layout disabled={adding} onClick={buy}>
            <m.span layout="position">{labelOf(adding, added)}</m.span>
          </m.button>
          <AnimatePresence>
            {added && (
              <MotionLink className="view-cart" href="/layout/cart-drawer" {...viewCart}>
                View cart →
              </MotionLink>
            )}
          </AnimatePresence>
        </div>
        {failure && (
          <p className="error-line" role="alert">
            {failure}
          </p>
        )}
      </div>
    </article>
  )
}

function labelOf(adding: boolean, added: boolean): string {
  if (adding) return "Adding…"
  if (added) return "Added ✓"
  return "Add to cart"
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
