import { photoOf } from "@wardic/example-storefront-shared/images"
import { createSpring, createTransform, ward, type WardPointInfo, wardic } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal } from "solid-js"
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

  // The photo's ward, made here beside the effects that hear it, and given to the photo (#349). It
  // only listens: the photo's own props say when the lens shows (#398).
  const look = ward()
  // The lens, put over a point in the viewport, on the photo it's over (#397: no `ref`).
  const follow = ({ point, element }: WardPointInfo) => {
    const box = element.getBoundingClientRect()
    const atX = point.x - box.left
    const atY = point.y - box.top
    setWidth(box.width)
    setPointerX(atX)
    setPointerY(atY)
    // Under reduced motion the lens doesn't glide: it's where the pointer is.
    if (reduced()) {
      x.jump(atX)
      y.jump(atY)
    }
  }
  // A mouse over the photo, through `when` (#355): from where it came in, and at each move (#397).
  createEffect(look.when("hover"), follow)
  // A finger, which never hovers: where it pressed, then each move of its pan. The photo's
  // `touch-action: none` keeps the page from scrolling under it.
  createEffect(look.when("pressStart"), follow)
  createEffect(look.when("pan"), follow)

  return (
    <div class="magnifier">
      <wardic.div class="magnifier-photo" wardRef={look} variants={frame} initial="rest" animate="rest" whileHover="looking" whileTap="looking">
        <img src={photo.large} width={photo.width} height={photo.height} alt="The Lagoon Vase, up close" draggable={false} />
        <wardic.div
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
      </wardic.div>
      <p class="muted">Hover over the vase to look closer, or press and drag on a phone.</p>
    </div>
  )
}
