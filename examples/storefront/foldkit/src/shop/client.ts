/**
 * `Shop` over the wire (#795, Q5): the browser's, an RPC client on Foldkit's fetch-backed
 * `HttpClient`, given to the program's `resources` so every Command reaches the store through it.
 * A transport failure becomes `StoreUnreachable`; the store's own failures arrive as themselves.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc"
import * as Predicate from "effect/Predicate"
import { Http } from "foldkit"
import { ShopRpcs } from "~/rpc/group.ts"
import { Shop, type ShopError, StoreUnreachable } from "~/shop.ts"

/** The RPC client, one per program. */
class Api extends Context.Service<Api, RpcClient.FromGroup<typeof ShopRpcs, RpcClientError.RpcClientError>>()("@wardic/example-storefront-foldkit/Api") {}

const ApiLive = Layer.effect(Api, RpcClient.make(ShopRpcs)).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/api/rpc" })), Layer.provide([RpcSerialization.layerNdjson, Http.layer]))

/** A transport failure as the store being unreachable, with its reason. */
const unreachable = (error: RpcClientError.RpcClientError): StoreUnreachable => new StoreUnreachable({ reason: error.message })

/** `call`'s failure as a `ShopError`: the store's own as it is, the client's as `StoreUnreachable`. */
const reached = <A, E extends ShopError | RpcClientError.RpcClientError>(call: Effect.Effect<A, E>): Effect.Effect<A, ShopError> =>
  Effect.mapError(call, (error): ShopError => {
    if (Predicate.isTagged(error, "RpcClientError")) return unreachable(error as RpcClientError.RpcClientError)
    return error as ShopError
  })

/** The undefined a category filter leaves out, as the wire's `null`. */
const nullable = <A>(value: A | undefined): A | null => {
  if (Predicate.isUndefined(value)) return null
  return value
}

export const ShopClient: Layer.Layer<Shop> = Layer.effect(
  Shop,
  Effect.gen(function* () {
    const api = yield* Api
    return Shop.of({
      listProducts: (category) => reached(api.ListProducts({ category: nullable(category) })),
      getProduct: (id) => reached(api.GetProduct({ id })),
      getStock: (when) => reached(api.GetStock({ when })),
      getCart: reached(api.GetCart()),
      addToCart: (productId, quantity) => reached(api.AddToCart({ productId, quantity })),
      setCartQuantity: (productId, quantity) => reached(api.SetCartQuantity({ productId, quantity })),
      getOrders: reached(api.GetOrders()),
      getWishlist: (scope) => reached(api.GetWishlist({ scope })),
      moveWishlistItem: (scope, productId, after) => reached(api.MoveWishlistItem({ scope, productId, after })),
      resetWishlist: (scope) => reached(api.ResetWishlist({ scope })),
      getNotices: reached(api.GetNotices()),
      dismissNotice: (id) => reached(api.DismissNotice({ id })),
      restoreNotices: reached(api.RestoreNotices()),
      getSettings: reached(api.GetSettings()),
      setSettings: (settings) => reached(api.SetSettings({ settings })),
      highlighted: (exampleId) => reached(api.Highlighted({ exampleId })),
    })
  }),
).pipe(Layer.provide(ApiLive))
