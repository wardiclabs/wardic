import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { CartLine, Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { revalidate } from "@solidjs/router"
import { action, createMemo, createOptimisticStore, createSignal, For, Loading, onSettled, refresh, Show } from "solid-js"
import { cart, products } from "~/lib/store.ts"
import { addToCart, setCartQuantity } from "~/server/store.ts"
import { layout } from "~/lib/layout-feature.ts"

const SUGGESTED = ["white-bowl", "celadon-bowl", "slip-dish", "painted-jug"]

// The drawer slides in from the right edge; a line arrives from the right and leaves the same way.
const drawer = { initial: { x: 460 }, animate: { x: 0 }, exit: { x: 460 }, transition: { type: "spring", stiffness: 380, damping: 40 } } as const
const line = { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 32 } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function CartDrawer() {
  return (
    <LazyWardic features={[layout]}>
      <CartDrawerDemo />
    </LazyWardic>
  )
}

function CartDrawerDemo() {
  const [open, setOpen] = createSignal(false)
  const [problem, setProblem] = createSignal<string>()
  const all = createMemo(() => products())

  // The cart's lines, derived from the store's, keyed by product. A write inside an action shows at
  // once as a prediction over them, and is dropped when the action settles: the refreshed lines
  // then take its place, or, if the store refused, the line goes back to what it was.
  const [lines, setLines] = createOptimisticStore<Array<CartLine>>(async () => [...(await cart()).lines], [], { key: "productId" })

  const change = action(function* (id: string, quantity: number) {
    setLines((draft) => draft.map((one) => lineAt(one, id, quantity)).filter((one) => one.quantity > 0))
    setProblem(undefined)
    try {
      yield setCartQuantity(id, quantity)
    } catch (error) {
      setProblem(messageOf(error))
    }
    // The router's cart is stale now: read it again, here and in the header, then reconcile.
    revalidate(cart.key)
    refresh(lines)
  })

  const add = action(function* (id: string) {
    setLines((draft) => withOneMore(draft, id))
    setProblem(undefined)
    try {
      yield addToCart(id, 1)
    } catch (error) {
      setProblem(messageOf(error))
    }
    revalidate(cart.key)
    refresh(lines)
  })

  const productOf = (id: string): Product | undefined => all().find((product) => product.id === id)
  const priceOf = (id: string) => {
    const product = productOf(id)
    if (product === undefined) return 0
    return product.price
  }
  const count = () => lines.reduce((sum, one) => sum + one.quantity, 0)
  const subtotal = () => lines.reduce((sum, one) => sum + one.quantity * priceOf(one.productId), 0)
  const suggestions = () => SUGGESTED.filter((id) => !lines.some((one) => one.productId === id))

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div class="cart-demo">
      <p class="muted">Your cart lives on the store: what you add here is in the header's cart too.</p>
      <Loading fallback={<button class="button accent open-cart">Open the cart</button>}>
        <button class="button accent open-cart" onClick={() => setOpen(true)}>
          Open the cart · {count()}
        </button>
      </Loading>
      <AnimatePresence>
        <Show when={open()}>
          <w.div class="backdrop" {...fade} onClick={() => setOpen(false)} />
          <w.aside class="drawer" role="dialog" aria-modal="true" aria-label="Your cart" {...drawer}>
            <header class="drawer-head">
              <h2>Your cart</h2>
              <button class="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>
            <Loading fallback={<p class="muted">Loading your cart…</p>}>
              <div class="drawer-body">
                <Show when={problem()}>
                  {(message) => (
                    <p class="error-line" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
                {/* Each line is a layout element: when one goes, popLayout takes it out of the flow
                    at once, and the lines below slide up into its place while it fades. */}
                <ul class="cart-lines">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <For each={lines}>
                      {(one) => (
                        <w.li class="cart-line" layout {...line}>
                          <Show when={productOf(one.productId)}>
                            {(product) => (
                              <>
                                <img src={photoOf(one.productId).small} width="56" height="56" alt="" />
                                <div class="cart-line-text">
                                  <strong>{product().name}</strong>
                                  <span class="muted">{formatPrice(product().price)}</span>
                                </div>
                                <div class="stepper" role="group" aria-label={`${product().name} quantity`}>
                                  <button aria-label="One fewer" onClick={() => change(one.productId, one.quantity - 1)}>
                                    −
                                  </button>
                                  <span>{one.quantity}</span>
                                  <button aria-label="One more" onClick={() => change(one.productId, one.quantity + 1)}>
                                    +
                                  </button>
                                </div>
                                <button class="link-button" onClick={() => change(one.productId, 0)}>
                                  Remove
                                </button>
                              </>
                            )}
                          </Show>
                        </w.li>
                      )}
                    </For>
                  </AnimatePresence>
                </ul>
                <AnimatePresence initial={false}>
                  <Show when={lines.length === 0}>
                    <w.p class="cart-empty" {...fade}>
                      Your cart is empty.
                    </w.p>
                  </Show>
                </AnimatePresence>
                {/* The suggestions sit under the lines and slide down as lines arrive: layout="position",
                    as their block only travels. One added to the cart leaves, and the rest close up. */}
                <Show when={suggestions().length > 0}>
                  <w.section class="suggestions" layout="position">
                    <h3>You might also like</h3>
                    <ul>
                      <AnimatePresence mode="popLayout" initial={false}>
                        <For each={suggestions()}>
                          {(id) => (
                            <w.li layout="position" {...fade}>
                              <Show when={productOf(id)}>
                                {(product) => (
                                  <button class="suggestion" onClick={() => add(id)}>
                                    <img src={photoOf(id).small} width="44" height="44" alt="" />
                                    <span>{product().name}</span>
                                    <span class="add" aria-hidden="true">
                                      +
                                    </span>
                                  </button>
                                )}
                              </Show>
                            </w.li>
                          )}
                        </For>
                      </AnimatePresence>
                    </ul>
                  </w.section>
                </Show>
              </div>
              <footer class="drawer-foot">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal())}</strong>
                <button class="button accent" disabled={lines.length === 0}>
                  Check out
                </button>
              </footer>
            </Loading>
          </w.aside>
        </Show>
      </AnimatePresence>
    </div>
  )
}

/** `lines` with one more of a product: its line, or a new one at the end. */
function withOneMore(lines: ReadonlyArray<CartLine>, productId: string): Array<CartLine> {
  if (lines.some((one) => one.productId === productId)) return lines.map((one) => lineAt(one, productId, one.quantity + 1))
  return [...lines, { productId, quantity: 1 }]
}

/** `one` at `quantity` if it's `productId`'s line, capped at 99. */
function lineAt(one: CartLine, productId: string, quantity: number): CartLine {
  if (one.productId !== productId) return one
  return { productId, quantity: Math.min(quantity, 99) }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
