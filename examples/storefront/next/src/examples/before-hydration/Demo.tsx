"use client"
import { type Hydration, hydrationOf } from "@wardic/example-storefront-shared/hydration"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { motion } from "motion/react"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

// The banner names a variant; its photo and lines follow, one after another. The server sends each
// element at its `initial`, and Motion starts the entrance once React has hydrated the page: until
// then the banner is blank, and with no JavaScript it stays that way.
const banner = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
}

const photo = {
  hidden: { opacity: 0, scale: 1.12 },
  shown: { opacity: 1, scale: 1, transition: { duration: 1.6, ease: "easeOut" } },
} as const

const line = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 140, damping: 20 } },
} as const

const vase = photoOf("lagoon-vase")

/** When the JavaScript took over, in ms from the page's start: once, so a replay keeps it. */
let tookOver: number | undefined

/** What the server says is coming, before the JavaScript arrives. */
const waiting = (hydration: Hydration): string => {
  if (hydration.kind === "off") return "No JavaScript on this page: what you see is the server's HTML and CSS alone."
  if (hydration.kind === "late") return `Waiting for the JavaScript, held back ${hydration.ms / 1000} s…`
  return "Waiting for the JavaScript…"
}

/** What the JavaScript is doing: the server says what's coming, the browser when it arrived. */
function HydrationStatus() {
  const search = useSearchParams()
  const [at, setAt] = useState(tookOver)
  useEffect(() => {
    tookOver ??= Math.round(performance.now())
    setAt(tookOver)
  }, [])
  return (
    <p className="hydration-status" role="status">
      {at === undefined ? waiting(hydrationOf(search.get("hydrate"))) : <>The JavaScript took over at {at} ms; the banner started then.</>}
    </p>
  )
}

export default function BeforeHydration() {
  return (
    <>
      <motion.section className="season" variants={banner} initial="hidden" animate="shown">
        <div className="season-photo">
          <motion.img variants={photo} src={vase.large} srcSet={srcsetOf(vase)} sizes="(max-width: 640px) 100vw, 480px" width={vase.width} height={vase.height} alt="The Lagoon Vase" />
        </div>
        <div className="season-copy">
          <motion.p className="eyebrow" variants={line}>
            New this season
          </motion.p>
          <motion.h2 variants={line}>Glazes that ran in the kiln</motion.h2>
          <motion.p variants={line}>Two glazes poured over each other, left to find their own way in the heat. No two came out alike.</motion.p>
          <motion.a className="button accent" href="/entrances/product-grid" variants={line} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            See the pieces
          </motion.a>
        </div>
      </motion.section>
      <div className="hydration">
        <HydrationStatus />
        {/* Full page loads, not the router's: plain links. */}
        <nav className="hydration-links" aria-label="Load this page again">
          <a className="button quiet" href="/server/before-hydration?hydrate=2000">
            Hydrate 2 s late
          </a>
          <a className="button quiet" href="/server/before-hydration?hydrate=off">
            Don&apos;t hydrate
          </a>
          <a className="button quiet" href="/server/before-hydration">
            Hydrate at once
          </a>
        </nav>
      </div>
    </>
  )
}
