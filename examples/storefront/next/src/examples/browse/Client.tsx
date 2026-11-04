"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { CATEGORIES, type Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, m } from "motion/react"
import { Suspense, use, useState } from "react"

const FILTERS = ["All", ...CATEGORIES] as const
type Filter = (typeof FILTERS)[number]
type View = "grid" | "list"

// A product a filter brings in grows into place; one it takes out shrinks and fades where it was,
// out of the flow (popLayout), while the ones after it slide into its space.
const item = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
} as const

export function Browse({ products }: { readonly products: Promise<ReadonlyArray<Product>> }) {
  const [filter, setFilter] = useState<Filter>("All")
  const [view, setView] = useState<View>("grid")

  return (
    <div className="shop">
      <div className="shop-toolbar">
        <div className="chips" role="group" aria-label="Category">
          {FILTERS.map((name) => (
            <button key={name} className="chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>
              {name}
            </button>
          ))}
        </div>
        {/* Switching the view changes every card's size: React renders each again, and Motion
            animates it from where it was. */}
        <div className="segmented" role="group" aria-label="View">
          <button aria-pressed={view === "grid"} onClick={() => setView("grid")}>
            Grid
          </button>
          <button aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
        </div>
      </div>
      <Suspense fallback={<p className="muted">Loading the shop…</p>}>
        <Items products={products} filter={filter} view={view} />
      </Suspense>
    </div>
  )
}

function Items({ filter, view, ...props }: { readonly products: Promise<ReadonlyArray<Product>>; readonly filter: Filter; readonly view: View }) {
  const shown = use(props.products).filter((product) => filter === "All" || product.category === filter)
  return (
    <ul className="shop-items" data-view={view}>
      {/* initial={false}: the products already there when the page opens don't grow in. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {shown.map((product) => (
          <Item key={product.id} product={product} />
        ))}
      </AnimatePresence>
    </ul>
  )
}

function Item({ product }: { readonly product: Product }) {
  const photo = photoOf(product.id)
  return (
    <m.li className="shop-item" layout {...item}>
      {/* The photo changes size between the views: plain layout, its corners kept round as it scales. */}
      <m.div className="photo" layout>
        <img src={photo.small} srcSet={srcsetOf(photo)} sizes="(max-width: 640px) 50vw, 240px" width={photo.width} height={photo.height} alt={product.name} />
      </m.div>
      {/* Text only travels: layout="position" moves it to its new place without stretching it. */}
      <m.span className="name" layout="position">
        {product.name}
      </m.span>
      <m.span className="price" layout="position">
        {formatPrice(product.price)}
      </m.span>
      <m.span className="tagline" layout="position">
        {product.tagline}
      </m.span>
    </m.li>
  )
}
