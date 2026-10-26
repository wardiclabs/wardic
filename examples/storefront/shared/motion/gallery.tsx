// The photo gallery in Motion (React, `motion/react`), for the page's "Coming from Motion" panel. A
// new `key` makes a new photo: React unmounts the old one, which the presence keeps for its exit.
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

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

interface Photo {
  readonly src: string
  readonly name: string
}

export function Gallery({ photos }: { readonly photos: ReadonlyArray<Photo> }) {
  // Where you are and which way you went, changed together.
  const [[at, direction], setPlace] = useState([0, 1])
  const go = (to: number) => {
    if (to !== at) setPlace([(to + photos.length) % photos.length, Math.sign(to - at)])
  }
  const photo = photos[at]

  return (
    <div className="gallery">
      <div className="gallery-stage">
        <AnimatePresence custom={direction} initial={false}>
          {photo && (
            <motion.img
              key={at}
              className="gallery-photo"
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={glide}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={1}
              onDragEnd={(_event, { offset, velocity }) => {
                const step = stepOf(offset.x, velocity.x)
                if (step !== 0) go(at + step)
              }}
              src={photo.src}
              alt={photo.name}
              draggable={false}
            />
          )}
        </AnimatePresence>
        <button className="icon-button gallery-prev" aria-label="Previous photo" onClick={() => go(at - 1)}>
          ‹
        </button>
        <button className="icon-button gallery-next" aria-label="Next photo" onClick={() => go(at + 1)}>
          ›
        </button>
      </div>
    </div>
  )
}
