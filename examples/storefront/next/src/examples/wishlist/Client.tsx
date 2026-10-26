"use client"
import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { photoOf } from "@wardic/example-storefront-shared/images"
import type { Wishlist } from "@wardic/example-storefront-shared/server"
import { AnimatePresence, motion, Reorder } from "motion/react"
import { Suspense, startTransition, use, useEffect, useOptimistic, useRef, useState } from "react"
import { moveInSharedWishlist, resetSharedWishlist } from "~/lib/store.ts"

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const

interface Props {
  readonly first: Promise<Wishlist>
  readonly me: Promise<string>
}

export function SharedWishlist({ first, me }: Props) {
  return (
    <div className="wishlist">
      <header className="wishlist-head">
        <p className="muted">
          Shared by everyone who opens this page.{" "}
          <Suspense>
            <Me me={me} />
          </Suspense>{" "}
          open it in a private window too, and rearrange it in both.
        </p>
        <button className="button quiet" onClick={() => resetSharedWishlist()}>
          Put it back
        </button>
      </header>
      <Suspense fallback={<p className="muted">Loading the wishlist…</p>}>
        <List first={first} me={me} />
      </Suspense>
    </div>
  )
}

function Me({ me }: { readonly me: Promise<string> }) {
  return (
    <>
      You&apos;re <strong>{use(me)}</strong>:
    </>
  )
}

function List(props: Props) {
  const me = use(props.me)
  // The list as the store has it, live: the server's first read, then each move anyone makes, as
  // it's made, from the feed. An older version never replaces a newer one.
  const [server, setServer] = useState(use(props.first))
  useEffect(() => {
    const feed = new EventSource("/api/wishlist")
    feed.onmessage = (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as Wishlist
      setServer((now) => newer(now, next))
    }
    return () => feed.close()
  }, [])
  const [problem, setProblem] = useState<string>()

  // The order the list shows when nothing is held: the store's, or my drop's while it's on its way.
  // It goes back to the store's by itself once the move's transition ends.
  const [shown, setShown] = useOptimistic(server.items)
  // The order my hand has made of the list (the group's `onReorder`), and the piece in my hand: from
  // a drag's start to its end. Motion's group tells each step of a drag, not its start or end: each
  // item's own drag callbacks do.
  const [mine, setMine] = useState<ReadonlyArray<string>>()
  const [held, setHeld] = useState<string>()
  const before = useRef<ReadonlyArray<string>>([])

  // Yours stays yours: while I hold a piece, the list is everyone else's order, kept live, with my
  // piece where my hand has it.
  const local = mine ?? shown
  const order = held === undefined ? local : withHeldAt(server.items, local, held)

  // A drop is a move: "put it after this one", which the store applies to its order as it is then,
  // so it means the same whatever others moved meanwhile. My order shows until the store's has it.
  const save = (id: string, values: ReadonlyArray<string>) =>
    startTransition(async () => {
      setShown(values)
      setProblem(undefined)
      try {
        const saved = await moveInSharedWishlist(id, pieceBefore(values, id))
        startTransition(() => setServer((now) => newer(now, saved)))
      } catch (error) {
        setProblem(messageOf(error))
      }
    })

  return (
    <>
      <Reorder.Group as="ul" axis="y" className="wish-list" values={order as Array<string>} onReorder={setMine}>
        {order.map((id) => {
          const product = PRODUCTS.find((one) => one.id === id)
          return (
            <Reorder.Item
              key={id}
              value={id}
              className="wish"
              data-id={id}
              onDragStart={() => {
                before.current = order
                setMine(order)
                setHeld(id)
              }}
              onDragEnd={() => {
                setMine(undefined)
                setHeld(undefined)
                // Saved once a drag, at its end, and only when it changed the order.
                if (!sameOrder(order, before.current)) save(id, order)
              }}
            >
              <img src={photoOf(id).small} width="56" height="56" alt="" draggable={false} />
              {product && (
                <span className="wish-text">
                  <strong>{product.name}</strong>
                  <span className="muted">{formatPrice(product.price)}</span>
                </span>
              )}
              <span className="grip" aria-hidden="true">
                ⋮⋮
              </span>
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      <div className="wishlist-foot">
        <AnimatePresence initial={false}>
          {server.lastMove && (
            <motion.p key={server.version} className="moved-by muted" {...fade}>
              {server.lastMove.by === me ? "You" : server.lastMove.by} moved the {nameOf(server.lastMove.productId)}.
            </motion.p>
          )}
        </AnimatePresence>
        {problem && (
          <p className="error-line" role="alert">
            {problem}
          </p>
        )}
      </div>
    </>
  )
}

/** Of two orders of the list, the newer. */
function newer(now: Wishlist, next: Wishlist): Wishlist {
  return next.version > now.version ? next : now
}

function nameOf(id: string): string {
  return PRODUCTS.find((product) => product.id === id)?.name ?? id
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

function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((one, i) => one === b[i])
}

/** The piece just before `id` in `values`, or `null` when it's first. */
function pieceBefore(values: ReadonlyArray<string>, id: string): string | null {
  const index = values.indexOf(id)
  if (index <= 0) return null
  return values[index - 1]!
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
