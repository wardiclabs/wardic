import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { createSpring, createTransform, wardic } from "@wardic/solid/unstable/v2"
import { createSignal, For } from "solid-js"
import { useReducedMotion } from "~/lib/preferences.tsx"

const SHELF = PRODUCTS.filter((product) => ["poppy-plate", "blossom-jar", "slip-dish"].includes(product.id))

/** How far a card tilts toward the pointer at its edge, in degrees. */
const TILT = 8

// Under the pointer the card's light comes on: a custom property the stylesheet's glow reads.
const card = {
  rest: { "--light": 0 },
  lit: { "--light": 1 },
} as const

export default function Spotlight() {
  return (
    <ul class="spot-grid">
      <For each={SHELF}>{(product) => <SpotCard product={product} />}</For>
    </ul>
  )
}

function SpotCard(props: { readonly product: Product }) {
  const reduced = useReducedMotion()
  // Where the pointer is over the card, from -1 to 1 across and down: 0, 0 at its centre, and when it leaves.
  const [across, setAcross] = createSignal(0)
  const [down, setDown] = createSignal(0)
  const springAcross = createSpring(across, { stiffness: 260, damping: 22 })
  const springDown = createSpring(down, { stiffness: 260, damping: 22 })
  // The card turns toward the pointer; the light sits under it. Under reduced motion, no tilt.
  const tilt = (degrees: number) => (at: number) => {
    if (reduced()) return 0
    return at * degrees
  }
  const rotateY = createTransform(springAcross, tilt(TILT))
  const rotateX = createTransform(springDown, tilt(-TILT))
  const lightX = createTransform(springAcross, [-1, 1], ["0%", "100%"])
  const lightY = createTransform(springDown, [-1, 1], ["0%", "100%"])

  const follow = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const atAcross = ((event.clientX - box.left) / box.width) * 2 - 1
    const atDown = ((event.clientY - box.top) / box.height) * 2 - 1
    setAcross(atAcross)
    setDown(atDown)
    // Under reduced motion the light doesn't glide either: it's where the pointer is.
    if (reduced()) {
      springAcross.jump(atAcross)
      springDown.jump(atDown)
    }
  }
  const leave = () => {
    setAcross(0)
    setDown(0)
  }

  const photo = photoOf(props.product.id)
  return (
    <li>
      <wardic.article
        class="spot-card"
        variants={card}
        initial="rest"
        animate="rest"
        whileHover="lit"
        onPointerMove={follow}
        onPointerLeave={leave}
        style={{ rotateX, rotateY, "--light-x": lightX, "--light-y": lightY }}
      >
        <div class="photo">
          <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 240px" width={photo.width} height={photo.height} alt={props.product.name} />
        </div>
        <div class="line">
          <span class="name">{props.product.name}</span>
          <span class="price">{formatPrice(props.product.price)}</span>
        </div>
      </wardic.article>
    </li>
  )
}
