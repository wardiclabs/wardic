import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { wardic } from "@wardic/solid/unstable/v2"
import { createMemo, For, Loading } from "solid-js"
import { products } from "~/lib/store.ts"

// The grid names a variant; each card under it follows, delayed by its place.
const grid = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}

const card = {
  hidden: { opacity: 0, y: 24 },
  shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 240, damping: 24 } },
  // Under the pointer the card lifts, and the name passes to its photo, which eases in.
  hover: { y: -4, transition: { type: "spring", stiffness: 400, damping: 28 } },
} as const

const photo = {
  shown: { scale: 1 },
  hover: { scale: 1.05 },
} as const

export default function ProductGrid() {
  // An async memo: the grid waits for the products under <Loading>, then reveals them.
  const all = createMemo(() => products())
  return (
    <Loading fallback={<p class="muted">Loading the shop…</p>}>
      <wardic.ul class="product-grid" variants={grid} initial="hidden" animate="shown">
        <For each={all()}>
          {(product) => {
            const image = photoOf(product.id)
            return (
              <wardic.li class="product-card" variants={card} whileHover="hover">
                <div class="photo">
                  <wardic.img variants={photo} src={image.small} srcset={srcsetOf(image)} sizes="(max-width: 640px) 50vw, 240px" width={image.width} height={image.height} alt={product.name} />
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
    </Loading>
  )
}
