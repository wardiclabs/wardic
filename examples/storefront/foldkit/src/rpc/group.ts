/**
 * The store's wire (#795, Q5 and Q23): one Effect RPC group over the store's calls, typed by the
 * shared model's Schemas, which the server answers at `/api/rpc` (`server.ts`) and the browser's
 * `Shop` calls (`../shop/client.ts`). Every rpc runs for the visitor the cookie names, which the
 * middleware provides.
 */
import * as Schema from "effect/Schema"
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc"
import { Cart, Category, Notice, Order, Product, Settings, Visitor, Wishlist, WishlistScope } from "@wardic/example-storefront-shared/server"
import { Code, StockWhen, StoreFailure } from "~/shop.ts"

/** Gives each rpc its `Visitor`, from the request's cookie; a request without one is a new visitor's. */
export class VisitorMiddleware extends RpcMiddleware.Service<VisitorMiddleware, { provides: Visitor }>()("@wardic/example-storefront-foldkit/VisitorMiddleware") {}

export const ShopRpcs = RpcGroup.make(
  Rpc.make("ListProducts", { payload: { category: Schema.NullOr(Category) }, success: Schema.Array(Product), error: StoreFailure }),
  Rpc.make("GetProduct", { payload: { id: Schema.String }, success: Product, error: StoreFailure }),
  Rpc.make("GetStock", { payload: { when: StockWhen }, success: Schema.Record(Schema.String, Schema.Number), error: StoreFailure }),
  Rpc.make("GetCart", { success: Cart, error: StoreFailure }),
  Rpc.make("AddToCart", { payload: { productId: Schema.String, quantity: Schema.Number }, success: Cart, error: StoreFailure }),
  Rpc.make("SetCartQuantity", { payload: { productId: Schema.String, quantity: Schema.Number }, success: Cart, error: StoreFailure }),
  Rpc.make("GetOrders", { success: Schema.Array(Order), error: StoreFailure }),
  Rpc.make("GetWishlist", { payload: { scope: WishlistScope }, success: Wishlist, error: StoreFailure }),
  Rpc.make("MoveWishlistItem", { payload: { scope: WishlistScope, productId: Schema.String, after: Schema.NullOr(Schema.String) }, success: Wishlist, error: StoreFailure }),
  Rpc.make("ResetWishlist", { payload: { scope: WishlistScope }, success: Wishlist, error: StoreFailure }),
  Rpc.make("GetNotices", { success: Schema.Array(Notice), error: StoreFailure }),
  Rpc.make("DismissNotice", { payload: { id: Schema.String }, success: Schema.Array(Notice), error: StoreFailure }),
  Rpc.make("RestoreNotices", { success: Schema.Array(Notice), error: StoreFailure }),
  Rpc.make("GetSettings", { success: Settings, error: StoreFailure }),
  Rpc.make("SetSettings", { payload: { settings: Settings }, success: Settings, error: StoreFailure }),
  Rpc.make("Highlighted", { payload: { exampleId: Schema.String }, success: Code, error: StoreFailure }),
).middleware(VisitorMiddleware)
