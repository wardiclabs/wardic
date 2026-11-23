import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Order } from "@wardic/example-storefront-shared/server"
import { createAnimate, stagger } from "@wardic/solid"
import { action, createMemo, createOptimistic, createSignal, For, isPending, Loading, Show } from "solid-js"
import { cart, products } from "~/lib/store.ts"
import { addToCart, placeOrder } from "~/server/store.ts"

/** What "Add three pieces" puts in the cart. */
const STARTER = ["moon-vase", "celadon-bowl", "poppy-plate"]

/** Checkout in three steps, one action: the lines leave, the store places the order, the parcel arrives. */
export default function Checkout() {
  const [scope, animate] = createAnimate()
  const current = createMemo(() => cart())
  const lines = () => current().lines
  const catalogue = createMemo(() => products())
  const pieceOf = (id: string) => catalogue().find((product) => product.id === id)!
  const total = () => lines().reduce((sum, line) => sum + pieceOf(line.productId).price * line.quantity, 0)
  const [placed, setPlaced] = createSignal<Order>()
  const [failure, setFailure] = createSignal<string>()
  // Shown at once, and put back as each action ends: what its button says while it runs.
  const [placing, setPlacing] = createOptimistic(false)
  const [adding, setAdding] = createOptimistic(false)

  const place = action(function* () {
    setPlacing(true)
    setFailure(undefined)
    // 1. The lines leave, one after another.
    yield animate(".checkout-line", { x: 48, opacity: 0 }, { duration: 0.25, delay: stagger(0.06) })
    try {
      // 2. The store places the order: the step the next one waits for. The store's failure switch refuses it.
      const order = (yield placeOrder()) as Order
      // Held with the action: the receipt says it once the parcel has landed.
      setPlaced(order)
    } catch (error) {
      setFailure(messageOf(error))
      // A refused order brings the lines back, and the action ends there.
      yield animate(".checkout-line", { x: 0, opacity: 1 }, { duration: 0.3, delay: stagger(0.04) })
      return
    }
    // 3. The parcel arrives.
    yield animate(".parcel", { y: [-36, 0], opacity: [0, 1], rotate: [-10, 0] }, { type: "spring", bounce: 0.45, visualDuration: 0.5 })
  })

  const addThree = action(function* () {
    setAdding(true)
    setFailure(undefined)
    for (const id of STARTER) yield addToCart(id, 1)
    // A new order on its way: the last one's parcel goes.
    if (placed() !== undefined) yield animate(".parcel", { opacity: 0 }, { duration: 0.2 })
    setPlaced(undefined)
  })

  return (
    <Loading fallback={<p class="muted">Loading the cart…</p>}>
      <div class="checkout" ref={scope}>
        <section class="checkout-cart" aria-label="Your cart">
          <Show when={lines().length > 0} fallback={<p class="muted">Your cart is empty.</p>}>
            <ul class="cart-lines">
              {/* Keyed by piece: a line read again from the store is the same line. */}
              <For each={lines()} keyed={(line) => line.productId}>
                {(line) => (
                  <li class="cart-line checkout-line">
                    <img src={photoOf(line().productId).thumb} width="56" height="56" alt="" />
                    <span class="cart-line-text">
                      <strong>{pieceOf(line().productId).name}</strong>
                      <span class="muted">
                        {line().quantity} × {formatPrice(pieceOf(line().productId).price)}
                      </span>
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <p class="checkout-total">
              {/* The cart read again after each change: the total says so while it is. */}
              <span>{isPending(() => current()) ? "Updating…" : "Total"}</span> <strong>{formatPrice(total())}</strong>
            </p>
          </Show>
          <div class="checkout-actions">
            <button class="button accent place" disabled={placing() || adding() || lines().length === 0} onClick={() => place()}>
              {placing() ? "Placing…" : "Place the order"}
            </button>
            <button class="button quiet fill" disabled={placing() || adding()} onClick={() => addThree()}>
              {adding() ? "Adding…" : "Add three pieces"}
            </button>
          </div>
          <Show when={failure()}>
            {(message) => (
              <p class="error-line" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </section>
        <section class="checkout-receipt" aria-live="polite">
          <svg class="parcel" viewBox="0 0 48 48" width="64" height="64" aria-hidden="true">
            <path d="M6 15 24 6l18 9v18l-18 9-18-9z" fill="var(--accent-soft)" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            <path d="M6 15l18 9 18-9M24 24v18M15 10.5l18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          </svg>
          <Show when={placed()} fallback={<p class="muted">Your order's parcel lands here.</p>}>
            {(order) => (
              <p>
                <strong>Order {order().id} placed.</strong> {formatPrice(order().total)}, {order().status.toLowerCase()}:{" "}
                <a href="/layout/order-history">see it in your orders</a>.
              </p>
            )}
          </Show>
        </section>
      </div>
    </Loading>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
