"use server"
/**
 * The app's server functions (#296): each a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`), for the visitor the middleware put on the request.
 * The store decodes the arguments it was sent, and answers or rejects with a message a person can
 * read.
 */
import * as Store from "@wardic/example-storefront-shared/server"
import { respond } from "@solidjs/web"
import { CART, ORDERS, SETTINGS } from "~/lib/keys.ts"
import { storeCall, visitor } from "./visitor.ts"

export async function listProducts(category?: string) {
  return storeCall(Store.listProducts(category))
}

export async function getProduct(id: string) {
  return storeCall(Store.getProduct(id))
}

export async function getStock(when: "now" | "delivery") {
  return storeCall(Store.getStock(when))
}

export async function getCart() {
  return storeCall(Store.getCart)
}

// A cart change revalidates the cart alone: named on the response, the router refetches no other query.
export async function addToCart(productId: string, quantity: number) {
  return respond(await storeCall(Store.addToCart(productId, quantity)), { revalidate: CART })
}

export async function setCartQuantity(productId: string, quantity: number) {
  return respond(await storeCall(Store.setCartQuantity(productId, quantity)), { revalidate: CART })
}

export async function getOrders() {
  return storeCall(Store.getOrders)
}

// Placing an order empties the cart and adds to the orders (#910): those two are revalidated.
export async function placeOrder() {
  return respond(await storeCall(Store.placeOrder), { revalidate: [CART, ORDERS] })
}

/** The visitor's name, as the shared wishlist shows who moved what. */
export async function getVisitorName() {
  return visitor().name
}

/** Move a piece of the shared wishlist to just after another, or first: applied to its order as it is now. */
export async function moveInSharedWishlist(productId: string, after: string | null) {
  return storeCall(Store.moveWishlistItem("shared", productId, after))
}

export async function resetSharedWishlist() {
  return storeCall(Store.resetWishlist("shared"))
}

export async function getNotices() {
  return storeCall(Store.getNotices)
}

export async function dismissNotice(id: string) {
  return storeCall(Store.dismissNotice(id))
}

export async function restoreNotices() {
  return storeCall(Store.restoreNotices)
}

export async function getSettings() {
  return storeCall(Store.getSettings)
}

// Saving the switches revalidates them alone: a sweep of every query would spend "fail the next request" on one.
export async function setSettings(settings: Store.Settings) {
  return respond(await storeCall(Store.setSettings(settings)), { revalidate: SETTINGS })
}
