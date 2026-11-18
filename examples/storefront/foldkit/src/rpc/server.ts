/**
 * The rpc server (#795, Q5 and Q22): the group's handlers, each the `Shop`'s call for the visitor the
 * request's cookie names (the middleware provides the visitor; `shop/live.ts` knows the store),
 * answered as one web handler the server entry calls for `/api/rpc`. Built once, at module scope,
 * as `HttpRouter.toWebHandler` asks.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Record from "effect/Record"
import * as Stream from "effect/Stream"
import { Cookies, Headers, HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import * as Store from "@wardic/example-storefront-shared/server"
import { ShopRpcs, VisitorMiddleware } from "~/rpc/group.ts"
import { Shop, type ShopError, type StoreFailure } from "~/shop.ts"
import { shopFor } from "~/shop/live.ts"

/** The cookie that names a visitor, set by the page's render. */
export const VISITOR_COOKIE = "storefront-visitor"

/** The visitor `cookies` name, or a new one for a request without the cookie. */
export const visitorOf = (cookies: Readonly<Record<string, string>>): Store.VisitorInfo => Store.visitorFromId(Option.getOrElse(Record.get(cookies, VISITOR_COOKIE), () => crypto.randomUUID()))

/** The cookies a request's headers carry, parsed. */
const cookiesOf = (headers: Headers.Headers): Readonly<Record<string, string>> => Cookies.parseHeader(Option.getOrElse(Headers.get(headers, "cookie"), () => ""))

const VisitorLive = Layer.succeed(VisitorMiddleware, (effect, { headers }) => Effect.provideService(effect, Store.Visitor, visitorOf(cookiesOf(headers))))

/**
 * `call` on the `Shop` for the request's visitor. The server's `Shop` is the store itself, so
 * `StoreUnreachable`, the browser's transport failure, can't happen here: a defect.
 */
const served = <A>(call: Effect.Effect<A, ShopError, Shop>): Effect.Effect<A, StoreFailure, Store.Visitor> =>
  Effect.flatMap(Store.Visitor, (visitor) => Effect.provide(call, shopFor(visitor))).pipe(Effect.catchTag("StoreUnreachable", (error) => Effect.die(error)))

/** The feed on the `Shop` for the request's visitor; its failure, exceptional, a defect. */
const servedStream = <A>(feed: (shop: Shop["Service"]) => Stream.Stream<A, ShopError>): Stream.Stream<A, never, Store.Visitor> =>
  Stream.orDie(Stream.unwrap(served(Effect.map(Shop, feed))))

const Handlers = ShopRpcs.toLayer(
  ShopRpcs.of({
    ListProducts: ({ category }) => served(Shop.use((shop) => shop.listProducts(category))),
    GetProduct: ({ id }) => served(Shop.use((shop) => shop.getProduct(id))),
    GetStock: ({ when }) => served(Shop.use((shop) => shop.getStock(when))),
    GetCart: () => served(Shop.use((shop) => shop.getCart)),
    AddToCart: ({ productId, quantity }) => served(Shop.use((shop) => shop.addToCart(productId, quantity))),
    SetCartQuantity: ({ productId, quantity }) => served(Shop.use((shop) => shop.setCartQuantity(productId, quantity))),
    GetOrders: () => served(Shop.use((shop) => shop.getOrders)),
    GetWishlist: ({ scope }) => served(Shop.use((shop) => shop.getWishlist(scope))),
    MoveWishlistItem: ({ scope, productId, after }) => served(Shop.use((shop) => shop.moveWishlistItem(scope, productId, after))),
    ResetWishlist: ({ scope }) => served(Shop.use((shop) => shop.resetWishlist(scope))),
    WishlistChanges: ({ scope }) => servedStream((shop) => shop.wishlistChanges(scope)),
    GetNotices: () => served(Shop.use((shop) => shop.getNotices)),
    DismissNotice: ({ id }) => served(Shop.use((shop) => shop.dismissNotice(id))),
    RestoreNotices: () => served(Shop.use((shop) => shop.restoreNotices)),
    GetSettings: () => served(Shop.use((shop) => shop.getSettings)),
    SetSettings: ({ settings }) => served(Shop.use((shop) => shop.setSettings(settings))),
    Highlighted: ({ exampleId }) => served(Shop.use((shop) => shop.highlighted(exampleId))),
  }),
)

const Route = RpcServer.layerHttp({ group: ShopRpcs, path: "/api/rpc", protocol: "http" }).pipe(Layer.provide([Handlers, VisitorLive, RpcSerialization.layerNdjson]))

// The client posts to `/api/rpc/`, its base URL joined with an empty path: the route takes both.
/** The rpc endpoint as a web handler: what `renderPage` answers `/api/rpc` with. */
export const rpc = HttpRouter.toWebHandler(Route, { disableLogger: true, routerConfig: { ignoreTrailingSlash: true } })
