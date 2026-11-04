import { revalidate } from "@solidjs/router"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, layout, LazyWardic, w } from "@wardic/solid/unstable/v2"
import { action, createSignal, For, onSettled } from "solid-js"
import { cart } from "~/lib/store.ts"
import { addToCart } from "~/server/store.ts"

interface Toast {
  readonly id: number
  readonly kind: "added" | "failed"
  readonly text: string
}

// A toast rises in at the bottom of the stack and shrinks away as it goes. Each is a layout
// element: when one goes, the presence pops it out of the stack (mode="popLayout"), and the others
// slide into its place while it fades. The stack sits in its corner, so one that goes is pinned by
// its bottom right (anchorX, anchorY): if the stack resizes as it goes, it stays in the corner.
const toastMotion = {
  initial: { opacity: 0, y: 24, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.9, transition: { type: "tween", duration: 0.18 } },
  transition: { type: "spring", stiffness: 420, damping: 32 },
} as const

const SHELF = PRODUCTS.filter((product) => ["moon-vase", "celadon-bowl", "poppy-plate"].includes(product.id))

/** How long a toast stays, and how many show at once: a fourth pushes the oldest out. */
const STAYS_MS = 4000
const AT_MOST = 3

/** The demo, with this page's `layout` beside the shell's Features (#526): a page that doesn't lay out ships none. */
export default function Toasts() {
  return (
    <LazyWardic features={[layout]}>
      <ToastsDemo />
    </LazyWardic>
  )
}

function ToastsDemo() {
  const [toasts, setToasts] = createSignal<ReadonlyArray<Toast>>([])
  let nextId = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onSettled(() => () => timers.forEach(clearTimeout))

  const dismiss = (id: number) => setToasts((all) => all.filter((toast) => toast.id !== id))
  const show = (kind: Toast["kind"], text: string) => {
    const id = nextId++
    setToasts((all) => [...all, { id, kind, text }].slice(-AT_MOST))
    const timer = setTimeout(() => {
      timers.delete(timer)
      dismiss(id)
    }, STAYS_MS)
    timers.add(timer)
  }

  const buy = action(function* (product: Product) {
    try {
      yield addToCart(product.id, 1)
      // The cart has changed: the header's count reads it again.
      revalidate(cart.key)
      show("added", `${product.name} is in your cart.`)
    } catch (error) {
      show("failed", `${product.name} wasn't added: ${messageOf(error)}`)
    }
  })

  return (
    <div class="toast-demo">
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
                <w.button class="button quiet" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => buy(product)}>
                  Add to cart
                </w.button>
              </li>
            )
          }}
        </For>
      </ul>
      <ol class="toasts" aria-live="polite" aria-label="Notifications">
        <AnimatePresence mode="popLayout" anchorX="right" anchorY="bottom">
          <For each={toasts()}>
            {(toast) => (
              <w.li class="toast" data-kind={toast.kind} layout {...toastMotion}>
                <span>{toast.text}</span>
                <button class="icon-button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                  ✕
                </button>
              </w.li>
            )}
          </For>
        </AnimatePresence>
      </ol>
    </div>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
