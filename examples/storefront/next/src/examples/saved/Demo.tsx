"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react"
import { startTransition, useOptimistic, useState } from "react"
import { arrivalId, arrive, recall } from "~/lib/arrivals.ts"
import { addToCart } from "~/lib/store.ts"

const SAVED = PRODUCTS.filter((product) => ["bottle-vase", "tulip-bowl", "painted-jug", "cut-carafe"].includes(product.id))

const without = (id: string) => (list: ReadonlyArray<Product>) => list.filter((one) => one.id !== id)

export default function SavedForLater() {
  // The pieces still saved: what the list settles on once a move has landed.
  const [kept, setKept] = useState<ReadonlyArray<Product>>(SAVED)
  // What it shows: those, less any on their way to the cart, until the move's transition ends. If
  // the store refuses it, the transition ends with `kept` unchanged, and the row comes back.
  const [saved, takeOut] = useOptimistic(kept, (list, id: string) => without(id)(list))
  const [failure, setFailure] = useState<string>()
  // The system's setting, or the header's switch (`MotionConfig`).
  const reduced = useReducedMotionConfig()

  // A click: the row leaves, and its photo's twin appears in the cart button, sharing its
  // `layoutId`, so Motion flies the photo there from the row it left (under reduced motion, nothing
  // flies). A piece already on its way, its leaving row clicked again, is left alone.
  const move = (piece: Product) => {
    if (!saved.some((one) => one.id === piece.id)) return
    setFailure(undefined)
    if (!reduced) arrive({ id: piece.id, src: photoOf(piece.id).small })
    startTransition(async () => {
      takeOut(piece.id)
      try {
        // A server action: it refreshes the page, so the header's count reads the cart again.
        await addToCart(piece.id, 1)
        startTransition(() => setKept(without(piece.id)))
      } catch (error) {
        // Refused: its row comes back, and its twin leaves the cart button, its photo flying back.
        recall(piece.id)
        setFailure(`${piece.name} wasn't moved: ${messageOf(error)}`)
      }
    })
  }

  return (
    <div className="saved">
      <ul className="saved-list">
        {/* popLayout: a leaving row steps out of the list at once, and the rows below close the gap while it goes. */}
        <AnimatePresence mode="popLayout">
          {saved.map((piece) => (
            <SavedRow key={piece.id} piece={piece} onMove={() => move(piece)} onRemove={() => setKept(without(piece.id))} />
          ))}
        </AnimatePresence>
      </ul>
      {saved.length === 0 && (
        <p className="saved-empty muted">
          Nothing saved for later.{" "}
          <button className="button quiet" onClick={() => setKept(SAVED)}>
            Save them again
          </button>
        </p>
      )}
      {failure && (
        <p className="error-line" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}

function SavedRow({ piece, onMove, onRemove, ref }: { readonly piece: Product; readonly onMove: () => void; readonly onRemove: () => void; readonly ref?: React.Ref<HTMLLIElement> }) {
  const photo = photoOf(piece.id)
  return (
    // It fades as it leaves, either way. Moved to the cart, its photo's twin there flies from its own.
    // (`popLayout` measures a leaving child through its ref: a component passes it on.)
    <motion.li ref={ref} className="saved-row" layout exit={{ opacity: 0, transition: { type: "tween", duration: 0.22, ease: "easeOut" } }}>
      <motion.div className="photo" layoutId={arrivalId(piece.id)}>
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="72px" width={photo.width} height={photo.height} alt={piece.name} />
      </motion.div>
      <div className="saved-text">
        <span className="name">{piece.name}</span>
        <span className="price">{formatPrice(piece.price)}</span>
      </div>
      <div className="saved-actions">
        <motion.button className="button accent" whileTap={{ scale: 0.96 }} onClick={onMove}>
          Move to cart
        </motion.button>
        <button className="button quiet" onClick={onRemove}>
          Remove
        </button>
      </div>
    </motion.li>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
