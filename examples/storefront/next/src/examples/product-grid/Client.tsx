"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { motion } from "motion/react"
import { Suspense, use, useState } from "react"

// The grid names a variant; each card under it follows, delayed by its place.
const grid = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}

const card = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 240, damping: 24 } },
} as const

// Under the pointer the card lifts, and its photo eases in. A target, not a variant name: a name in
// `whileHover` would make the card a variant controller of its own, and it would no longer follow
// the grid's `initial` and `animate`, so it would neither enter nor stagger. The photo hears the
// hover through state instead.
const lift = { y: -4, transition: { type: "spring", stiffness: 400, damping: 28 } } as const

export function ProductGrid({ products }: { readonly products: Promise<ReadonlyArray<Product>> }) {
  // The grid waits for the products under <Suspense>, then reveals them.
  return (
    <Suspense fallback={<p className="muted">Loading the shop…</p>}>
      <Grid products={products} />
    </Suspense>
  )
}

function Grid(props: { readonly products: Promise<ReadonlyArray<Product>> }) {
  return (
    <motion.ul className="product-grid" variants={grid} initial="hidden" animate="shown">
      {use(props.products).map((product) => (
        <Card key={product.id} product={product} />
      ))}
    </motion.ul>
  )
}

function Card({ product }: { readonly product: Product }) {
  const [hovered, setHovered] = useState(false)
  const image = photoOf(product.id)
  return (
    <motion.li className="product-card" variants={card} whileHover={lift} onHoverStart={() => setHovered(true)} onHoverEnd={() => setHovered(false)}>
      <div className="photo">
        <motion.img
          animate={{ scale: hovered ? 1.05 : 1 }}
          src={image.small}
          srcSet={srcsetOf(image)}
          sizes="(max-width: 640px) 50vw, 240px"
          width={image.width}
          height={image.height}
          alt={product.name}
        />
      </div>
      <div className="line">
        <span className="name">{product.name}</span>
        <span className="price">{formatPrice(product.price)}</span>
      </div>
      <p className="tagline">{product.tagline}</p>
    </motion.li>
  )
}
