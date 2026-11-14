import { createWardic, domAnimation, drag } from "@wardic/solid"

// This page drags: its own Wardic instance brings `drag`, so pages that don't never load it.
const { w } = createWardic([domAnimation, drag])

/** A ball held inside its arena, and one that drags across and springs back. */
export default function Drag() {
  let arena!: HTMLDivElement
  return (
    <div class="sample-arena" ref={arena}>
      <w.div class="sample-ball" drag dragConstraints={() => arena} dragElastic={0.2} whileDrag={{ scale: 1.15 }} />
      <w.div class="sample-ball sample-ball-alt" drag="x" dragSnapToOrigin whileDrag={{ scale: 1.15 }} />
    </div>
  )
}
