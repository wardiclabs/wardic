import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { AnimatePresence, wardic } from "@wardic/solid"
import { createSignal, For, Show } from "solid-js"
import { useReducedMotion } from "~/lib/preferences.tsx"

// The photo coming in arrives from the side you're heading to, and the one leaving goes out the
// other side. Both read which way you went: the new photo from its own `custom`, the leaving one
// from the presence's, since a photo that has already left takes no new props.
const slide = {
  enter: (direction: number) => ({ x: direction * 320, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * -320, opacity: 0 }),
}

const glide = {
  x: { type: "spring", stiffness: 300, damping: 32 },
  opacity: { type: "tween", duration: 0.2 },
} as const

const PIECES = ["lagoon-vase", "moon-vase", "bottle-vase", "tulip-bowl", "blossom-jar"].map((id) => {
  const piece = PRODUCTS.find((product) => product.id === id)
  if (piece === undefined) throw new Error(`No product "${id}"`)
  return piece
})

export default function Gallery() {
  const [at, setAt] = createSignal(0)
  // +1 forward, -1 back: set before the photo changes, so both photos read it.
  const [direction, setDirection] = createSignal(1)
  // Under reduced motion the photos cross-fade in place: the slide has no distance. (Left to the
  // rule for positional values, a leaving photo would jump aside at once and fade there.) The
  // system's setting, or the header's switch.
  const reduced = useReducedMotion()
  const way = () => direction() * Number(!reduced())
  const go = (to: number) => {
    if (to === at()) return
    setDirection(Math.sign(to - at()))
    setAt((to + PIECES.length) % PIECES.length)
  }

  return (
    <div class="gallery">
      <div
        class="gallery-stage"
        tabindex="0"
        role="region"
        aria-roledescription="carousel"
        aria-label="Photos: left and right arrow keys move between them"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(at() + 1)
          if (event.key === "ArrowLeft") go(at() - 1)
        }}
      >
        {/* initial={false}: the first photo is there when the page opens; only changes slide. */}
        <AnimatePresence custom={way()} initial={false}>
          <Show when={PIECES[at()]} keyed>
            {(piece) => {
              const photo = photoOf(piece.id)
              return (
                <wardic.img
                  class="gallery-photo"
                  custom={way()}
                  variants={slide}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={glide}
                  src={photo.large}
                  srcset={srcsetOf(photo)}
                  sizes="(max-width: 640px) 100vw, 560px"
                  width={photo.width}
                  height={photo.height}
                  alt={piece.name}
                />
              )
            }}
          </Show>
        </AnimatePresence>
        <button class="icon-button gallery-prev" aria-label="Previous photo" onClick={() => go(at() - 1)}>
          ‹
        </button>
        <button class="icon-button gallery-next" aria-label="Next photo" onClick={() => go(at() + 1)}>
          ›
        </button>
      </div>
      <p class="gallery-caption" aria-live="polite">
        <strong>{PIECES[at()]!.name}</strong> · {at() + 1} of {PIECES.length}
      </p>
      <ol class="thumbs">
        <For each={PIECES}>
          {(piece, index) => {
            const photo = photoOf(piece.id)
            return (
              <li>
                <button class="thumb" aria-label={`Show ${piece.name}`} aria-pressed={String(index() === at()) as "true" | "false"} onClick={() => go(index())}>
                  <img src={photo.small} width={photo.width} height={photo.height} alt="" />
                </button>
              </li>
            )
          }}
        </For>
      </ol>
    </div>
  )
}
