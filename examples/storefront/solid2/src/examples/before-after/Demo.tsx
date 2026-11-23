import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { createAnimate, createDrag, createTransform } from "@wardic/solid"
import { createEffect, createMemo, createSignal, For, onSettled } from "solid-js"
import { w } from "~/lib/wardic-drag.ts"

/** The pieces to compare, before and after their glaze. */
const PIECES = ["celadon-bowl", "moon-vase", "painted-jug"].map((id) => PRODUCTS.find((product) => product.id === id)!)

/** A piece before its glaze and after the kiln: drag the handle, or move it with the arrow keys. */
export default function BeforeAfter() {
  let frame!: HTMLDivElement
  let knob!: HTMLDivElement
  const [piece, setPiece] = createSignal(PIECES[0]!)
  const [width, setWidth] = createSignal(480)
  onSettled(() => {
    const observer = new ResizeObserver(() => setWidth(frame.clientWidth))
    observer.observe(frame)
    return () => observer.disconnect()
  })

  // The handle drags across the photo, and stays where it's let go.
  const handle = w.ward({ drag: "x", dragConstraints: () => frame, dragElastic: 0, dragMomentum: false })
  // Where Wardic draws the handle, as it moves: the photo splits there, through a custom property.
  const x = handle.read("x")
  const split = createTransform(x, (offset: number) => `calc(50% + ${offset}px)`)
  // The handle's own drag, as state: the labels show while it's held.
  const drag = createDrag(handle)
  const held = () => {
    const sample = drag()
    return sample !== null && sample.phase !== "end"
  }

  // The keyboard moves the handle a tenth of the photo, Home and End to either side. Each press steps
  // on from where the last one was sending it, until it gets there; a drag takes over from them.
  const [, animate] = createAnimate()
  const percent = createMemo(() => Math.round(50 + (x() / width()) * 100))
  let aimed: number | undefined
  createEffect(drag, (sample) => {
    if (sample?.phase === "start") aimed = undefined
  })
  const onKeyDown = (event: KeyboardEvent) => {
    const room = width() / 2 - knob.offsetWidth / 2
    const from = aimed ?? x()
    const steps: Record<string, number> = { ArrowRight: from + width() / 10, ArrowLeft: from - width() / 10, Home: -room, End: room }
    const to = steps[event.key]
    if (to === undefined) return
    event.preventDefault()
    const target = Math.max(-room, Math.min(room, to))
    aimed = target
    void animate(knob, { x: target }, { type: "spring", bounce: 0, visualDuration: 0.25 }).then(() => {
      if (aimed === target) aimed = undefined
    })
  }

  return (
    <div class="compare-demo">
      <div class="chips" role="group" aria-label="Piece">
        <For each={PIECES}>
          {(one) => (
            <button class="chip" aria-pressed={piece() === one ? "true" : "false"} onClick={() => setPiece(one)}>
              {one.name}
            </button>
          )}
        </For>
      </div>
      <w.div class="compare" ref={frame} style={{ "--split": split }}>
        <img class="compare-after" src={photoOf(piece().id).large} srcset={srcsetOf(photoOf(piece().id))} sizes="(max-width: 640px) 100vw, 520px" alt={`${piece().name}, glazed`} />
        <img class="compare-before" src={photoOf(piece().id).large} srcset={srcsetOf(photoOf(piece().id))} sizes="(max-width: 640px) 100vw, 520px" alt="" />
        <w.span class="compare-label before" animate={{ opacity: held() ? 1 : 0, y: held() ? 0 : -6 }}>
          Before the glaze
        </w.span>
        <w.span class="compare-label after" animate={{ opacity: held() ? 1 : 0, y: held() ? 0 : -6 }}>
          After the kiln
        </w.span>
        <w.div
          class="compare-handle"
          wardRef={handle}
          ref={knob}
          whileDrag={{ scale: 1.1 }}
          role="slider"
          tabindex="0"
          aria-label="Before the glaze, and after the kiln"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent()}
          aria-valuetext={`${percent()}% before the glaze`}
          onKeyDown={onKeyDown}
        >
          <span class="compare-knob" aria-hidden="true">
            ◂ ▸
          </span>
        </w.div>
      </w.div>
    </div>
  )
}
