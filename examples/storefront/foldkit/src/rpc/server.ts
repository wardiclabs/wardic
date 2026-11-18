/**
 * The rpc server (#795, Q5 and Q22): the group's handlers over the store, the visitor from the
 * request's cookie, answered as one web handler the server entry calls for `/api/rpc`. Built once,
 * at module scope, as `HttpRouter.toWebHandler` asks.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Record from "effect/Record"
import { Cookies, Headers, HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import * as Store from "@wardic/example-storefront-shared/server"
import { highlightedCode } from "~/highlight.ts"
import { ShopRpcs, VisitorMiddleware } from "~/rpc/group.ts"

/** The cookie that names a visitor, set by the page's render. */
export const VISITOR_COOKIE = "storefront-visitor"

/** The visitor a `Cookie` header names, or a new one for a request without the cookie. */
export const visitorOf = (cookieHeader: string | undefined): Store.VisitorInfo => {
  const known = Option.flatMap(Option.fromUndefinedOr(cookieHeader), (header) => Record.get(Cookies.parseHeader(header), VISITOR_COOKIE))
  return Store.visitorFromId(Option.getOrElse(known, () => crypto.randomUUID()))
}

/** The store's wire failure, from a handler: the store's own, as it is. */
const VisitorLive = Layer.succeed(VisitorMiddleware, (effect, { headers }) => Effect.provideService(effect, Store.Visitor, visitorOf(Option.getOrUndefined(Headers.get(headers, "cookie")))))

/** `null` on the wire, as the store's optional argument. */
const optional = <A>(value: A | null): A | undefined => {
  if (Predicate.isNull(value)) return undefined
  return value
}

const Handlers = ShopRpcs.toLayer(
  Effect.gen(function* () {
    const context = yield* Store.storeContext
    return ShopRpcs.of({
      ListProducts: ({ category }) => Effect.provide(Store.listProducts(optional(category)), context),
      GetProduct: ({ id }) => Effect.provide(Store.getProduct(id), context),
      GetStock: ({ when }) => Effect.provide(Store.getStock(when), context),
      GetCart: () => Effect.provide(Store.getCart, context),
      AddToCart: ({ productId, quantity }) => Effect.provide(Store.addToCart(productId, quantity), context),
      SetCartQuantity: ({ productId, quantity }) => Effect.provide(Store.setCartQuantity(productId, quantity), context),
      GetOrders: () => Effect.provide(Store.getOrders, context),
      GetWishlist: ({ scope }) => Effect.provide(Store.getWishlist(scope), context),
      MoveWishlistItem: ({ scope, productId, after }) => Effect.provide(Store.moveWishlistItem(scope, productId, after), context),
      ResetWishlist: ({ scope }) => Effect.provide(Store.resetWishlist(scope), context),
      GetNotices: () => Effect.provide(Store.getNotices, context),
      DismissNotice: ({ id }) => Effect.provide(Store.dismissNotice(id), context),
      RestoreNotices: () => Effect.provide(Store.restoreNotices, context),
      GetSettings: () => Effect.provide(Store.getSettings, context),
      SetSettings: ({ settings }) => Effect.provide(Store.setSettings(settings), context),
      // The run link names the host this request came to, as the Solid apps' pages do.
      Highlighted: ({ exampleId }, { headers }) => highlightedCode(exampleId, Option.getOrUndefined(Headers.get(headers, "host"))),
    })
  }),
)

const Route = RpcServer.layerHttp({ group: ShopRpcs, path: "/api/rpc", protocol: "http" }).pipe(Layer.provide([Handlers, VisitorLive, RpcSerialization.layerNdjson]))

/** The rpc endpoint as a web handler: what `renderPage` answers `/api/rpc` with. */
// The client posts to `/api/rpc/`, its base URL joined with an empty path: the route takes both.
export const rpc = HttpRouter.toWebHandler(Route, { disableLogger: true, routerConfig: { ignoreTrailingSlash: true } })
