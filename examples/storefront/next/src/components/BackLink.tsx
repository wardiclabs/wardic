"use client"
/** The crumbs' link home: its hover's name passes to its arrow, which nudges toward where it goes (#365). */
import { BACK } from "@wardic/example-storefront-shared/micro"
import { m } from "motion/react"
import Link from "next/link"

const MotionLink = m.create(Link)

export function BackLink() {
  return (
    <MotionLink href="/" initial="rest" animate="rest" whileHover="hover" whileFocus="hover">
      <m.span className="glyph" variants={BACK}>
        ←
      </m.span>{" "}
      Examples
    </MotionLink>
  )
}
