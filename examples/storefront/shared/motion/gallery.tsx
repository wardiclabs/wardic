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
              src={photo.src}
              alt={photo.name}
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
