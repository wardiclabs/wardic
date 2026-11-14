import { photoOf } from "@wardic/example-storefront-shared/images"
import { createSpring, createTransform } from "@wardic/solid"
import { w } from "~/lib/wardic.ts"
import { createSignal } from "solid-js"
import { useReducedMotion } from "~/lib/preferences.tsx"

const ZOOM = 2.5
const LENS = 160

// Hover or press names a variant on the photo; the lens, a Variant child, grows in under it.
const frame = { rest: {}, looking: {} }
const lens = {
  rest: { opacity: 0, scale: 0.6 },
  looking: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 400, damping: 28 } },
} as const

export default function Magnifier() {
  const photo = photoOf("lagoon-vase")
  const reduced = useReducedMotion()
  // Where the pointer is over the photo, from its corner, and how wide the photo is drawn.
  const [pointerX, setPointerX] = createSignal(LENS)
  const [pointerY, setPointerY] = createSignal(LENS)
  const [width, setWidth] = createSignal(0)
  // The lens follows the pointer on a spring: it glides after it, and settles where it stops.
  const x = createSpring(pointerX, { stiffness: 380, damping: 32 })
  const y = createSpring(pointerY, { stiffness: 380, damping: 32 })
  // The photo inside the lens, placed so its centre shows what's under the lens, ZOOM times larger:
  // a custom property each, which the stylesheet's `background-position` reads.
  const insideX = createTransform(x, (at: number) => `${LENS / 2 - at * ZOOM}px`)
  const insideY = createTransform(y, (at: number) => `${LENS / 2 - at * ZOOM}px`)

  const follow = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const atX = event.clientX - box.left
    const atY = event.clientY - box.top
    setWidth(box.width)
    setPointerX(atX)
    setPointerY(atY)
    // Under reduced motion the lens doesn't glide: it's where the pointer is.
    if (reduced()) {
      x.jump(atX)
      y.jump(atY)
    }
  }

  return (
    <div class="magnifier">
      <w.div class="magnifier-photo" variants={frame} initial="rest" animate="rest" whileHover="looking" whileTap="looking" onPointerMove={follow} onPointerDown={follow}>
        <img src={photo.large} width={photo.width} height={photo.height} alt="The Lagoon Vase, up close" draggable={false} />
        <w.div
          class="lens"
          aria-hidden="true"
          variants={lens}
          style={{
            x,
            y,
            "--inside-x": insideX,
            "--inside-y": insideY,
            "--inside-size": `${width() * ZOOM}px`,
            "background-image": `url(${photo.large})`,
          }}
        />
      </w.div>
      <p class="muted">Hover over the vase to look closer, or press and drag on a phone.</p>
    </div>
  )
}
