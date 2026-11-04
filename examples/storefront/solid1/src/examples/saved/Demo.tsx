import { useAction } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, layout, LazyWardic, w } from "@wardic/solid"
import { batch, createSignal, For, Show } from "solid-js"
import { arrivalId, arrive, recall } from "~/lib/arrivals.ts"
import { useReducedMotion } from "~/lib/preferences.tsx"
import { addToCart } from "~/lib/store.ts"

const SAVED = PRODUCTS.filter((product) => ["bottle-vase", "tulip-bowl", "painted-jug", "cut-carafe"].includes(product.id))

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function SavedForLater() {
  return (
    <LazyWardic features={[layout]}>
      <SavedForLaterDemo />
    </LazyWardic>
  )
}

function SavedForLaterDemo() {
  const add = useAction(addToCart)
  const [saved, setSaved] = createSignal<ReadonlyArray<Product>>(SAVED)
  const [failure, setFailure] = createSignal<string>()
  // The system's setting, or the header's switch.
  const reduced = useReducedMotion()

  const take = (piece: Product) => setSaved((list) => list.filter((one) => one.id !== piece.id))
  // Back in its place: the saved pieces in their order, it among them.
  const putBack = (piece: Product) => setSaved((list) => SAVED.filter((one) => one.id === piece.id || list.some((kept) => kept.id === one.id)))
  // A click takes its row out at once, its photo's twin appearing in the cart button in the same update,
  // so Wardic flies it there (under reduced motion, nothing flies); if the store refuses, the row comes
  // back. Solid 2 has optimistic writes for this; here it's by hand. A piece already on its way, its
  // leaving row clicked again, is left alone.
  const moveToCart = async (piece: Product) => {
    if (!saved().some((one) => one.id === piece.id)) return
    setFailure(undefined)
    batch(() => {
      if (!reduced()) arrive({ id: piece.id, src: photoOf(piece.id).small }, layout)
      take(piece)
    })
    try {
      await add(piece.id, 1)
    } catch (error) {
      // Refused: its row back, and its twin leaving the cart button, its photo flying back.
      batch(() => {
        recall(piece.id)
        putBack(piece)
      })
      setFailure(`${piece.name} wasn't moved: ${messageOf(error)}`)
    }
  }

  return (
    <div class="saved">
      <ul class="saved-list">
        {/* popLayout: a leaving row steps out of the list at once, and the rows below close the gap while it goes. */}
        <AnimatePresence mode="popLayout">
          <For each={saved()}>{(piece) => <SavedRow piece={piece} onMove={() => void moveToCart(piece)} onRemove={() => take(piece)} />}</For>
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
  const photo = photoOf(props.piece.id)
  return (
    // It fades as it leaves, either way. Moved to the cart, its photo's twin there flies from its own.
    <w.li class="saved-row" layout exit={{ opacity: 0, transition: { type: "tween", duration: 0.22, ease: "easeOut" } }}>
      {/* One photo flies, not two crossfading: this and its twin in the cart button both have
          layoutCrossfade={false}, so whichever takes over hides the other, out to the cart and back. */}
      <w.div class="photo" layoutId={arrivalId(props.piece.id)} layoutCrossfade={false}>
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="72px" width={photo.width} height={photo.height} alt={props.piece.name} />
      </w.div>
      <div class="saved-text">
        <span class="name">{props.piece.name}</span>
        <span class="price">{formatPrice(props.piece.price)}</span>
      </div>
      <div class="saved-actions">
        <w.button class="button accent" whileTap={{ scale: 0.96 }} onClick={() => props.onMove()}>
          Move to cart
        </w.button>
        <button class="button quiet" onClick={() => props.onRemove()}>
          Remove
        </button>
      </div>
    </w.li>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
