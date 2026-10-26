"use client"
/** A gallery card (#365): it lifts under the pointer, its tags rising in turn, and sinks under a press. */
import { CARD } from "@wardic/example-storefront-shared/micro"
import { motion } from "motion/react"
import Link from "next/link"

const MotionLink = motion.create(Link)

export function ExampleCard({ href, title, summary }: { readonly href: string; readonly title: string; readonly summary: string }) {
  return (
    <MotionLink className="example-card" href={href} variants={CARD} initial="rest" animate="rest" whileHover="hover" whileFocus="hover" whileTap="press">
      <h3>{title}</h3>
      <p className="muted">{summary}</p>
    </MotionLink>
  )
}
