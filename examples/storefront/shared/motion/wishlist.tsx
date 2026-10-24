// The wishlist in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. Motion's
// `Reorder.Group` tells each step (`onReorder`), not the end of a drag, so a save goes in each item's
// `onDragEnd`, which keeps where its drag began itself.
import { Reorder } from "motion/react"
import { useRef, useState } from "react"

interface Piece {
  readonly id: string
  readonly name: string
}

export function Wishlist({ saved, move }: { readonly saved: ReadonlyArray<Piece>; readonly move: (id: string, after: string | null) => Promise<void> }) {
  const [items, setItems] = useState(saved)
  const startedAt = useRef(-1)

  return (
    <Reorder.Group axis="y" values={items as Array<Piece>} onReorder={setItems} className="wish-list">
      {items.map((piece, index) => (
        <Reorder.Item
          key={piece.id}
          value={piece}
          className="wish"
          onDragStart={() => {
            startedAt.current = index
          }}
          onDragEnd={() => {
            if (index === startedAt.current) return
            void move(piece.id, index === 0 ? null : items[index - 1]!.id)
          }}
        >
          {piece.name}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  )
}
