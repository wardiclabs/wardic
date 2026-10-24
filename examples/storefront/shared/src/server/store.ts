/**
 * The storefront's store (#296), in Effect: its services, each a `Context.Service` with a `layer`,
 * and the calls the apps' server functions make, each taking the visitor's latency step first.
 *
 * - **`Visitor`:** who is calling, from the app's cookie. Each server function provides it.
 * - **`Latency`:** the visitor's switches. Each call waits the visitor's delay, then fails once if
 *   they asked the next call to, so loading states and rollbacks show when someone wants to see them.
 * - **`Catalog`:** the twelve products, read-only.
 * - **`Carts`:** each visitor's cart, keyed by the visitor.
 * - **`Orders`:** each visitor's past orders, made up from their id, so they're the same each visit.
 *
 * Everything lives in memory for the server process's lifetime: a showcase's store, reset by a
 * restart, shared by every visitor of the one process.
 */
import * as Arr from "effect/Array"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import { PRODUCTS } from "../catalog.ts"
import { type Cart, type CartLine, Category, DEFAULT_SETTINGS, type Order, type OrderStatus, type Product, Settings } from "./model.ts"

// --- Errors ----------------------------------------------------------------------------------

/** A product id the catalog doesn't have. */
export class UnknownProduct extends Schema.TaggedError<UnknownProduct>()("UnknownProduct", { id: Schema.String }) {}

/** The failure a visitor asked for with the "fail the next request" switch. */
export class SimulatedFailure extends Schema.TaggedError<SimulatedFailure>()("SimulatedFailure", {}) {}

/** A server function's arguments that don't decode. */
export class InvalidArguments extends Schema.TaggedError<InvalidArguments>()("InvalidArguments", { reason: Schema.String }) {}

/** Every failure a store call can end with. */
export type StoreError = UnknownProduct | SimulatedFailure | InvalidArguments

// --- Visitor ---------------------------------------------------------------------------------

/** Who is calling: an id from the app's cookie, and a name to show others (the shared wishlist's "moved by"). */
export interface VisitorInfo {
  readonly id: string
  readonly name: string
}

export class Visitor extends Context.Service<Visitor, VisitorInfo>()("@wardic/example-storefront/Visitor") {}

const NAMES = ["Fox", "Heron", "Otter", "Wren", "Lynx", "Finch", "Hare", "Moth", "Badger", "Plover", "Vole", "Kestrel"] as const

/** A number from a string, the same each time. */
const hashOf = (text: string): number => Arr.reduce(Arr.fromIterable(text), 0, (sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0)

/** A visitor from their cookie's id, named after an animal by the id, so the name stays the same each visit. */
export const visitorFromId = (id: string): VisitorInfo => ({ id, name: UndefinedOr.getOrThrow(NAMES[hashOf(id) % NAMES.length]) })

// --- Latency ---------------------------------------------------------------------------------

export class Latency extends Context.Service<
  Latency,
  {
    /** The visitor's switches. */
    readonly settings: Effect.Effect<Settings, never, Visitor>
    /** Set the visitor's switches. */
    readonly update: (settings: Settings) => Effect.Effect<Settings, never, Visitor>
    /** The step each store call takes first: the visitor's delay, then the failure they asked for, once. */
    readonly step: Effect.Effect<void, SimulatedFailure, Visitor>
  }
>()("@wardic/example-storefront/Latency") {
  static readonly layer = Layer.effect(
    Latency,
    Effect.gen(function* () {
      const byVisitor = yield* Ref.make(HashMap.empty<string, Settings>())
      const settings = Effect.gen(function* () {
        const visitor = yield* Visitor
        const all = yield* Ref.get(byVisitor)
        return Option.getOrElse(HashMap.get(all, visitor.id), () => DEFAULT_SETTINGS)
      })
      const update = Effect.fnUntraced(function* (next: Settings) {
        const visitor = yield* Visitor
        yield* Ref.update(byVisitor, HashMap.set(visitor.id, next))
        return next
      })
      const step = Effect.gen(function* () {
        const now = yield* settings
        yield* Effect.sleep(now.delay)
        if (!now.failNext) return
        yield* update({ delay: now.delay, failNext: false })
        return yield* new SimulatedFailure()
      })
      return Latency.of({ settings, update, step })
    }),
  )
}

// --- Catalog ---------------------------------------------------------------------------------

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly all: Effect.Effect<ReadonlyArray<Product>>
    readonly byId: (id: string) => Effect.Effect<Product, UnknownProduct>
  }
>()("@wardic/example-storefront/Catalog") {
  static readonly layer = Layer.succeed(
    Catalog,
    Catalog.of({
      all: Effect.succeed(PRODUCTS),
      byId: (id) =>
        Option.match(Arr.findFirst(PRODUCTS, (product) => product.id === id), {
          onNone: () => Effect.fail(new UnknownProduct({ id })),
          onSome: Effect.succeed,
        }),
    }),
  )
}

// --- Carts -----------------------------------------------------------------------------------

const EMPTY_CART: Cart = { lines: [] }

/** `line` with `quantity` if it's `productId`'s, capped at 99; as it is otherwise. */
const lineWith = (line: CartLine, productId: string, quantity: number): CartLine => {
  if (line.productId !== productId) return line
  return { productId, quantity: Math.min(quantity, 99) }
}

export class Carts extends Context.Service<
  Carts,
  {
    readonly get: Effect.Effect<Cart, never, Visitor>
    /** Add `quantity` of a product, to its line if it has one. */
    readonly add: (productId: string, quantity: number) => Effect.Effect<Cart, UnknownProduct, Visitor>
    /** Set a line's quantity; 0 removes it. */
    readonly setQuantity: (productId: string, quantity: number) => Effect.Effect<Cart, UnknownProduct, Visitor>
  }
>()("@wardic/example-storefront/Carts") {
  static readonly layer = Layer.effect(
    Carts,
    Effect.gen(function* () {
      const catalog = yield* Catalog
      const byVisitor = yield* Ref.make(HashMap.empty<string, Cart>())
      const change = Effect.fnUntraced(function* (productId: string, f: (cart: Cart) => Cart) {
        yield* catalog.byId(productId)
        const visitor = yield* Visitor
        return yield* Ref.modify(byVisitor, (all) => {
          const next = f(Option.getOrElse(HashMap.get(all, visitor.id), () => EMPTY_CART))
          return [next, HashMap.set(all, visitor.id, next)] as const
        })
      })
      return Carts.of({
        get: Effect.gen(function* () {
          const visitor = yield* Visitor
          const all = yield* Ref.get(byVisitor)
          return Option.getOrElse(HashMap.get(all, visitor.id), () => EMPTY_CART)
        }),
        add: (productId, quantity) =>
          change(productId, (cart) =>
            Option.match(Arr.findFirst(cart.lines, (line) => line.productId === productId), {
              onNone: (): Cart => ({ lines: [...cart.lines, { productId, quantity }] }),
              onSome: (): Cart => ({ lines: Arr.map(cart.lines, (line) => lineWith(line, productId, line.quantity + quantity)) }),
            })),
        setQuantity: (productId, quantity) =>
          change(productId, (cart) => ({
            lines: Arr.filter(Arr.map(cart.lines, (line) => lineWith(line, productId, quantity)), (line) => line.quantity > 0),
          })),
      })
    }),
  ).pipe(Layer.provide(Catalog.layer))
}

// --- Orders ----------------------------------------------------------------------------------

const ORDER_COUNT = 14
const DAY = 86_400_000

/** A number in [0, 1) from `seed` and `n`, the same each time (a 32-bit integer hash). */
const noise = (seed: number, n: number): number => {
  const a = Math.imul((seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0
  const b = Math.imul((a ^ (a >>> 13)) >>> 0, 0xc2b2ae35) >>> 0
  return ((b ^ (b >>> 16)) >>> 0) / 4_294_967_296
}

/** An integer in [0, `below`) from `seed` and `n`. */
const pick = (seed: number, n: number, below: number): number => Math.floor(noise(seed, n) * below)

/** Where an order placed `daysAgo` days ago has got to. */
const statusOf = (daysAgo: number): OrderStatus => {
  if (daysAgo <= 2) return "Preparing"
  if (daysAgo <= 6) return "On its way"
  return "Delivered"
}

/** Order `i` of a visitor whose id hashes to `seed`, placed `daysAgo` days before `now`. */
const orderOf = (products: ReadonlyArray<Product>, seed: number, now: number, i: number, daysAgo: number): Order => {
  const lines = Arr.dedupeWith(
    Arr.makeBy(1 + pick(seed, i * 7, 3), (k): CartLine => ({
      productId: UndefinedOr.getOrThrow(products[pick(seed, i * 7 + 1 + k, products.length)]).id,
      quantity: 1 + pick(seed, i * 7 + 4 + k, 2),
    })),
    (a, b) => a.productId === b.productId,
  )
  const priceOf = (id: string): number => Option.getOrThrow(Arr.findFirst(products, (product) => product.id === id)).price
  return {
    id: `KC-${10_000 + (ORDER_COUNT - i) * 37 + pick(seed, i * 7 + 6, 30)}`,
    placedOn: new Date(now - daysAgo * DAY).toISOString().slice(0, 10),
    status: statusOf(daysAgo),
    lines,
    total: Arr.reduce(lines, 0, (sum, line) => sum + priceOf(line.productId) * line.quantity),
  }
}

/** A visitor's orders up to `now`, newest first: the first placed a day or two ago, the rest weeks apart. */
const ordersOf = (products: ReadonlyArray<Product>, visitorId: string, now: number): ReadonlyArray<Order> => {
  const seed = hashOf(visitorId)
  const gaps = Arr.makeBy(ORDER_COUNT, (i) => 1 + pick(seed, 1000 + i, Math.min(2 + i * 6, 30)))
  const daysAgo = Arr.scan(gaps, 0, (sum, gap) => sum + gap).slice(1)
  return Arr.map(daysAgo, (days, i) => orderOf(products, seed, now, i, days))
}

export class Orders extends Context.Service<
  Orders,
  {
    /** The visitor's past orders, newest first. */
    readonly forVisitor: Effect.Effect<ReadonlyArray<Order>, never, Visitor>
  }
>()("@wardic/example-storefront/Orders") {
  static readonly layer = Layer.effect(
    Orders,
    Effect.gen(function* () {
      const catalog = yield* Catalog
      const products = yield* catalog.all
      return Orders.of({
        forVisitor: Effect.gen(function* () {
          const visitor = yield* Visitor
          const now = yield* Clock.currentTimeMillis
          return ordersOf(products, visitor.id, now)
        }),
      })
    }),
  ).pipe(Layer.provide(Catalog.layer))
}

// --- The calls -------------------------------------------------------------------------------

/** Every service the calls use. */
export type Store = Latency | Catalog | Carts | Orders

/** The store's services, built once per server process. */
export const StoreLive: Layer.Layer<Store> = Layer.mergeAll(Latency.layer, Catalog.layer, Carts.layer, Orders.layer)

/** A call: the visitor's latency step, then `effect`. */
const call = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | SimulatedFailure, R | Latency | Visitor> =>
  Effect.andThen(Latency.use((latency) => latency.step), effect)

/** Decode a server function's arguments, as they come from the network. */
const decoded = <S extends Schema.Constraint>(schema: S, input: unknown): Effect.Effect<S["Type"], InvalidArguments, S["DecodingServices"]> =>
  Effect.mapError(Schema.decodeUnknownEffect(schema)(input), (error) => new InvalidArguments({ reason: error.message }))

const Quantity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 }))
const QuantityOrNone = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 99 }))

/** The products, in a category or all of them. */
export const listProducts = (category: unknown) =>
  call(
    Effect.gen(function* () {
      const only = yield* decoded(Schema.UndefinedOr(Category), category)
      const catalog = yield* Catalog
      const all = yield* catalog.all
      if (Predicate.isUndefined(only)) return all
      return Arr.filter(all, (product) => product.category === only)
    }),
  )

/** One product. */
export const getProduct = (id: unknown) =>
  call(
    Effect.gen(function* () {
      const productId = yield* decoded(Schema.String, id)
      const catalog = yield* Catalog
      return yield* catalog.byId(productId)
    }),
  )

/** The visitor's cart. */
export const getCart = call(Carts.use((carts) => carts.get))

/** Add to the visitor's cart. */
export const addToCart = (productId: unknown, quantity: unknown) =>
  call(
    Effect.gen(function* () {
      const id = yield* decoded(Schema.String, productId)
      const howMany = yield* decoded(Quantity, quantity)
      const carts = yield* Carts
      return yield* carts.add(id, howMany)
    }),
  )

/** Set a line of the visitor's cart; 0 removes it. */
export const setCartQuantity = (productId: unknown, quantity: unknown) =>
  call(
    Effect.gen(function* () {
      const id = yield* decoded(Schema.String, productId)
      const howMany = yield* decoded(QuantityOrNone, quantity)
      const carts = yield* Carts
      return yield* carts.setQuantity(id, howMany)
    }),
  )

/** The visitor's past orders, newest first. */
export const getOrders = call(Orders.use((orders) => orders.forVisitor))

/** The visitor's switches: read without the latency step, so the settings panel always answers. */
export const getSettings = Latency.use((latency) => latency.settings)

/** Set the visitor's switches. */
export const setSettings = (settings: unknown) =>
  Effect.gen(function* () {
    const next = yield* decoded(Settings, settings)
    const latency = yield* Latency
    return yield* latency.update(next)
  })
