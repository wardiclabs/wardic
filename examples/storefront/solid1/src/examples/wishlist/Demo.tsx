import { createAsync, useAction, useSubmission } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, Reorder } from "@wardic/solid"
import { w } from "~/lib/wardic.ts"
import { createSignal, For, Show, Suspense } from "solid-js"
import { moveInWishlist, resetWishlist, wishlist } from "~/lib/store.ts"

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

export default function MyWishlist() {
  const saved = createAsync(() => wishlist())
  const move = useAction(moveInWishlist)
  const reset = useAction(resetWishlist)
  const moving = useSubmission(moveInWishlist)

  // The order my hand has made, from the drag's first step until the store has saved my drop; the
  // store's order otherwise.
  const [mine, setMine] = createSignal<ReadonlyArray<string>>()
  const order = (): ReadonlyArray<string> => {
    const local = mine()
    if (local !== undefined) return local
    const list = saved()
    if (list === undefined) return []
    return list.items
  }

  // A drop is a move: "put it after this one", saved once a drag, as the drag ends.
  const save = (id: string, values: ReadonlyArray<string>) => {
    move(id, pieceBefore(values, id))
      .catch(() => undefined)
      .finally(() => setMine(undefined))
  }
  const putBack = () => {
    setMine(undefined)
    reset().catch(() => undefined)
  }

  const productOf = (id: string): Product | undefined => PRODUCTS.find((product) => product.id === id)

  return (
    <div class="wishlist">
      <header class="wishlist-head">
        <p class="muted">Yours alone: rearrange it, then reload the page and it's as you left it.</p>
        <button class="button quiet" onClick={putBack}>
          Put it back
        </button>
      </header>
      <Suspense fallback={<p class="muted">Loading the wishlist…</p>}>
        <Show when={saved()}>
          <Reorder.Group class="wish-list" values={order()} onReorder={setMine} onReorderEnd={(end) => save(end.value, end.values)}>
            <For each={order()}>
              {(id) => (
                <Reorder.Item class="wish" value={id} data-id={id}>
                  <img src={photoOf(id).small} width="56" height="56" alt="" draggable={false} />
                  <Show when={productOf(id)}>
                    {(product) => (
                      <span class="wish-text">
                        <strong>{product().name}</strong>
                        <span class="muted">{formatPrice(product().price)}</span>
                      </span>
                    )}
                  </Show>
                  <span class="grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                </Reorder.Item>
              )}
            </For>
          </Reorder.Group>
        </Show>
      </Suspense>
      <div class="wishlist-foot">
        <AnimatePresence initial={false}>
          <Show when={moving.pending}>
            <w.p class="moved-by muted" {...fade}>
              Saving…
            </w.p>
          </Show>
        </AnimatePresence>
        <Show when={moving.error}>
          {(error) => (
            <p class="error-line" role="alert">
              {String((error() as Error).message)}
            </p>
          )}
        </Show>
      </div>
    </div>
  )
}

/** The piece just before `id` in `values`, or `null` when it's first. */
function pieceBefore(values: ReadonlyArray<string>, id: string): string | null {
  const index = values.indexOf(id)
  if (index <= 0) return null
  return values[index - 1] as string
}
