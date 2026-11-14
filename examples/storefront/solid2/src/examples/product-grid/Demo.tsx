import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { w } from "~/lib/wardic.ts"
import { createEffect, createMemo, createSignal, For, Loading } from "solid-js"
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

// Under the pointer the card lifts, and its photo eases in. A target, not a variant name: a name in
// `whileHover` would make the card a variant controller of its own, as in Motion, and it would no
// longer follow the grid's `initial` and `animate`, so it would neither enter nor stagger. The photo
// hears the hover as state instead.
const lift = { y: -4, transition: { type: "spring", stiffness: 400, damping: 28 } } as const

/** The photo's scale, by whether its card is under the pointer. */
const ZOOM: Record<"true" | "false", { readonly scale: number }> = { true: { scale: 1.05 }, false: { scale: 1 } }

function Card(props: { readonly product: Product }) {
  const image = photoOf(props.product.id)
  // The card's ward only listens: its hover's start and end are the photo's state.
  const ward = w.ward()
  const [hovered, setHovered] = createSignal(false)
  createEffect(ward.when("hoverStart"), () => {
    setHovered(true)
  })
  createEffect(ward.when("hoverEnd"), () => {
    setHovered(false)
  })
  return (
    <w.li class="product-card" wardRef={ward} variants={card} whileHover={lift}>
      <div class="photo">
        <w.img animate={ZOOM[String(hovered()) as "true" | "false"]} src={image.small} srcset={srcsetOf(image)} sizes="(max-width: 640px) 50vw, 240px" width={image.width} height={image.height} alt={props.product.name} />
      </div>
      <div class="line">
        <span class="name">{props.product.name}</span>
        <span class="price">{formatPrice(props.product.price)}</span>
      </div>
      <p class="tagline">{props.product.tagline}</p>
    </w.li>
  )
}

export default function ProductGrid() {
  // An async memo: the grid waits for the products under <Loading>, then reveals them.
  const all = createMemo(() => products())
  return (
    <Loading fallback={<p class="muted">Loading the shop…</p>}>
      <w.ul class="product-grid" variants={grid} initial="hidden" animate="shown">
        <For each={all()}>{(product) => <Card product={product} />}</For>
      </w.ul>
    </Loading>
  )
}
