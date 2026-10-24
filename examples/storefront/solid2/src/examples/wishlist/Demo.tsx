import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Product, Wishlist } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, Reorder, reorderGroup, wardic } from "@wardic/solid/unstable/v2"
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
  // The order my hands have made of the list (the group's `onReorder`, by pointer or by keys), and
  // the piece in my hand: from a hold's start to its end.
  const [mine, setMine] = createSignal<ReadonlyArray<string>>()
  const [held, setHeld] = createSignal<string>()

  // Yours stays yours: while I hold a piece, dragged or lifted with the keys, the list is everyone
  // else's order, kept live, with my piece where my hands have it. Another visitor's move ends a
  // keyboard lift there (a group drops a lift when its values change), and saves it where it is.
  const order = () => {
    const local = mine() ?? shown()
    const id = held()
    if (id === undefined) return local
    return withHeldAt(server().items, local, id)
  }

  // A drop is a move: "put it after this one", which the store applies to its order as it is then,
  // so it means the same whatever others moved meanwhile. My order shows until the feed has it.
  const move = action(function* (id: string, values: ReadonlyArray<string>) {
    setShown(values)
    setProblem(undefined)
    const saved: Wishlist = yield moveInSharedWishlist(id, pieceBefore(values, id))
    yield until(() => server().version >= saved.version)
  })

  // The list: its Reorder group made here and given to `Reorder.Group` (#349), beside what hears it.
  // The group's holds and reorders are async values the browser reads (`ssrSource: "client"`): a
  // server has none to tell, and a memo like that is made under a `<Loading>`, as the list is. A
  // hold's start puts the piece in my hand, a drag's or a keyboard lift's; a reorder that changed the
  // order is a move to save, with the piece and the order it left; the hold's end, after it, lets the
  // piece go.
  const List = () => {
    const list = reorderGroup({ values: order, onReorder: setMine })
    const started = createMemo(() => list.each("holdStart"), { ssrSource: "client" })
    const reordered = createMemo(() => list.each("reorderEnd"), { ssrSource: "client" })
    const ended = createMemo(() => list.each("holdEnd"), { ssrSource: "client" })
    createEffect(started, (start) => {
      setMine(untrack(order))
      setHeld(start.value)
    })
    createEffect(reordered, (end) => {
      move(end.value, end.values).catch((error: unknown) => setProblem(messageOf(error)))
    })
    createEffect(ended, () => {
      setMine(undefined)
      setHeld(undefined)
    })
    return (
      <Reorder.Group class="wish-list" groupRef={list}>
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
    )
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
        <List />
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

/**
 * `server`'s order, with `id` just after the piece above it in `local`, or first if none is: `local`
 * itself when that's the same order. A keyboard lift ends when the group's values change to any
 * other array than the one it handed out (ADR-0037), so an unchanged order must be the same array.
 */
function withHeldAt(server: ReadonlyArray<string>, local: ReadonlyArray<string>, id: string): ReadonlyArray<string> {
  const others = server.filter((one) => one !== id)
  const above = local
    .slice(0, local.indexOf(id))
    .filter((one) => others.includes(one))
    .at(-1)
  const merged = placedAfter(others, above, id)
  if (sameOrder(merged, local)) return local
  return merged
}

/** `others` with `id` just after `above`, or first without one. */
function placedAfter(others: ReadonlyArray<string>, above: string | undefined, id: string): ReadonlyArray<string> {
  if (above === undefined) return [id, ...others]
  const at = others.indexOf(above) + 1
  return [...others.slice(0, at), id, ...others.slice(at)]
}

function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((one, i) => one === b[i])
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
