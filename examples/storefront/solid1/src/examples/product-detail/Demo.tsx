import { createAsync } from "@solidjs/router"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import type { Product } from "@wardic/example-storefront-shared/server"
import { AnimatePresence } from "@wardic/solid"
import { w } from "~/lib/wardic-layout.ts"
import { createSignal, For, onCleanup, onMount, Show, Suspense } from "solid-js"
import { products } from "~/lib/store.ts"

// The detail view's text fades in once the card has grown into it, and out at once when it closes.
const content = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { delay: 0.15 } },
  exit: { opacity: 0, transition: { type: "tween", duration: 0.1 } },
} as const

export default function ProductDetail() {
  const all = createAsync(() => products())
  const [open, setOpen] = createSignal<Product>()
  const close = () => setOpen(undefined)

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Suspense fallback={<p class="muted">Loading the shop…</p>}>
      <ul class="product-grid">
        <For each={all()}>
          {(product) => (
            <li>
              {/* Each part of the card has a twin in the detail view: the same layoutId. */}
              <w.button class="product-card" layoutId={`card-${product.id}`} onClick={() => setOpen(product)} aria-label={`Open ${product.name}`}>
                <Photo product={product} />
                <div class="line">
                  <w.span class="name" layoutId={`name-${product.id}`} layout="position">
                    {product.name}
                  </w.span>
                  <w.span class="price" layoutId={`price-${product.id}`} layout="position">
                    {formatPrice(product.price)}
                  </w.span>
                </div>
              </w.button>
            </li>
          )}
        </For>
      </ul>
      <AnimatePresence>
        <Show when={open()}>
          {(product) => (
            <>
              <w.div class="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
              {/* A position: fixed frame: the twins meet where each is drawn, however far the page has scrolled. */}
              <div class="detail-frame">
                <w.article class="detail" layoutId={`card-${product().id}`} role="dialog" aria-modal="true" aria-label={product().name}>
                  <Photo product={product()} />
                  <div class="detail-body">
                    <w.h2 class="name" layoutId={`name-${product().id}`} layout="position">
                      {product().name}
                    </w.h2>
                    <w.p class="price" layoutId={`price-${product().id}`} layout="position">
                      {formatPrice(product().price)}
                    </w.p>
                    <w.div class="detail-text" {...content}>
                      <p>{product().description}</p>
                      <ul class="details">
                        <For each={product().details}>{(detail) => <li>{detail}</li>}</For>
                      </ul>
                      <button class="button accent">Add to cart</button>
                    </w.div>
                  </div>
                  <button class="icon-button close" onClick={close} aria-label="Close">
                    ✕
                  </button>
                </w.article>
              </div>
            </>
          )}
        </Show>
      </AnimatePresence>
    </Suspense>
  )
}

function Photo(props: { readonly product: Product }) {
  const photo = photoOf(props.product.id)
  return (
    <w.div class="photo" layoutId={`photo-${props.product.id}`}>
      <img src={photo.small} srcset={srcsetOf(photo)} sizes="(max-width: 640px) 100vw, 480px" width={photo.width} height={photo.height} alt={props.product.name} />
    </w.div>
  )
}
