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
