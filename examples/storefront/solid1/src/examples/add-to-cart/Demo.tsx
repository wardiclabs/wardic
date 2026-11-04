import { createAsync, useAction, useSubmission } from "@solidjs/router"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { AnimatePresence, w } from "@wardic/solid"
import { createSignal, Match, onCleanup, Show, Suspense, Switch } from "solid-js"
import { addToCart, product } from "~/lib/store.ts"

// "View cart" slides out from behind the button once the piece is in the cart.
const viewCart = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12, transition: { type: "tween", duration: 0.12 } },
} as const

export default function AddToCart() {
  const piece = createAsync(() => product("poppy-plate"))
  const add = useAction(addToCart)
  const adding = useSubmission(addToCart)
  const [quantity, setQuantity] = createSignal(1)
  const [added, setAdded] = createSignal(false)

  // "Added ✓" stays a few seconds, then the button offers to add again.
  let reset: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(reset))
  const buy = async (id: string) => {
    setAdded(false)
    await add(id, quantity())
    setAdded(true)
    clearTimeout(reset)
    reset = setTimeout(() => setAdded(false), 3000)
  }

  return (
    <Suspense fallback={<p class="muted">Loading the piece…</p>}>
      <Show when={piece()}>
        {(shown) => {
          const photo = photoOf(shown().id)
          return (
            <article class="buy-box">
              <div class="photo">
                <img src={photo.small} srcset={srcsetOf(photo)} sizes="160px" width={photo.width} height={photo.height} alt={shown().name} />
              </div>
              <div class="buy-body">
                <h2 class="name">{shown().name}</h2>
                <p class="muted">{shown().tagline}</p>
                <p class="price">{formatPrice(shown().price)}</p>
                <div class="buy-row">
                  <div class="stepper" role="group" aria-label="Quantity">
                    <button aria-label="One fewer" disabled={quantity() === 1} onClick={() => setQuantity(quantity() - 1)}>
                      −
                    </button>
                    <span aria-live="polite">{quantity()}</span>
                    <button aria-label="One more" disabled={quantity() === shown().stock} onClick={() => setQuantity(quantity() + 1)}>
                      +
                    </button>
                  </div>
                  {/* The button's width follows its label: layout animates the change, and the label,
                      layout="position", travels with it instead of stretching. */}
                  <w.button class="button accent buy" layout disabled={adding.pending} onClick={() => buy(shown().id).catch(() => undefined)}>
                    <w.span layout="position">
                      <Switch fallback="Add to cart">
                        <Match when={adding.pending}>Adding…</Match>
                        <Match when={added()}>Added ✓</Match>
                      </Switch>
                    </w.span>
                  </w.button>
                  <AnimatePresence>
                    <Show when={added()}>
                      <w.a class="view-cart" href="/layout/cart-drawer" {...viewCart}>
                        View cart →
                      </w.a>
                    </Show>
                  </AnimatePresence>
                </div>
                <Show when={adding.error}>
                  {(error) => (
                    <p class="error-line" role="alert">
                      {String((error() as Error).message)}
                    </p>
                  )}
                </Show>
              </div>
            </article>
          )
        }}
      </Show>
    </Suspense>
  )
}
