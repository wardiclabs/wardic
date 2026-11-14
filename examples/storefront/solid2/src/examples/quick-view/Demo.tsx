import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence } from "@wardic/solid/unstable/v2"
import { w } from "~/lib/wardic-layout.ts"
import { createSignal, For, onSettled, Show } from "solid-js"

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "cut-carafe"].includes(product.id))

/** Three pieces from other shelves, to go with one. */
const pairingsOf = (piece: Product): ReadonlyArray<Product> => PRODUCTS.filter((other) => other.category !== piece.category).slice(0, 3)

// The suggestions slide in after the panel, and out before it: the panel's exit waits a moment, so
// the list visibly goes first.
const panel = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.97, transition: { type: "tween", duration: 0.2, delay: 0.16 } },
} as const

const pairing = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 26, delay: 0.12 } },
  exit: { opacity: 0, x: -16, transition: { type: "tween", duration: 0.16 } },
} as const

export default function QuickView() {
  const [open, setOpen] = createSignal<Product>()
  const close = () => setOpen(undefined)

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <>
      <ul class="shelf">
        <For each={SHELF}>
          {(product) => {
            const photo = photoOf(product.id)
            return (
              <li class="shelf-item">
                <div class="photo">
                  <img src={photo.small} srcset={srcsetOf(photo)} sizes="160px" width={photo.width} height={photo.height} alt={product.name} />
                </div>
                <div class="line">
                  <span class="name">{product.name}</span>
                  <span class="price">{formatPrice(product.price)}</span>
                </div>
                <w.button class="button quiet" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => setOpen(product)}>
                  Quick view
                </w.button>
              </li>
            )
          }}
        </For>
      </ul>
      <AnimatePresence>
        <Show when={open()} keyed>
          {(piece) => (
            <>
              <w.div class="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.16 } }} onClick={close} />
              <div class="detail-frame">
                <w.article class="quick-view" role="dialog" aria-modal="true" aria-label={piece.name} {...panel}>
                  <QuickViewBody piece={piece} onClose={close} />
                </w.article>
              </div>
            </>
          )}
        </Show>
      </AnimatePresence>
    </>
  )
}

function QuickViewBody(props: { readonly piece: Product; readonly onClose: () => void }) {
  const photo = photoOf(props.piece.id)
  // "Not for me" takes a suggestion out of the list, which is why the list is a presence of its own.
  const [dismissed, setDismissed] = createSignal<ReadonlyArray<string>>([])
  const shown = () => pairingsOf(props.piece).filter((other) => !dismissed().includes(other.id))
  return (
    <>
      <div class="photo">
        <img src={photo.small} srcset={srcsetOf(photo)} sizes="200px" width={photo.width} height={photo.height} alt={props.piece.name} />
      </div>
      <div class="quick-view-body">
        <h2 class="name">{props.piece.name}</h2>
        <p class="price">{formatPrice(props.piece.price)}</p>
        <p class="muted">{props.piece.description}</p>
        <h3>Pairs well with</h3>
        <ul class="pairings">
          {/* propagate: when the dialog goes, these leave first, each running its exit, and the
              dialog waits for them. Without it, they'd vanish with it. */}
          <AnimatePresence propagate>
            <For each={shown()}>
              {(other) => (
                <w.li class="pairing" layout {...pairing}>
                  <img src={photoOf(other.id).small} width="40" height="40" alt="" />
                  <span class="name">{other.name}</span>
                  <span class="price">{formatPrice(other.price)}</span>
                  <button class="icon-button" aria-label={`Not for me: ${other.name}`} onClick={() => setDismissed([...dismissed(), other.id])}>
                    ✕
                  </button>
                </w.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </div>
      <button class="icon-button close" onClick={() => props.onClose()} aria-label="Close">
        ✕
      </button>
    </>
  )
}
