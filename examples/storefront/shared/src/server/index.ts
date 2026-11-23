/**
 * The store's edge (#296): what each app's `"use server"` functions call. One `ManagedRuntime` per
 * server process over the store's services; `runFor` provides the calling visitor, runs a call, and
 * turns a typed failure into a plain `Error` with a message a person can read, since a framework's
 * server functions send what they reject with to the client as a thrown error.
 */
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import { type Store, StoreLive, type StoreError, Visitor, type VisitorInfo } from "./store.ts"

export { type Store, type StoreError, Visitor }

export * from "./model.ts"
export {
  addToCart,
  dismissNotice,
  EmptyCart,
  getCart,
  getNotices,
  getOrders,
  getProduct,
  getSettings,
  getStock,
  getWishlist,
  InvalidArguments,
  listProducts,
  moveWishlistItem,
  placeOrder,
  resetWishlist,
  restoreNotices,
  setCartQuantity,
  setSettings,
  SimulatedFailure,
  UnknownProduct,
  visitorFromId,
  type VisitorInfo,
  wishlistChanges,
} from "./store.ts"

const RUNTIME = Symbol.for("@wardic/example-storefront/runtime")

/**
 * The store, built once per server process, shared by every visitor of it. Kept on `globalThis`: a
 * bundler can load this module more than once in one process (the Next.js app's route handlers and
 * pages each had copies of their own, #366), and each copy would otherwise build a store of its own.
 */
const runtimeOnce = (): ManagedRuntime.ManagedRuntime<Store, never> => {
  const holder = globalThis as { [RUNTIME]?: ManagedRuntime.ManagedRuntime<Store, never> }
  const known = holder[RUNTIME]
  if (known !== undefined) return known
  const made = ManagedRuntime.make(StoreLive)
  holder[RUNTIME] = made
  return made
}

const runtime = runtimeOnce()

/**
 * The store's services, for a server that runs the store's calls as Effects of its own (the Foldkit
 * app's rpc handlers and its page render, #795): one `Context` from the one runtime, so a visitor's
 * cart is the same whichever way a call reaches it.
 */
export const storeContext: Effect.Effect<Context.Context<Store>> = runtime.contextEffect

// #795, Q24: one source of the words for every wire; the Foldkit app's Commands read it.
/** What a visitor reads when a call fails. */
export const messageOf: (error: StoreError) => string = Match.type<StoreError>().pipe(
  Match.tag("SimulatedFailure", () => "The store didn't answer: you asked the next request to fail."),
  Match.tag("UnknownProduct", (error) => `There's no product "${error.id}".`),
  Match.tag("InvalidArguments", (error) => `That request wasn't valid: ${error.reason}`),
  Match.tag("EmptyCart", () => "There's nothing in the cart to order."),
  Match.exhaustive,
)

/** Whether a squashed cause is one of the store's typed failures. */
const isStoreError = (u: unknown): u is StoreError => Predicate.hasProperty(u, "_tag")

/** A store failure as the `Error` a person reads. */
const readable = (error: StoreError): Error => new Error(messageOf(error))

/**
 * A store feed for `visitor`, as an async iterable: what a `live()` server function yields from. It
 * runs while it's iterated, and stops when the reader does; a failure throws from the iteration
 * with a message a person can read.
 */
export const streamFor = <A>(visitor: VisitorInfo, stream: Stream.Stream<A, StoreError, Store | Visitor>): Promise<AsyncIterable<A>> =>
  runtime.runPromise(Stream.toAsyncIterableEffect(stream.pipe(Stream.provideService(Visitor, visitor), Stream.mapError(readable))))

/** Run a store call for `visitor`: its value, or a rejection with a readable message. */
export const runFor = <A>(visitor: VisitorInfo, call: Effect.Effect<A, StoreError, Store | Visitor>): Promise<A> =>
  runtime.runPromiseExit(Effect.provideService(call, Visitor, visitor)).then(
    Exit.match({
      onSuccess: (value) => value,
      onFailure: (cause) => {
        const error = Cause.squash(cause)
        if (isStoreError(error)) throw new Error(messageOf(error))
        throw new Error("Something went wrong in the store.")
      },
    }),
  )
