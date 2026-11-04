"use client"
import { photoOf } from "@wardic/example-storefront-shared/images"
import { STUDIO_CHAPTERS } from "@wardic/example-storefront-shared/stories"
import { m } from "motion/react"
import { useRef } from "react"

// Each chapter names a variant as it comes into view; its photo and words follow, one after another.
const chapter = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.1 } },
}

const part = {
  hidden: { opacity: 0, y: 28 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 160, damping: 22 } },
} as const

export default function Reveals() {
  const panel = useRef<HTMLDivElement>(null)
  return (
    <div className="story" ref={panel} tabIndex={0} aria-label="The studio's story">
      {STUDIO_CHAPTERS.map((story) => {
        const photo = photoOf(story.photo)
        return (
          // In view once a third of it shows in the panel; once, so scrolling back up doesn't hide it.
          <m.section key={story.title} className="chapter" variants={chapter} initial="hidden" whileInView="shown" viewport={{ root: panel, once: true, amount: 0.35 }}>
            <m.img variants={part} src={photo.small} width={photo.width} height={photo.height} alt="" />
            <div>
              <m.h3 variants={part}>{story.title}</m.h3>
              <m.p variants={part}>{story.text}</m.p>
            </div>
          </m.section>
        )
      })}
    </div>
  )
}
