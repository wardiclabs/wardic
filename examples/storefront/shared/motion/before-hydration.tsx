// The season's banner in Motion (React, `motion/react`), for the page's "Coming from Motion" panel.
// The same variants, but the server sends `initial`: the banner stays at opacity 0 until React has
// hydrated, and for good with JavaScript off.
import { motion } from "motion/react"

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

export function SeasonBanner({ photoUrl }: { readonly photoUrl: string }) {
  return (
    <motion.section className="season" variants={banner} initial="hidden" animate="shown">
      <div className="season-photo">
        <motion.img variants={photo} src={photoUrl} alt="The Lagoon Vase" />
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
  )
}
