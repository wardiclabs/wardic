// The storefront's store (#296), in Effect: its calls run against the store's own layer, as each
// app's server functions run them, with the test clock standing in for the latency step's delay.
//
// - ST1: a call waits the visitor's delay first; a visitor who set none waits the default 300 ms.
// - ST2: "fail the next request" fails one call, with `SimulatedFailure`, then clears itself.
// - ST3: the catalog lists every product, or one category's; a category it doesn't know is
//   `InvalidArguments`, decoded from the network's input before the store sees it.
// - ST4: a cart adds to a product's line, caps a line at 99, and removes a line set to 0; an unknown
//   product is `UnknownProduct`; each visitor has a cart of their own.
// - ST5: a visitor's name comes from their id, the same each visit.
// - ST6: `runFor`, the apps' edge, answers with the value, or rejects with a message a person can read.
// - ST7: a visitor's orders are the same each visit, newest first, placed up to now, each total its
//   lines' prices; the newest few are still on their way; another visitor's differ.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import { runFor } from "../src/server/index.ts"
import { PRODUCTS } from "../src/catalog.ts"
import { addToCart, getCart, getOrders, getSettings, listProducts, setCartQuantity, setSettings, StoreLive, Visitor, visitorFromId } from "../src/server/store.ts"

const ADA = visitorFromId("ada")
const BO = visitorFromId("bo")

/** A call as `visitor`, on a fresh store. */
const as = <A, E, R>(visitor: typeof ADA, effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Visitor, visitor)
const fresh = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(effect, Layer.fresh(StoreLive))
/** Switch the visitor's delay off, so a call answers at once. */
const noDelay = setSettings({ delay: 0, failNext: false })

describe("the storefront's store (#296)", () => {
  it.effect("ST1: a call waits the visitor's delay first, 300 ms by default", () =>
    fresh(
      as(
        ADA,
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(listProducts(undefined))
          yield* TestClock.adjust("299 millis")
          expect(fiber.pollUnsafe(), "still waiting at 299 ms").toBeUndefined()
          yield* TestClock.adjust("1 millis")
          const products = yield* Fiber.join(fiber)
          expect(products).toHaveLength(12)
          yield* setSettings({ delay: 1000, failNext: false })
          const slow = yield* Effect.forkChild(listProducts(undefined))
          yield* TestClock.adjust("999 millis")
          expect(slow.pollUnsafe(), "still waiting at 999 ms").toBeUndefined()
          yield* TestClock.adjust("1 millis")
          yield* Fiber.join(slow)
        }),
      ),
    ))

  it.effect("ST2: 'fail the next request' fails one call, then clears itself", () =>
    fresh(
      as(
        ADA,
        Effect.gen(function* () {
          yield* setSettings({ delay: 0, failNext: true })
          const failed = yield* Effect.exit(listProducts(undefined))
          expect(Exit.isFailure(failed)).toBe(true)
          expect(JSON.stringify(failed)).toContain("SimulatedFailure")
          expect((yield* getSettings).failNext, "cleared").toBe(false)
          expect(yield* listProducts(undefined)).toHaveLength(12)
        }),
      ),
    ))

  it.effect("ST3: the catalog lists all, or one category; an unknown category doesn't decode", () =>
    fresh(
      as(
        ADA,
        Effect.gen(function* () {
          yield* noDelay
          const bowls = yield* listProducts("Bowls")
          expect(bowls.map((product) => product.id)).toEqual(["tulip-bowl", "white-bowl", "celadon-bowl"])
          const bad = yield* Effect.exit(listProducts("Teapots"))
          expect(JSON.stringify(bad)).toContain("InvalidArguments")
        }),
      ),
    ))

  it.effect("ST4: a cart adds to a line, caps it at 99, removes a line set to 0; each visitor has their own", () =>
    fresh(
      Effect.gen(function* () {
        yield* as(ADA, noDelay)
        yield* as(BO, noDelay)
        yield* as(ADA, addToCart("moon-vase", 1))
        const twice = yield* as(ADA, addToCart("moon-vase", 2))
        expect(twice.lines).toEqual([{ productId: "moon-vase", quantity: 3 }])
        const capped = yield* as(ADA, addToCart("moon-vase", 99))
        expect(capped.lines).toEqual([{ productId: "moon-vase", quantity: 99 }])
        yield* as(ADA, addToCart("poppy-plate", 1))
        const removed = yield* as(ADA, setCartQuantity("moon-vase", 0))
        expect(removed.lines).toEqual([{ productId: "poppy-plate", quantity: 1 }])
        const unknown = yield* Effect.exit(as(ADA, addToCart("teapot", 1)))
        expect(JSON.stringify(unknown)).toContain("UnknownProduct")
        expect((yield* as(BO, getCart)).lines, "Bo's cart is empty").toEqual([])
      }),
    ))

  it("ST5: a visitor's name comes from their id, the same each visit", () => {
    expect(visitorFromId("ada")).toEqual(visitorFromId("ada"))
    expect(visitorFromId("ada").name).toMatch(/^[A-Z][a-z]+$/)
  })

  it("ST6: runFor answers with the value, or rejects with a readable message", async () => {
    const visitor = visitorFromId("runfor")
    await runFor(visitor, noDelay)
    expect(await runFor(visitor, listProducts("Glass"))).toHaveLength(1)
    await expect(runFor(visitor, addToCart("teapot", 1))).rejects.toThrow(`There's no product "teapot".`)
    await runFor(visitor, setSettings({ delay: 0, failNext: true }))
    await expect(runFor(visitor, getCart)).rejects.toThrow("you asked the next request to fail")
  })

  it.effect("ST7: a visitor's orders are the same each visit, newest first, each total its lines' prices", () =>
    fresh(
      Effect.gen(function* () {
        yield* as(ADA, noDelay)
        yield* as(BO, noDelay)
        // A year in, so the newest orders are recent and the oldest still after 1970.
        yield* TestClock.adjust("365 days")
        const today = new Date(365 * 86_400_000).toISOString().slice(0, 10)
        const orders = yield* as(ADA, getOrders)
        expect(orders).toHaveLength(14)
        expect(yield* as(ADA, getOrders), "the same next visit").toEqual(orders)
        const days = orders.map((order) => order.placedOn)
        expect(days, "newest first").toEqual([...days].sort().reverse())
        expect(days.every((day) => day < today), "all placed before today").toBe(true)
        expect(new Set(orders.map((order) => order.id)).size, "numbers unique").toBe(14)
        const price = (id: string) => PRODUCTS.find((product) => product.id === id)!.price
        for (const order of orders) {
          expect(order.lines.length).toBeGreaterThan(0)
          expect(order.total).toBe(order.lines.reduce((sum, line) => sum + price(line.productId) * line.quantity, 0))
        }
        expect(orders[0]!.status, "the newest is still being prepared").toBe("Preparing")
        expect(orders.at(-1)!.status).toBe("Delivered")
        expect(yield* as(BO, getOrders), "another visitor's differ").not.toEqual(orders)
      }),
    ))
})
