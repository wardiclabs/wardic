import { useAction } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, usePresence, wardic } from "@wardic/solid"
import { createSignal, For, Show } from "solid-js"
import { usePreferences } from "~/lib/preferences.tsx"
import { addToCart } from "~/lib/store.ts"

/** Why a row leaves: moved to the cart, its photo flies there; removed, it fades. */
type Leaving = "cart" | "remove"

const SAVED = PRODUCTS.filter((product) => ["bottle-vase", "tulip-bowl", "painted-jug", "cut-carafe"].includes(product.id))

export default function SavedForLater() {
  const add = useAction(addToCart)
  const [saved, setSaved] = createSignal<ReadonlyArray<Product>>(SAVED)
  // Each row reads it as it leaves, through the presence's `custom`.
  const [leaving, setLeaving] = createSignal<Leaving>("remove")
  const [failure, setFailure] = createSignal<string>()

  const take = (piece: Product, why: Leaving) => {
    setLeaving(why)
    setSaved(saved().filter((one) => one.id !== piece.id))
  }
  const moveToCart = async (piece: Product) => {
    setFailure(undefined)
    try {
      await add(piece.id, 1)
      take(piece, "cart")
    } catch (error) {
      setFailure(`${piece.name} wasn't moved: ${messageOf(error)}`)
    }
  }

  return (
    <div class="saved">
      <ul class="saved-list">
        {/* popLayout: a leaving row steps out of the list at once, and the rows below close the gap while it goes. */}
        <AnimatePresence mode="popLayout" custom={leaving()}>
          <For each={saved()}>{(piece) => <SavedRow piece={piece} onMove={() => void moveToCart(piece)} onRemove={() => take(piece, "remove")} />}</For>
        </AnimatePresence>
      </ul>
      <Show when={saved().length === 0}>
        <p class="saved-empty muted">
          Nothing saved for later.{" "}
          <button class="button quiet" onClick={() => setSaved(SAVED)}>
            Save them again
          </button>
        </p>
      </Show>
      <Show when={failure()}>
        {(message) => (
          <p class="error-line" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}

function SavedRow(props: { readonly piece: Product; readonly onMove: () => void; readonly onRemove: () => void }) {
  const preferences = usePreferences()
  let row!: HTMLLIElement
  // The row's exit is its own: once it has left, the presence keeps it on the page until
  // `safeToRemove`. By then the row's own code has gone, so its way out is plain Web Animations.
  usePresence(
    () => row,
    (safeToRemove, why: Leaving) => {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || preferences.reduceMotion()
      leave(row, why, reduced).then(safeToRemove, safeToRemove)
    },
  )
  const photo = photoOf(props.piece.id)
  return (
    <wardic.li ref={row} class="saved-row" layout>
      <div class="photo">
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="72px" width={photo.width} height={photo.height} alt={props.piece.name} />
      </div>
      <div class="saved-text">
        <span class="name">{props.piece.name}</span>
        <span class="price">{formatPrice(props.piece.price)}</span>
      </div>
      <div class="saved-actions">
        <wardic.button class="button accent" whileTap={{ scale: 0.96 }} onClick={() => props.onMove()}>
          Move to cart
        </wardic.button>
        <button class="button quiet" onClick={() => props.onRemove()}>
          Remove
        </button>
      </div>
    </wardic.li>
  )
}

/** A row's way out: it fades, and moved to the cart, a copy of its photo flies there. Reduced, it only fades. */
function leave(row: HTMLElement, why: Leaving, reduced: boolean): Promise<unknown> {
  const fade = row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" }).finished
  const photo = row.querySelector("img")
  const cart = document.querySelector(".cart-button")
  if (why === "remove" || reduced || photo === null || cart === null) return fade
  return Promise.all([fade, flyTo(photo, cart)])
}

/** A copy of the photo, in an arc from where it is to the cart, shrinking as it goes. */
function flyTo(photo: HTMLImageElement, cart: Element): Promise<void> {
  const from = photo.getBoundingClientRect()
  const to = cart.getBoundingClientRect()
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const copy = photo.cloneNode() as HTMLImageElement
  copy.className = "flying-photo"
  copy.alt = ""
  Object.assign(copy.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
  document.body.append(copy)
  const flight = copy.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 48}px) scale(0.85)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0.4 },
    ],
    { duration: 700, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
  )
  return flight.finished.then(
    () => copy.remove(),
    () => copy.remove(),
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
