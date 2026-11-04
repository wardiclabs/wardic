"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { m, type MotionStyle, useMotionValue, useReducedMotionConfig, useSpring, useTransform } from "motion/react"
import type { PointerEvent } from "react"

const SHELF = PRODUCTS.filter((product) => ["poppy-plate", "blossom-jar", "slip-dish"].includes(product.id))

/** How far a card tilts toward the pointer at its edge, in degrees. */
const TILT = 8

// Under the pointer the card's light comes on: a custom property the stylesheet's glow reads.
const lighting = {
  rest: { "--light": 0 },
  lit: { "--light": 1 },
} as const

export default function Spotlight() {
  return (
    <ul className="spot-grid">
      {SHELF.map((product) => (
        <SpotCard key={product.id} product={product} />
      ))}
    </ul>
  )
}

function SpotCard({ product }: { readonly product: Product }) {
  // The system's setting, or the header's switch (`MotionConfig`).
  const reduced = useReducedMotionConfig()
  // Where the pointer is over the card, from -1 to 1 across and down: 0, 0 at its centre.
  const across = useMotionValue(0)
  const down = useMotionValue(0)
  const springAcross = useSpring(across, { stiffness: 260, damping: 22 })
  const springDown = useSpring(down, { stiffness: 260, damping: 22 })
  // The card turns toward the pointer; the light sits under it. Under reduced motion, no tilt.
  const tilt = (degrees: number) => (at: number) => {
    if (reduced) return 0
    return at * degrees
  }
  const rotateY = useTransform(springAcross, tilt(TILT))
  const rotateX = useTransform(springDown, tilt(-TILT))
  const lightX = useTransform(springAcross, [-1, 1], ["0%", "100%"])
  const lightY = useTransform(springDown, [-1, 1], ["0%", "100%"])

  // The pointer over the card places the light and the tilt; when it leaves, the card eases back
  // flat. A finger's pointer moves too, but touch never hovers: it moves nothing.
  const place = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return
    const box = event.currentTarget.getBoundingClientRect()
    const atAcross = ((event.clientX - box.left) / box.width) * 2 - 1
    const atDown = ((event.clientY - box.top) / box.height) * 2 - 1
    across.set(atAcross)
    down.set(atDown)
    // Under reduced motion the light doesn't glide either: it's where the pointer is.
    if (reduced) {
      springAcross.jump(atAcross)
      springDown.jump(atDown)
    }
  }
  const reset = () => {
    across.set(0)
    down.set(0)
  }

  const photo = photoOf(product.id)
  return (
    <li>
      <m.article
        className="spot-card"
        variants={lighting}
        initial="rest"
        animate="rest"
        whileHover="lit"
        onPointerMove={place}
        onHoverEnd={reset}
        // Motion sets a custom property from a motion value, but its style type doesn't name them.
        style={{ rotateX, rotateY, "--light-x": lightX, "--light-y": lightY } as MotionStyle}
      >
        <div className="photo">
          <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 240px" width={photo.width} height={photo.height} alt={product.name} />
        </div>
        <div className="line">
          <span className="name">{product.name}</span>
          <span className="price">{formatPrice(product.price)}</span>
        </div>
      </m.article>
    </li>
  )
}
