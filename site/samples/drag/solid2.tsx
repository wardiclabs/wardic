import { drag, LazyWardic, w } from "@wardic/solid/unstable/v2"

/** A ball held inside its arena, and one that drags across and springs back. */
export default function Drag() {
  let arena!: HTMLDivElement
  return (
    // This page drags, so it brings `drag` itself: pages that don't never load it.
    <LazyWardic features={[drag]}>
      <div class="sample-arena" ref={arena}>
        <w.div class="sample-ball" drag dragConstraints={() => arena} dragElastic={0.2} whileDrag={{ scale: 1.15 }} />
        <w.div class="sample-ball sample-ball-alt" drag="x" dragSnapToOrigin whileDrag={{ scale: 1.15 }} />
      </div>
    </LazyWardic>
  )
}
