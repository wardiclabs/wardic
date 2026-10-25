// Saved for later in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. A
// leaving row keeps rendering, so it runs its own exit in an effect once `isPresent` turns false.
import { AnimatePresence, motion, usePresence, usePresenceData } from "motion/react"
import { type Ref, useEffect, useRef, useState } from "react"

type Leaving = "cart" | "remove"

interface Piece {
  readonly id: string
  readonly name: string
  readonly photo: string
}

export function SavedForLater(props: { readonly pieces: ReadonlyArray<Piece>; readonly addToCart: (id: string) => Promise<void> }) {
  const [saved, setSaved] = useState(props.pieces)
  const [leaving, setLeaving] = useState<Leaving>("remove")
  const take = (id: string, why: Leaving) => {
    setLeaving(why)
    setSaved((all) => all.filter((piece) => piece.id !== id))
  }

  return (
    <ul className="saved-list">
      <AnimatePresence mode="popLayout" custom={leaving}>
        {saved.map((piece) => (
          <SavedRow
            key={piece.id}
            piece={piece}
            onMove={() => props.addToCart(piece.id).then(() => take(piece.id, "cart"))}
            onRemove={() => take(piece.id, "remove")}
          />
        ))}
      </AnimatePresence>
    </ul>
  )
}

// popLayout hands each child a ref (React 19: a prop), which it passes on to its element.
function SavedRow(props: { readonly piece: Piece; readonly onMove: () => void; readonly onRemove: () => void; readonly ref?: Ref<HTMLLIElement> }) {
  const row = useRef<HTMLLIElement | null>(null)
  const [isPresent, safeToRemove] = usePresence()
  const why = usePresenceData() as Leaving | undefined

  useEffect(() => {
    if (isPresent || row.current === null) return
    leave(row.current, why ?? "remove").then(safeToRemove, safeToRemove)
  }, [isPresent])

  return (
    <motion.li
      ref={(node: HTMLLIElement | null) => {
        row.current = node
        if (typeof props.ref === "function") props.ref(node)
        else if (props.ref) props.ref.current = node
      }}
      className="saved-row"
      layout
    >
      <img src={props.piece.photo} alt={props.piece.name} />
      <span className="name">{props.piece.name}</span>
      <button className="button accent" onClick={props.onMove}>
        Move to cart
      </button>
      <button className="button quiet" onClick={props.onRemove}>
        Remove
      </button>
    </motion.li>
  )
}

/** The same Web Animations as Wardic's version: a fade, and moved to the cart, a flying photo. */
declare function leave(row: HTMLElement, why: Leaving): Promise<unknown>
