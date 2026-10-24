import { createAsync, useAction, useSubmissions } from "@solidjs/router"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { CartLine, Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, wardic } from "@wardic/solid"
import { createSignal, For, onCleanup, onMount, Show, Suspense } from "solid-js"
import { addToCart, cart, products, setCartQuantity } from "~/lib/store.ts"

const SUGGESTED = ["white-bowl", "celadon-bowl", "slip-dish", "painted-jug"]

// The drawer slides in from the right edge; a line arrives from the right and leaves the same way.
const drawer = { initial: { x: 460 }, animate: { x: 0 }, exit: { x: 460 }, transition: { type: "spring", stiffness: 380, damping: 40 } } as const
const line = { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 32 } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

export default function CartDrawer() {
  const [open, setOpen] = createSignal(false)
  const current = createAsync(() => cart())
  const all = createAsync(() => products())
  const add = useAction(addToCart)
  const change = useAction(setCartQuantity)
  const adding = useSubmissions(addToCart)
  const changing = useSubmissions(setCartQuantity)

  // The cart as it's about to be: the server's, with the changes still on their way laid over it,
  // so a line moves the moment it's tapped, not when the store answers.
  const lines = (): ReadonlyArray<CartLine> => {
    const now = current()
    if (now === undefined) return []
    let next = now.lines
    for (const submission of adding) if (submission.pending) next = withAdded(next, submission.input[0], submission.input[1])
    for (const submission of changing) if (submission.pending) next = withQuantity(next, submission.input[0], submission.input[1])
    return next
  }
  const ids = () => lines().map((one) => one.productId)
  const quantityOf = (id: string) => quantityIn(lines(), id)
  const productOf = (id: string): Product | undefined => {
    const list = all()
    if (list === undefined) return undefined
    return list.find((product) => product.id === id)
  }
  const priceOf = (id: string) => {
    const product = productOf(id)
    if (product === undefined) return 0
    return product.price
  }
  const count = () => lines().reduce((sum, one) => sum + one.quantity, 0)
  const subtotal = () => lines().reduce((sum, one) => sum + one.quantity * priceOf(one.productId), 0)
  const suggestions = () => SUGGESTED.filter((id) => !ids().includes(id))

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div class="cart-demo">
      <p class="muted">Your cart lives on the store: what you add here is in the header's cart too.</p>
      <button class="button accent open-cart" onClick={() => setOpen(true)}>
        Open the cart · {count()}
      </button>
      <AnimatePresence>
        <Show when={open()}>
          <wardic.div class="backdrop" {...fade} onClick={() => setOpen(false)} />
          <wardic.aside class="drawer" role="dialog" aria-modal="true" aria-label="Your cart" {...drawer}>
            <header class="drawer-head">
              <h2>Your cart</h2>
              <button class="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>
            <Suspense fallback={<p class="muted">Loading your cart…</p>}>
              <div class="drawer-body">
                {/* Each line is a layout element: when one goes, popLayout takes it out of the flow
                    at once, and the lines below slide up into its place while it fades. */}
                <ul class="cart-lines">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <For each={ids()}>
                      {(id) => (
                        <wardic.li class="cart-line" layout {...line}>
                          <Show when={productOf(id)}>
                            {(product) => (
                              <>
                                <img src={photoOf(id).small} width="56" height="56" alt="" />
                                <div class="cart-line-text">
                                  <strong>{product().name}</strong>
                                  <span class="muted">{formatPrice(product().price)}</span>
                                </div>
                                <div class="stepper" role="group" aria-label={`${product().name} quantity`}>
                                  <button aria-label="One fewer" onClick={() => change(id, quantityOf(id) - 1)}>
                                    −
                                  </button>
                                  <span>{quantityOf(id)}</span>
                                  <button aria-label="One more" onClick={() => change(id, quantityOf(id) + 1)}>
                                    +
                                  </button>
                                </div>
                                <button class="link-button" onClick={() => change(id, 0)}>
                                  Remove
                                </button>
                              </>
                            )}
                          </Show>
                        </wardic.li>
                      )}
                    </For>
                  </AnimatePresence>
                </ul>
                <AnimatePresence initial={false}>
                  <Show when={ids().length === 0}>
                    <wardic.p class="cart-empty" {...fade}>
                      Your cart is empty.
                    </wardic.p>
                  </Show>
                </AnimatePresence>
                {/* The suggestions sit under the lines and slide down as lines arrive: layout="position",
                    as their block only travels. One added to the cart leaves, and the rest close up. */}
                <Show when={suggestions().length > 0}>
                  <wardic.section class="suggestions" layout="position">
                    <h3>You might also like</h3>
                    <ul>
                      <AnimatePresence mode="popLayout" initial={false}>
                        <For each={suggestions()}>
                          {(id) => (
                            <wardic.li layout="position" {...fade}>
                              <Show when={productOf(id)}>
                                {(product) => (
                                  <button class="suggestion" onClick={() => add(id, 1)}>
                                    <img src={photoOf(id).small} width="44" height="44" alt="" />
                                    <span>{product().name}</span>
                                    <span class="add" aria-hidden="true">
                                      +
                                    </span>
                                  </button>
                                )}
                              </Show>
                            </wardic.li>
                          )}
                        </For>
                      </AnimatePresence>
                    </ul>
                  </wardic.section>
                </Show>
              </div>
              <footer class="drawer-foot">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal())}</strong>
                <button class="button accent" disabled={ids().length === 0}>
                  Check out
                </button>
              </footer>
            </Suspense>
          </wardic.aside>
        </Show>
      </AnimatePresence>
    </div>
  )
}

/** `lines` with `quantity` more of a product: its line, or a new one at the end. */
function withAdded(lines: ReadonlyArray<CartLine>, productId: string, quantity: number): ReadonlyArray<CartLine> {
  if (lines.some((one) => one.productId === productId)) return withQuantity(lines, productId, quantityIn(lines, productId) + quantity)
  return [...lines, { productId, quantity }]
}

/** `lines` with a product's line at `quantity`, capped at 99; gone at 0. */
function withQuantity(lines: ReadonlyArray<CartLine>, productId: string, quantity: number): ReadonlyArray<CartLine> {
  return lines.map((one) => lineAt(one, productId, quantity)).filter((one) => one.quantity > 0)
}

function lineAt(one: CartLine, productId: string, quantity: number): CartLine {
  if (one.productId !== productId) return one
  return { productId, quantity: Math.min(quantity, 99) }
}

function quantityIn(lines: ReadonlyArray<CartLine>, productId: string): number {
  return lines.filter((one) => one.productId === productId).reduce((sum, one) => sum + one.quantity, 0)
}
