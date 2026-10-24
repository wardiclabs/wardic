import { createAsync } from "@solidjs/router"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { wardic } from "@wardic/solid"
import { For, Suspense } from "solid-js"
import { products } from "~/lib/store.ts"

// The grid names a variant; each card under it follows, delayed by its place.
const grid = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}

const card = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 240, damping: 24 } },
} as const

export default function ProductGrid() {
  const all = createAsync(() => products())
  return (
    <Suspense fallback={<p class="muted">Loading the shop…</p>}>
      <wardic.ul class="product-grid" variants={grid} initial="hidden" animate="shown">
        <For each={all()}>
          {(product) => {
            const photo = photoOf(product.id)
            return (
              <wardic.li class="product-card" variants={card}>
                <div class="photo">
                  <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 50vw, 240px" width={photo.width} height={photo.height} alt={product.name} />
                </div>
                <div class="line">
                  <span class="name">{product.name}</span>
                  <span class="price">{formatPrice(product.price)}</span>
                </div>
                <p class="tagline">{product.tagline}</p>
              </wardic.li>
            )
          }}
        </For>
      </wardic.ul>
    </Suspense>
  )
}
