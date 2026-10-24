/**
 * The storefront's data as Effect Schemas (#296): plain structs, so a value crosses a server
 * function's wire as it is (both frameworks' serializers take plain data, not class instances), and
 * every argument a server function receives is decoded with them before the store sees it.
 */
import * as Schema from "effect/Schema"

/** The shop's categories, in the order its filters show them. */
export const CATEGORIES = ["Vases", "Bowls", "Plates", "Jugs & jars", "Glass"] as const

export const Category = Schema.Literals(CATEGORIES)
export type Category = typeof Category.Type

/** A product's id: its photo's name (`moon-vase`). */
export const ProductId = Schema.String.check(Schema.isMinLength(1))
export type ProductId = typeof ProductId.Type

/** A price in cents. */
export const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Product = Schema.Struct({
  id: ProductId,
  name: Schema.String,
  category: Category,
  price: Cents,
  /** One line for the card. */
  tagline: Schema.String,
  /** A paragraph for the detail view. */
  description: Schema.String,
  /** Dimensions, material, care. */
  details: Schema.Array(Schema.String),
  stock: Schema.Int,
})
export type Product = typeof Product.Type

/** A cart line: a product and how many. */
export const CartLine = Schema.Struct({
  productId: ProductId,
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
})
export type CartLine = typeof CartLine.Type

export const Cart = Schema.Struct({ lines: Schema.Array(CartLine) })
export type Cart = typeof Cart.Type

/** Where an order has got to. */
export const OrderStatus = Schema.Literals(["Preparing", "On its way", "Delivered"])
export type OrderStatus = typeof OrderStatus.Type

/** A past order. */
export const Order = Schema.Struct({
  /** Its number, as the shop prints it (`KC-10421`). */
  id: Schema.String,
  /** The day it was placed, an ISO date (`2026-09-14`). */
  placedOn: Schema.String,
  status: OrderStatus,
  lines: Schema.Array(CartLine),
  /** What it came to, in cents. */
  total: Cents,
})
export type Order = typeof Order.Type

/** Which wishlist: the visitor's own, or the one every visitor shares. */
export const WishlistScope = Schema.Literals(["mine", "shared"])
export type WishlistScope = typeof WishlistScope.Type

/** A wishlist's last move: who made it, and which piece. */
export const WishlistMove = Schema.Struct({ by: Schema.String, productId: ProductId })
export type WishlistMove = typeof WishlistMove.Type

/** A wishlist: its pieces in order. */
export const Wishlist = Schema.Struct({
  items: Schema.Array(ProductId),
  /** The last move, for "Heron moved the Tulip Bowl"; none before the first. */
  lastMove: Schema.UndefinedOr(WishlistMove),
  /** One more with every change: of two orders, the newer has the higher. */
  version: Schema.Int,
})
export type Wishlist = typeof Wishlist.Type

/** A notification the shop sends a visitor. */
export const Notice = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["shipped", "stock", "price", "review"]),
  title: Schema.String,
  body: Schema.String,
})
export type Notice = typeof Notice.Type

/** The visitor's switches for showing the async paths on purpose. */
export const Settings = Schema.Struct({
  /** The artificial delay on each store call, in ms. */
  delay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5000 })),
  /** The next store call fails, once. */
  failNext: Schema.Boolean,
})
export type Settings = typeof Settings.Type

/** What a new visitor starts with: a short delay, so loading states show. */
export const DEFAULT_SETTINGS: Settings = { delay: 300, failNext: false }
