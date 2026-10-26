"use client"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Cart, CartLine, Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { startTransition, Suspense, use, useEffect, useOptimistic, useState } from "react"
import { addToCart, setCartQuantity } from "~/lib/store.ts"

const SUGGESTED = ["white-bowl", "celadon-bowl", "slip-dish", "painted-jug"]

// The drawer slides in from the right edge; a line arrives from the right and leaves the same way.
const drawer = { initial: { x: 460 }, animate: { x: 0 }, exit: { x: 460 }, transition: { type: "spring", stiffness: 380, damping: 40 } } as const
const line = { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 32 } } as const
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

interface Props {
  readonly cart: Promise<Cart>
  readonly products: Promise<ReadonlyArray<Product>>
}

/** A change on its way to the store: a line set to a quantity, or one more of a piece. */
type Change = { readonly kind: "set"; readonly id: string; readonly quantity: number } | { readonly kind: "add"; readonly id: string }

export function CartDrawer(props: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="cart-demo">
      <p className="muted">Your cart lives on the store: what you add here is in the header&apos;s cart too.</p>
      <Suspense fallback={<button className="button accent open-cart">Open the cart</button>}>
        <OpenButton cart={props.cart} open={() => setOpen(true)} />
      </Suspense>
      <AnimatePresence>
        {open && <motion.div key="backdrop" className="backdrop" {...fade} onClick={() => setOpen(false)} />}
        {open && (
          <motion.aside key="drawer" className="drawer" role="dialog" aria-modal="true" aria-label="Your cart" {...drawer}>
            <header className="drawer-head">
              <h2>Your cart</h2>
              <button className="icon-button" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>
            <Suspense fallback={<p className="muted">Loading your cart…</p>}>
              <Lines {...props} />
            </Suspense>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

function OpenButton({ cart, open }: { readonly cart: Promise<Cart>; readonly open: () => void }) {
  const count = use(cart).lines.reduce((sum, one) => sum + one.quantity, 0)
  return (
    <button className="button accent open-cart" onClick={open}>
      Open the cart · {count}
    </button>
  )
}

function Lines(props: Props) {
  const products = use(props.products)
  const [problem, setProblem] = useState<string>()
  // The cart's lines: the store's, with the changes still on their way laid over them. A change
  // shows at once, and goes when its transition ends: the refreshed cart then takes its place, or,
  // if the store refused, the line goes back to what it was.
  const [lines, change] = useOptimistic(use(props.cart).lines, (now: ReadonlyArray<CartLine>, next: Change) => {
    if (next.kind === "add") return withOneMore(now, next.id)
    return now.map((one) => lineAt(one, next.id, next.quantity)).filter((one) => one.quantity > 0)
  })

  // Each is a server action, which refreshes the page: the cart is read again, here and in the header.
  const setQuantity = (id: string, quantity: number) =>
    startTransition(async () => {
      change({ kind: "set", id, quantity })
      setProblem(undefined)
      try {
        await setCartQuantity(id, quantity)
      } catch (error) {
        setProblem(messageOf(error))
      }
    })
  const add = (id: string) =>
    startTransition(async () => {
      change({ kind: "add", id })
      setProblem(undefined)
      try {
        await addToCart(id, 1)
      } catch (error) {
        setProblem(messageOf(error))
      }
    })

  const productOf = (id: string): Product | undefined => products.find((product) => product.id === id)
  const subtotal = lines.reduce((sum, one) => sum + one.quantity * (productOf(one.productId)?.price ?? 0), 0)
  const suggestions = SUGGESTED.filter((id) => !lines.some((one) => one.productId === id))

  return (
    <>
      <div className="drawer-body">
        {/* A LayoutGroup: when "Your cart is empty" goes at the end of its exit, nothing here
            renders again, and Motion measures a layout element when it renders. In a group, one
            member's change has the others measure, so the suggestions glide up into its space
            instead of jumping. */}
        <LayoutGroup>
          {problem && (
            <p className="error-line" role="alert">
              {problem}
            </p>
          )}
          {/* Each line is a layout element: when one goes, popLayout takes it out of the flow at
              once, and the lines below slide up into its place while it fades. */}
          <ul className="cart-lines">
            <AnimatePresence mode="popLayout" initial={false}>
              {lines.map((one) => {
                const product = productOf(one.productId)
                return (
                  <motion.li key={one.productId} className="cart-line" layout {...line}>
                    {product && (
                      <>
                        <img src={photoOf(one.productId).small} width="56" height="56" alt="" />
                        <div className="cart-line-text">
                          <strong>{product.name}</strong>
                          <span className="muted">{formatPrice(product.price)}</span>
                        </div>
                        <div className="stepper" role="group" aria-label={`${product.name} quantity`}>
                          <button aria-label="One fewer" onClick={() => setQuantity(one.productId, one.quantity - 1)}>
                            −
                          </button>
                          <span>{one.quantity}</span>
                          <button aria-label="One more" onClick={() => setQuantity(one.productId, one.quantity + 1)}>
                            +
                          </button>
                        </div>
                        <button className="link-button" onClick={() => setQuantity(one.productId, 0)}>
                          Remove
                        </button>
                      </>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
          <AnimatePresence initial={false}>
            {lines.length === 0 && (
              <motion.p className="cart-empty" {...fade}>
                Your cart is empty.
              </motion.p>
            )}
          </AnimatePresence>
          {/* The suggestions sit under the lines and slide down as lines arrive: layout="position",
              as their block only travels. One added to the cart leaves, and the rest close up. */}
          {suggestions.length > 0 && (
            <motion.section className="suggestions" layout="position">
              <h3>You might also like</h3>
              <ul>
                <AnimatePresence mode="popLayout" initial={false}>
                  {suggestions.map((id) => {
                    const product = productOf(id)
                    return (
                      <motion.li key={id} layout="position" {...fade}>
                        {product && (
                          <button className="suggestion" onClick={() => add(id)}>
                            <img src={photoOf(id).small} width="44" height="44" alt="" />
                            <span>{product.name}</span>
                            <span className="add" aria-hidden="true">
                              +
                            </span>
                          </button>
                        )}
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </motion.section>
          )}
        </LayoutGroup>
      </div>
      <footer className="drawer-foot">
        <span>Subtotal</span>
        <strong>{formatPrice(subtotal)}</strong>
        <button className="button accent" disabled={lines.length === 0}>
          Check out
        </button>
      </footer>
    </>
  )
}

/** `lines` with one more of a product: its line, or a new one at the end. */
function withOneMore(lines: ReadonlyArray<CartLine>, productId: string): ReadonlyArray<CartLine> {
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
