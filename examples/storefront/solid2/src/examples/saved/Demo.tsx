import { revalidate } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, wardic } from "@wardic/solid/unstable/v2"
import { action, createOptimisticStore, createSignal, flush, For, Show } from "solid-js"
import { arrivalId, arrive, recall } from "~/lib/arrivals.ts"
import { useReducedMotion } from "~/lib/preferences.tsx"
import { cart } from "~/lib/store.ts"
import { addToCart } from "~/server/store.ts"

const SAVED = PRODUCTS.filter((product) => ["bottle-vase", "tulip-bowl", "painted-jug", "cut-carafe"].includes(product.id))

export default function SavedForLater() {
  // The pieces still saved: what the list settles on once a move has landed.
  const [kept, setKept] = createSignal<ReadonlyArray<Product>>(SAVED)
  // What it shows: those, less any on their way to the cart. A move takes its row out at once, an
  // optimistic write; if the store refuses it, Solid drops the write as the action settles, and the
  // row comes back. Quick moves don't trip over each other.
  const [saved, setSaved] = createOptimisticStore<Array<Product>>(() => [...kept()], [])
  const [failure, setFailure] = createSignal<string>()
  // The system's setting, or the header's switch.
  const reduced = useReducedMotion()

  const without = (piece: Product) => (list: ReadonlyArray<Product>) => list.filter((one) => one.id !== piece.id)
  const moveToCart = action(function* (piece: Product) {
    setSaved(without(piece))
    yield addToCart(piece.id, 1)
    setKept(without(piece))
    // The cart has changed: the header's count reads it again.
    revalidate(cart.key)
  })
  // A click: the move takes its row out, then its photo's twin appears in the cart button, and Wardic
  // flies the photo there from the row it left (under reduced motion, nothing flies). The row's leave is
  // flushed first: the twin's write, in a batch of its own, doesn't wait with the action for the store.
  // A piece already on its way, its leaving row clicked again, is left alone.
  const move = (piece: Product) => {
    if (!saved.some((one) => one.id === piece.id)) return
    setFailure(undefined)
    flush(() => {
      moveToCart(piece).catch((error: unknown) => {
        // Refused: its row is back, and its twin leaves the cart button, its photo flying back.
        recall(piece.id)
        setFailure(`${piece.name} wasn't moved: ${messageOf(error)}`)
      })
    })
    if (!reduced()) arrive({ id: piece.id, src: photoOf(piece.id).small })
  }

  return (
    <div class="saved">
      <ul class="saved-list">
        {/* popLayout: a leaving row steps out of the list at once, and the rows below close the gap while it goes. */}
        <AnimatePresence mode="popLayout">
          <For each={saved}>{(piece) => <SavedRow piece={piece} onMove={() => move(piece)} onRemove={() => setKept(without(piece))} />}</For>
        </AnimatePresence>
      </ul>
      <Show when={saved.length === 0}>
        <p class="saved-empty muted">
          Nothing saved for later.{" "}
          <button class="button quiet" onClick={() => setKept(SAVED)}>
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
  const photo = photoOf(props.piece.id)
  return (
    // It fades as it leaves, either way. Moved to the cart, its photo's twin there flies from its own.
    <wardic.li class="saved-row" layout exit={{ opacity: 0, transition: { type: "tween", duration: 0.22, ease: "easeOut" } }}>
      {/* One photo flies, not two crossfading: this and its twin in the cart button both have
          layoutCrossfade={false}, so whichever takes over hides the other, out to the cart and back. */}
      <wardic.div class="photo" layoutId={arrivalId(props.piece.id)} layoutCrossfade={false}>
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="72px" width={photo.width} height={photo.height} alt={props.piece.name} />
      </wardic.div>
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

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
