/**
 * `Shop` over the store itself (#795, Q22): what the server entry gives a page's `load` for the Flags
 * it renders with, and what the rpc's handlers run (`../rpc/server.ts`). The one module that knows
 * the store's calls. One store per process, the shared module's; the visitor is the request's.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as Store from "@wardic/example-storefront-shared/server"
import { highlightedCode } from "~/highlight.ts"
import { type Listing, Shop, type ShopError } from "~/shop.ts"

/** The wire's `null` as the store's optional argument. */
const optional = <A>(value: A | null): A | undefined => {
  if (Predicate.isNull(value)) return undefined
  return value
}

/** A wishlist as the wire carries it: its last move `null` before the first. */
const listingOf = (wishlist: Store.Wishlist): Listing => ({ items: wishlist.items, lastMove: wishlist.lastMove ?? null, version: wishlist.version })

/** A `Shop` for `visitor`, the code panel's run links on `host`. */
export const shopFor = (visitor: Store.VisitorInfo, host: string | undefined): Layer.Layer<Shop> =>
  Layer.effect(
    Shop,
    Effect.gen(function* () {
      const context = yield* Store.storeContext
      const run = <A>(call: Effect.Effect<A, Store.StoreError, Store.Store | Store.Visitor>): Effect.Effect<A, ShopError> =>
        call.pipe(Effect.provideService(Store.Visitor, visitor), Effect.provide(context))
      const listing = (call: Effect.Effect<Store.Wishlist, Store.StoreError, Store.Store | Store.Visitor>): Effect.Effect<Listing, ShopError> => Effect.map(run(call), listingOf)
      return Shop.of({
        listProducts: (category) => run(Store.listProducts(optional(category))),
        getProduct: (id) => run(Store.getProduct(id)),
        getStock: (when) => run(Store.getStock(when)),
        getCart: run(Store.getCart),
        addToCart: (productId, quantity) => run(Store.addToCart(productId, quantity)),
        setCartQuantity: (productId, quantity) => run(Store.setCartQuantity(productId, quantity)),
        getOrders: run(Store.getOrders),
        getWishlist: (scope) => listing(Store.getWishlist(scope)),
        moveWishlistItem: (scope, productId, after) => listing(Store.moveWishlistItem(scope, productId, after)),
        resetWishlist: (scope) => listing(Store.resetWishlist(scope)),
        wishlistChanges: (scope) => Store.wishlistChanges(scope).pipe(Stream.map(listingOf), Stream.provideService(Store.Visitor, visitor), Stream.provideContext(context)),
        getNotices: run(Store.getNotices),
        dismissNotice: (id) => run(Store.dismissNotice(id)),
        restoreNotices: run(Store.restoreNotices),
        getSettings: run(Store.getSettings),
        setSettings: (settings) => run(Store.setSettings(settings)),
        highlighted: (exampleId) => highlightedCode(exampleId, host),
      })
    }),
  )
