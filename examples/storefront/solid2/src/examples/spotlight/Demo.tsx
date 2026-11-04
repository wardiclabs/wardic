import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { createSpring, createTransform, w } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal, For, untrack } from "solid-js"
import { useReducedMotion } from "~/lib/preferences.tsx"

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
    <ul class="spot-grid">
      <For each={SHELF}>{(product) => <SpotCard product={product} />}</For>
    </ul>
  )
}

function SpotCard(props: { readonly product: Product }) {
  const reduced = useReducedMotion()
  // Where the pointer is over the card, from -1 to 1 across and down: 0, 0 at its centre.
  const [across, setAcross] = createSignal(0)
  const [down, setDown] = createSignal(0)
  const springAcross = createSpring(across, { stiffness: 260, damping: 22 })
  const springDown = createSpring(down, { stiffness: 260, damping: 22 })
  // The card turns toward the pointer; the light sits under it. Under reduced motion, no tilt: read
  // at each step of the spring, which runs outside Solid's tracking.
  const tilt = (degrees: number) => (at: number) => {
    if (untrack(reduced)) return 0
    return at * degrees
  }
  const rotateY = createTransform(springAcross, tilt(TILT))
  const rotateX = createTransform(springDown, tilt(-TILT))
  const lightX = createTransform(springAcross, [-1, 1], ["0%", "100%"])
  const lightY = createTransform(springDown, [-1, 1], ["0%", "100%"])

  // The card's ward, made here beside the effects that read it, and given to its element (#349). It
  // only listens: the card's own props light it and tilt it (#398).
  const card = w.ward()
  // Its hover, through `when` (#355): the pointer over the card, from where it came in and at each
  // move, with the card it's over (#397), places the light and the tilt; when it leaves, the card
  // eases back flat. Touch never hovers, so a finger moves nothing.
  createEffect(card.when("hover"), ({ point, element }) => {
    // The point in the viewport, as a place on the card: -1 to 1 across and down.
    const box = element.getBoundingClientRect()
    const atAcross = ((point.x - box.left) / box.width) * 2 - 1
    const atDown = ((point.y - box.top) / box.height) * 2 - 1
    setAcross(atAcross)
    setDown(atDown)
    // Under reduced motion the light doesn't glide either: it's where the pointer is. Read as the
    // pointer moves, not followed: an effect's callback doesn't track.
    if (untrack(reduced)) {
      springAcross.jump(atAcross)
      springDown.jump(atDown)
    }
  })
  createEffect(card.when("hoverEnd"), () => {
    setAcross(0)
    setDown(0)
  })

  const photo = photoOf(props.product.id)
  return (
    <li>
      <w.article
        class="spot-card"
        wardRef={card}
        variants={lighting}
        initial="rest"
        animate="rest"
        whileHover="lit"
        style={{ rotateX, rotateY, "--light-x": lightX, "--light-y": lightY }}
      >
        <div class="photo">
          <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 240px" width={photo.width} height={photo.height} alt={props.product.name} />
        </div>
        <div class="line">
          <span class="name">{props.product.name}</span>
          <span class="price">{formatPrice(props.product.price)}</span>
        </div>
      </w.article>
    </li>
  )
}
