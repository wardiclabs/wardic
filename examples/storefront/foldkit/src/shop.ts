/**
 * The store as the app sees it (#795, Q5 and Q22): one service, `Shop`, whose methods are the store's
 * calls as Effects. On the server it runs over the store itself (`shop/live.ts`), for the Flags a page
 * renders with; in the browser over Effect RPC (`shop/client.ts`), for the Commands. A page's `load`
 * and its Commands are written once, against this.
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { type Cart, type Category, InvalidArguments, type Notice, type Order, type Product, type Settings, SimulatedFailure, UnknownProduct, type Wishlist, type WishlistScope } from "@wardic/example-storefront-shared/server"

/** The store couldn't be reached, or answered with something that wasn't the store's (the RPC's own failure). */
export class StoreUnreachable extends Schema.TaggedError<StoreUnreachable>()("StoreUnreachable", { reason: Schema.String }) {}

/** The store's own failures, as they cross the wire: its classes, so a Command matches on them. */
export const StoreFailure = Schema.Union([UnknownProduct, SimulatedFailure, InvalidArguments])
export type StoreFailure = typeof StoreFailure.Type

/** What a shop call can fail with. */
export type ShopError = StoreFailure | StoreUnreachable

/** When the stock is counted (#390): now, or after the next delivery. */
export const StockWhen = Schema.Literals(["now", "delivery"])
export type StockWhen = typeof StockWhen.Type

/** A file, highlighted for both themes: HTML the code panel shows as it is. */
export const Highlighted = Schema.Struct({ path: Schema.String, html: Schema.String })
export type Highlighted = typeof Highlighted.Type

/** An example's code panel: this app's files, `Demo.ts` first; Motion's; and where Motion's runs. */
export const Code = Schema.Struct({ own: Schema.Array(Highlighted), motion: Schema.Array(Highlighted), run: Schema.String })
export type Code = typeof Code.Type

/** A shop call's Effect: the store's answer, or a failure a visitor can read. */
export type Call<A> = Effect.Effect<A, ShopError>

export class Shop extends Context.Service<
  Shop,
  {
    readonly listProducts: (category: Category | undefined) => Call<ReadonlyArray<Product>>
    readonly getProduct: (id: string) => Call<Product>
    readonly getStock: (when: StockWhen) => Call<Readonly<Record<string, number>>>
    readonly getCart: Call<Cart>
    readonly addToCart: (productId: string, quantity: number) => Call<Cart>
    readonly setCartQuantity: (productId: string, quantity: number) => Call<Cart>
    readonly getOrders: Call<ReadonlyArray<Order>>
    readonly getWishlist: (scope: WishlistScope) => Call<Wishlist>
    readonly moveWishlistItem: (scope: WishlistScope, productId: string, after: string | null) => Call<Wishlist>
    readonly resetWishlist: (scope: WishlistScope) => Call<Wishlist>
    readonly getNotices: Call<ReadonlyArray<Notice>>
    readonly dismissNotice: (id: string) => Call<ReadonlyArray<Notice>>
    readonly restoreNotices: Call<ReadonlyArray<Notice>>
    readonly getSettings: Call<Settings>
    readonly setSettings: (settings: Settings) => Call<Settings>
    /** An example's code panel, highlighted on the server. */
    readonly highlighted: (exampleId: string) => Call<Code>
  }
>()("@wardic/example-storefront-foldkit/Shop") {}
