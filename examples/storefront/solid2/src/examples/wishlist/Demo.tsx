import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product, Wishlist } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, Reorder, type ReorderGroup, type Ward, wardic } from "@wardic/solid/unstable/v2"
import { action, createEffect, createMemo, createOptimistic, createSignal, For, Loading, Show, until, untrack } from "solid-js"
import { visitorName } from "~/lib/store.ts"
import { moveInSharedWishlist, resetSharedWishlist } from "~/server/store.ts"
import { sharedWishlistFeed } from "~/server/wishlist.ts"

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

export default function SharedWishlist() {
  // The list as the store has it, live: its order now, then each move anyone makes, as it's made.
  // One call of the live source, read through one memo: the server's render shows its first value,
  // and the browser goes on with the feed.
  const source = sharedWishlistFeed()
  const server = createMemo(() => source)
  const [problem, setProblem] = createSignal<string>()
  const me = createMemo(() => visitorName())

  // The order the list shows when nothing is held: the store's, or my drop's while it's on its way.
  // An optimistic value: it goes back to the store's by itself once the move has landed.
  const [shown, setShown] = createOptimistic<ReadonlyArray<string>>(() => server().items)
  // The order my hands have made of the list (the group's `onReorder`, by pointer or by keys), until
  // it's saved; and the piece a drag has in my hand.
  const [mine, setMine] = createSignal<ReadonlyArray<string>>()
  const [held, setHeld] = createSignal<string>()

  // Yours stays yours: while I drag a piece, the list is everyone else's order, kept live, with my
  // piece where my drag has it. A keyboard lift tells nothing (#348), so a lifted piece shows my
  // order as it is, and the store's next change replaces it.
  const order = () => {
    const local = mine() ?? shown()
    const id = held()
    if (id === undefined) return local
    return withHeldAt(server().items, local, id)
  }
  createEffect(
    () => server().version,
    () => {
      if (untrack(held) === undefined) setMine(undefined)
    },
  )

  // A drop is a move: "put it after this one", which the store applies to its order as it is then,
  // so it means the same whatever others moved meanwhile. My order shows until the feed has it.
  const move = action(function* (id: string, values: ReadonlyArray<string>) {
    setShown(values)
    setProblem(undefined)
    const saved: Wishlist = yield moveInSharedWishlist(id, pieceBefore(values, id))
    yield until(() => server().version >= saved.version)
  })

  // Each piece's drag, from its ward: its start puts the piece in my hand, its end lets it go. Read
  // as async values, the browser's (`ssrSource: "client"`): a server has no drags to tell.
  const hearDrags = (card: Ward, id: string): void => {
    const started = createMemo(() => card.each("dragStart"), { ssrSource: "client" })
    const ended = createMemo(() => card.each("dragEnd"), { ssrSource: "client" })
    createEffect(started, () => {
      setMine(untrack(order))
      setHeld(id)
    })
    createEffect(ended, () => {
      setHeld(undefined)
    })
  }

  // The group's reorders, from its `reorderEnd`: one for each drag or keyboard lift that changed the
  // order, with the piece and the order it left. That's a move to save.
  const hearReorders = (list: ReorderGroup<string>): void => {
    const reordered = createMemo(() => list.each("reorderEnd"), { ssrSource: "client" })
    createEffect(reordered, (end) => {
      setMine(undefined)
      move(end.value, end.values).catch((error: unknown) => setProblem(messageOf(error)))
    })
  }

  const productOf = (id: string): Product | undefined => PRODUCTS.find((product) => product.id === id)
  const nameOf = (id: string) => {
    const product = productOf(id)
    if (product === undefined) return id
    return product.name
  }
  const who = (name: string) => {
    if (name === me()) return "You"
    return name
  }

  return (
    <div class="wishlist">
      <header class="wishlist-head">
        <p class="muted">
          Shared by everyone who opens this page.{" "}
          <Loading>
            You're <strong>{me()}</strong>:
          </Loading>{" "}
          open it in a private window too, and rearrange it in both.
        </p>
        <button class="button quiet" onClick={() => resetSharedWishlist()}>
          Put it back
        </button>
      </header>
      <Loading fallback={<p class="muted">Loading the wishlist…</p>}>
        <Reorder.Group class="wish-list" values={order()} onReorder={setMine} groupRef={hearReorders}>
          <For each={order()}>
            {(id) => (
              <Reorder.Item class="wish" value={id} data-id={id} wardRef={(card: Ward) => hearDrags(card, id)}>
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
      </Loading>
      <Loading>
        <div class="wishlist-foot">
          <AnimatePresence initial={false}>
            <Show when={server().lastMove} keyed>
              {(last) => (
                <wardic.p class="moved-by muted" {...fade}>
                  {who(last.by)} moved the {nameOf(last.productId)}.
                </wardic.p>
              )}
            </Show>
          </AnimatePresence>
          <Show when={problem()}>
            {(message) => (
              <p class="error-line" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </Loading>
    </div>
  )
}

/** `server`'s order, with `id` just after the piece above it in `local`, or first if none is. */
function withHeldAt(server: ReadonlyArray<string>, local: ReadonlyArray<string>, id: string): ReadonlyArray<string> {
  const others = server.filter((one) => one !== id)
  const above = local
    .slice(0, local.indexOf(id))
    .filter((one) => others.includes(one))
    .at(-1)
  if (above === undefined) return [id, ...others]
  const at = others.indexOf(above) + 1
  return [...others.slice(0, at), id, ...others.slice(at)]
}

/** The piece just before `id` in `values`, or `null` when it's first. */
function pieceBefore(values: ReadonlyArray<string>, id: string): string | null {
  const index = values.indexOf(id)
  if (index <= 0) return null
  return values[index - 1] as string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
