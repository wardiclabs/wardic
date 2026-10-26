"use client"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { type Collection, LOOKBOOK } from "@wardic/example-storefront-shared/stories"
import { motion, useReducedMotionConfig, useScroll, useTransform } from "motion/react"
import { type RefObject, useRef } from "react"

export default function Parallax() {
  const panel = useRef<HTMLDivElement>(null)
  return (
    <div className="lookbook" ref={panel} tabIndex={0} aria-label="The lookbook">
      {LOOKBOOK.map((collection) => (
        <Banner key={collection.title} collection={collection} panel={panel} />
      ))}
    </div>
  )
}

function Banner({ collection, panel }: { readonly collection: Collection; readonly panel: RefObject<HTMLDivElement | null> }) {
  const banner = useRef<HTMLElement>(null)
  // The system's setting, or the header's switch (`MotionConfig`).
  const reduced = useReducedMotionConfig()
  // How far the banner has come through the panel: 0 as its top comes in at the bottom, 1 as its
  // bottom leaves at the top.
  const { scrollYProgress } = useScroll({ container: panel, target: banner, offset: ["start end", "end start"] })
  // The photo moves less than the banner, the words more: depth. Under reduced motion, neither.
  const depth = (travel: number) => (progress: number) => {
    if (reduced) return 0
    return (progress - 0.5) * travel
  }
  const photoY = useTransform(scrollYProgress, depth(90))
  const wordsY = useTransform(scrollYProgress, depth(-70))
  const photo = photoOf(collection.photo)
  return (
    <section className="lookbook-banner" ref={banner}>
      <motion.img className="lookbook-photo" style={{ y: photoY }} src={photo.large} srcSet={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 720px" alt="" />
      <motion.div className="lookbook-words" style={{ y: wordsY }}>
        <h3>{collection.title}</h3>
        <p>{collection.blurb}</p>
      </motion.div>
    </section>
  )
}
