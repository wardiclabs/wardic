"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react"
import { useState } from "react"

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

// A swipe, as Motion's slideshow judges one: the release's distance times its speed, across. A
// throw to the left goes forward, to the right back; anything softer springs back to the centre.
const SWIPE = 10_000
const swipeOf = (offset: number, velocity: number) => Math.abs(offset) * velocity
const stepOf = (offset: number, velocity: number) => {
  const swipe = swipeOf(offset, velocity)
  if (swipe < -SWIPE) return 1
  if (swipe > SWIPE) return -1
  return 0
}

const PIECES = ["lagoon-vase", "moon-vase", "bottle-vase", "tulip-bowl", "blossom-jar"].map((id) => {
  const piece = PRODUCTS.find((product) => product.id === id)
  if (piece === undefined) throw new Error(`No product "${id}"`)
  return piece
})

export default function Gallery() {
  // Where you are and which way you went (+1 forward, -1 back), changed together, so both photos
  // read it.
  const [[at, direction], setPlace] = useState([0, 1])
  // Under reduced motion the photos cross-fade in place: the slide has no distance. (Left to
  // `MotionConfig`, a leaving photo would jump aside at once and fade there.) The system's setting,
  // or the header's switch.
  const reduced = useReducedMotionConfig()
  const way = direction * Number(!reduced)
  const go = (to: number) => {
    if (to !== at) setPlace([(to + PIECES.length) % PIECES.length, Math.sign(to - at)])
  }
  const piece = PIECES[at]!
  const photo = photoOf(piece.id)

  return (
    <div className="gallery">
      <div
        className="gallery-stage"
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Photos: left and right arrow keys move between them"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(at + 1)
          if (event.key === "ArrowLeft") go(at - 1)
        }}
      >
        {/* initial={false}: the first photo is there when the page opens; only changes slide. A new
            `key` makes a new photo: React unmounts the old one, which the presence keeps for its exit. */}
        <AnimatePresence custom={way} initial={false}>
          <motion.img
            key={at}
            className="gallery-photo"
            custom={way}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={glide}
            // The drag: across, held at the centre, followed all the way. At each release, a swipe
            // steps, its photo going on out the way it was thrown.
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            onDragEnd={(_event, { offset, velocity }) => {
              const step = stepOf(offset.x, velocity.x)
              if (step !== 0) go(at + step)
            }}
            src={photo.large}
            srcSet={srcsetOf(photo)}
            sizes="(max-width: 640px) 100vw, 560px"
            width={photo.width}
            height={photo.height}
            alt={piece.name}
            draggable={false}
          />
        </AnimatePresence>
        <button className="icon-button gallery-prev" aria-label="Previous photo" onClick={() => go(at - 1)}>
          ‹
        </button>
        <button className="icon-button gallery-next" aria-label="Next photo" onClick={() => go(at + 1)}>
          ›
        </button>
      </div>
      <p className="gallery-caption" aria-live="polite">
        <strong>{piece.name}</strong> · {at + 1} of {PIECES.length}
      </p>
      <ol className="thumbs">
        {PIECES.map((one, index) => (
          <li key={one.id}>
            <button className="thumb" aria-label={`Show ${one.name}`} aria-pressed={index === at} onClick={() => go(index)}>
              <img src={photoOf(one.id).small} width={photoOf(one.id).width} height={photoOf(one.id).height} alt="" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
