import { revalidate } from "@solidjs/router"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { AnimatePresence, w } from "@wardic/solid/unstable/v2"
import { action, createMemo, createOptimistic, createSignal, Loading, Match, onSettled, Show, Switch } from "solid-js"
import { cart, product } from "~/lib/store.ts"
import { addToCart } from "~/server/store.ts"

// "View cart" slides out from behind the button once the piece is in the cart.
const viewCart = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12, transition: { type: "tween", duration: 0.12 } },
} as const

export default function AddToCart() {
  const piece = createMemo(() => product("poppy-plate"))
  const photo = photoOf("poppy-plate")
  const [quantity, setQuantity] = createSignal(1)
  const [added, setAdded] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  // "Adding…" is an optimistic value: set inside the action, it shows at once, and goes back by
  // itself when the action settles, whether the store answered or refused.
  const [adding, setAdding] = createOptimistic(false)

  // "Added ✓" stays a few seconds, then the button offers to add again.
  let reset: ReturnType<typeof setTimeout> | undefined
  onSettled(() => () => clearTimeout(reset))

  const buy = action(function* (id: string, howMany: number) {
    setAdding(true)
    setAdded(false)
    setFailure(undefined)
    try {
      yield addToCart(id, howMany)
      // The cart has changed: the header's count reads it again.
      revalidate(cart.key)
      setAdded(true)
      clearTimeout(reset)
      reset = setTimeout(() => setAdded(false), 3000)
    } catch (error) {
      setFailure(messageOf(error))
    }
  })

  return (
    <Loading fallback={<p class="muted">Loading the piece…</p>}>
      <article class="buy-box">
        <div class="photo">
          <img src={photo.small} srcset={srcsetOf(photo)} sizes="160px" width={photo.width} height={photo.height} alt={piece().name} />
        </div>
        <div class="buy-body">
          <h2 class="name">{piece().name}</h2>
          <p class="muted">{piece().tagline}</p>
          <p class="price">{formatPrice(piece().price)}</p>
          <div class="buy-row">
            <div class="stepper" role="group" aria-label="Quantity">
              <button aria-label="One fewer" disabled={quantity() === 1} onClick={() => setQuantity(quantity() - 1)}>
                −
              </button>
              <span aria-live="polite">{quantity()}</span>
              <button aria-label="One more" disabled={quantity() === piece().stock} onClick={() => setQuantity(quantity() + 1)}>
                +
              </button>
            </div>
            {/* The button's width follows its label: layout animates the change, and the label,
                layout="position", travels with it instead of stretching. */}
            <w.button class="button accent buy" layout disabled={adding()} onClick={() => buy(piece().id, quantity())}>
              <w.span layout="position">
                <Switch fallback="Add to cart">
                  <Match when={adding()}>Adding…</Match>
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
          <Show when={failure()}>
            {(message) => (
              <p class="error-line" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </article>
    </Loading>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
