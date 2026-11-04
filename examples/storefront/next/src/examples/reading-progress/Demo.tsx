"use client"
import { LAGOON_ARTICLE } from "@wardic/example-storefront-shared/stories"
import { m, useScroll, useTransform } from "motion/react"
import { useRef } from "react"

export default function ReadingProgress() {
  const panel = useRef<HTMLDivElement>(null)
  // How far the article's panel is scrolled, from 0 to 1. Without `container`, it's the page's.
  const { scrollYProgress } = useScroll({ container: panel })
  // The minutes left, read from the same progress: a motion value rendered as text, so React
  // doesn't render again as it changes.
  const minutesLeft = useTransform(scrollYProgress, [0, 1], [LAGOON_ARTICLE.minutes, 0])
  const label = useTransform(minutesLeft, (minutes) => `${Math.ceil(minutes)} min left`)

  return (
    <div className="reading">
      <div className="reading-head">
        <strong>{LAGOON_ARTICLE.title}</strong>
        <m.span className="muted" aria-live="polite">
          {label}
        </m.span>
      </div>
      {/* The bar is the scroll itself, scaled across from its left edge: no animation of its own. */}
      <m.div className="reading-bar" style={{ scaleX: scrollYProgress }} />
      <div className="reading-panel" ref={panel} tabIndex={0} aria-label={LAGOON_ARTICLE.title}>
        {LAGOON_ARTICLE.sections.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
