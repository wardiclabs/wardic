/**
 * `Shop` over the store itself (#795, Q22): what the server entry gives a page's `load` for the Flags
 * it renders with, and what the rpc handlers run. One store per process, the shared module's; the
 * visitor is the request's.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Store from "@wardic/example-storefront-shared/server"
import { highlightedCode } from "~/highlight.ts"
import { Shop, type ShopError } from "~/shop.ts"

/** A `Shop` for `visitor`, the code panel's run links on `host`. */
export const shopFor = (visitor: Store.VisitorInfo, host: string | undefined): Layer.Layer<Shop> =>
  Layer.effect(
    Shop,
    Effect.gen(function* () {
      const context = yield* Store.storeContext
      const run = <A>(call: Effect.Effect<A, Store.StoreError, Store.Store | Store.Visitor>): Effect.Effect<A, ShopError> =>
        call.pipe(Effect.provideService(Store.Visitor, visitor), Effect.provide(context))
      return Shop.of({
        listProducts: (category) => run(Store.listProducts(category)),
        getProduct: (id) => run(Store.getProduct(id)),
        getStock: (when) => run(Store.getStock(when)),
        getCart: run(Store.getCart),
        addToCart: (productId, quantity) => run(Store.addToCart(productId, quantity)),
        setCartQuantity: (productId, quantity) => run(Store.setCartQuantity(productId, quantity)),
        getOrders: run(Store.getOrders),
        getWishlist: (scope) => run(Store.getWishlist(scope)),
        moveWishlistItem: (scope, productId, after) => run(Store.moveWishlistItem(scope, productId, after)),
        resetWishlist: (scope) => run(Store.resetWishlist(scope)),
        getNotices: run(Store.getNotices),
        dismissNotice: (id) => run(Store.dismissNotice(id)),
        restoreNotices: run(Store.restoreNotices),
        getSettings: run(Store.getSettings),
        setSettings: (settings) => run(Store.setSettings(settings)),
        highlighted: (exampleId) => highlightedCode(exampleId, host),
      })
    }),
  )
