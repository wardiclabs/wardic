/**
 * The store as the app sees it (#795, Q5 and Q22): one service, `Shop`, whose methods are the store's
 * calls as Effects, and its feed as a Stream. On the server it runs over the store itself
 * (`shop/live.ts`), for the Flags a page renders with and for the rpc's handlers; in the browser over
 * Effect RPC (`shop/client.ts`), for the Commands and Subscriptions. A page's `load`, its Commands
 * and its Subscriptions are written once, against this. Its values are the wire's: JSON, with
 * `null` where the store has `undefined`.
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import { type Cart, type Category, InvalidArguments, type Notice, type Order, type Product, type Settings, SimulatedFailure, UnknownProduct, WishlistMove, type WishlistScope } from "@wardic/example-storefront-shared/server"

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

/** A wishlist as the wire carries it: the store's, its last move `null` before the first. */
export const Listing = Schema.Struct({ items: Schema.Array(Schema.String), lastMove: Schema.NullOr(WishlistMove), version: Schema.Int })
export type Listing = typeof Listing.Type

/** A file, highlighted for both themes: HTML the code panel shows as it is. */
export const Highlighted = Schema.Struct({ path: Schema.String, html: Schema.String })
export type Highlighted = typeof Highlighted.Type

/** An example's code panel: this app's files for it, `Demo.ts` first. */
export const Code = Schema.Struct({ own: Schema.Array(Highlighted) })
export type Code = typeof Code.Type

/** A shop call's Effect: the store's answer, or a failure a visitor can read. */
export type Call<A> = Effect.Effect<A, ShopError>

export class Shop extends Context.Service<
  Shop,
  {
    /** The products, in a category or all of them (`null`). */
    readonly listProducts: (category: Category | null) => Call<ReadonlyArray<Product>>
    readonly getProduct: (id: string) => Call<Product>
    readonly getStock: (when: StockWhen) => Call<Readonly<Record<string, number>>>
    readonly getCart: Call<Cart>
    readonly addToCart: (productId: string, quantity: number) => Call<Cart>
    readonly setCartQuantity: (productId: string, quantity: number) => Call<Cart>
    readonly getOrders: Call<ReadonlyArray<Order>>
    readonly getWishlist: (scope: WishlistScope) => Call<Listing>
    readonly moveWishlistItem: (scope: WishlistScope, productId: string, after: string | null) => Call<Listing>
    readonly resetWishlist: (scope: WishlistScope) => Call<Listing>
    /** A wishlist now, then after every change to it (Q25): what a page's Subscription reads. */
    readonly wishlistChanges: (scope: WishlistScope) => Stream.Stream<Listing, ShopError>
    readonly getNotices: Call<ReadonlyArray<Notice>>
    readonly dismissNotice: (id: string) => Call<ReadonlyArray<Notice>>
    readonly restoreNotices: Call<ReadonlyArray<Notice>>
    readonly getSettings: Call<Settings>
    readonly setSettings: (settings: Settings) => Call<Settings>
    /** An example's code panel, highlighted on the server. */
    readonly highlighted: (exampleId: string) => Call<Code>
  }
>()("@wardic/example-storefront-foldkit/Shop") {}
