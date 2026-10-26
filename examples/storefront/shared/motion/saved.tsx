// Saved for later in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. The
// row's photo and a twin in the header's cart button share a `layoutId`, so Motion flies it there.
// The list is React 19's `useOptimistic`: the row leaves at the click, and comes back if the store
// refuses it.
import { AnimatePresence, motion } from "motion/react"
import { startTransition, useOptimistic, useState } from "react"

interface Piece {
  readonly id: string
  readonly name: string
  readonly photo: string
}

/** The pieces on their way to the cart, shared with the header: a context, or the app's store. */
export interface Arrivals {
  readonly arrive: (piece: Piece) => void
  readonly recall: (id: string) => void
}

export function SavedForLater(props: { readonly pieces: ReadonlyArray<Piece>; readonly addToCart: (id: string) => Promise<void>; readonly arrivals: Arrivals }) {
  const [saved, setSaved] = useState(props.pieces)
  // What it shows: the pieces saved, less any on their way to the cart, until the transition ends.
  const [shown, takeOut] = useOptimistic(saved, (list, id: string) => list.filter((piece) => piece.id !== id))
  const [failure, setFailure] = useState<string>()
  const without = (id: string) => (list: ReadonlyArray<Piece>) => list.filter((piece) => piece.id !== id)

  const move = (piece: Piece) => {
    // A piece already on its way, its leaving row clicked again, is left alone.
    if (!shown.some((one) => one.id === piece.id)) return
    setFailure(undefined)
    props.arrivals.arrive(piece)
    startTransition(async () => {
      takeOut(piece.id)
      try {
        await props.addToCart(piece.id)
        startTransition(() => setSaved(without(piece.id)))
      } catch {
        // Refused: the row comes back, and its twin leaves the cart button, the photo flying back.
        props.arrivals.recall(piece.id)
        setFailure(`${piece.name} wasn't moved`)
      }
    })
  }

  return (
    <>
      <ul className="saved-list">
        <AnimatePresence mode="popLayout">
          {shown.map((piece) => (
            <motion.li key={piece.id} className="saved-row" layout exit={{ opacity: 0, transition: { duration: 0.22, ease: "easeOut" } }}>
              <motion.img layoutId={`saved-${piece.id}`} src={piece.photo} alt={piece.name} />
              <span className="name">{piece.name}</span>
              <button className="button accent" onClick={() => move(piece)}>
                Move to cart
              </button>
              <button className="button quiet" onClick={() => setSaved(without(piece.id))}>
                Remove
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {failure && (
        <p className="error-line" role="alert">
          {failure}
        </p>
      )}
    </>
  )
}

/** In the header's cart button: each piece arriving, its photo's twin, landing, then shrinking into the icon. */
export function CartArrivals(props: { readonly arriving: ReadonlyArray<Piece>; readonly landed: (id: string) => void }) {
  return (
    <AnimatePresence>
      {props.arriving.map((piece) => (
        <motion.img
          key={piece.id}
          className="cart-arrival"
          layoutId={`saved-${piece.id}`}
          src={piece.photo}
          alt=""
          transition={{ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1] } }}
          exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.25 } }}
          onLayoutAnimationComplete={() => props.landed(piece.id)}
        />
      ))}
    </AnimatePresence>
  )
}
