"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion } from "motion/react"
import { Suspense, use, useEffect, useState } from "react"

// The detail view's text fades in once the card has grown into it, and out at once when it closes.
const content = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { delay: 0.15 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

export function ProductDetail({ products }: { readonly products: Promise<ReadonlyArray<Product>> }) {
  return (
    <Suspense fallback={<p className="muted">Loading the shop…</p>}>
      <Shop products={products} />
    </Suspense>
  )
}

function Shop(props: { readonly products: Promise<ReadonlyArray<Product>> }) {
  const products = use(props.products)
  const [open, setOpen] = useState<Product | null>(null)
  const close = () => setOpen(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <ul className="product-grid">
        {products.map((product) => (
          <li key={product.id}>
            {/* Each part of the card has a twin in the detail view: the same layoutId. */}
            <motion.button className="product-card" layoutId={`card-${product.id}`} onClick={() => setOpen(product)} aria-label={`Open ${product.name}`}>
              <Photo product={product} />
              <div className="line">
                <motion.span className="name" layoutId={`name-${product.id}`} layout="position">
                  {product.name}
                </motion.span>
                <motion.span className="price" layoutId={`price-${product.id}`} layout="position">
                  {formatPrice(product.price)}
                </motion.span>
              </div>
            </motion.button>
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {open && <motion.div key="backdrop" className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />}
        {open && (
          // A position: fixed frame: the twins meet where each is drawn.
          <div key={open.id} className="detail-frame">
            <motion.article className="detail" layoutId={`card-${open.id}`} role="dialog" aria-modal="true" aria-label={open.name}>
              <Photo product={open} />
              <div className="detail-body">
                <motion.h2 className="name" layoutId={`name-${open.id}`} layout="position">
                  {open.name}
                </motion.h2>
                <motion.p className="price" layoutId={`price-${open.id}`} layout="position">
                  {formatPrice(open.price)}
                </motion.p>
                <motion.div className="detail-text" {...content}>
                  <p>{open.description}</p>
                  <ul className="details">
                    {open.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  <button className="button accent">Add to cart</button>
                </motion.div>
              </div>
              <button className="icon-button close" onClick={close} aria-label="Close">
                ✕
              </button>
            </motion.article>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

function Photo({ product }: { readonly product: Product }) {
  const photo = photoOf(product.id)
  return (
    <motion.div className="photo" layoutId={`photo-${product.id}`}>
      <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 480px" width={photo.width} height={photo.height} alt={product.name} />
    </motion.div>
  )
}
