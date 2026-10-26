"use server"
/**
 * The app's server functions (#296): each a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`), for the visitor the middleware put on the request.
 * The store decodes the arguments it was sent, and answers or rejects with a message a person can
 * read.
 */
import * as Store from "@wardic/example-storefront-shared/server"
import { visitor } from "./visitor.ts"

export async function listProducts(category?: string) {
  return Store.runFor(visitor(), Store.listProducts(category))
}

export async function getProduct(id: string) {
  return Store.runFor(visitor(), Store.getProduct(id))
}

export async function getStock(when: "now" | "delivery") {
  return Store.runFor(visitor(), Store.getStock(when))
}

export async function getCart() {
  return Store.runFor(visitor(), Store.getCart)
}

export async function addToCart(productId: string, quantity: number) {
  return Store.runFor(visitor(), Store.addToCart(productId, quantity))
}

export async function setCartQuantity(productId: string, quantity: number) {
  return Store.runFor(visitor(), Store.setCartQuantity(productId, quantity))
}

export async function getOrders() {
  return Store.runFor(visitor(), Store.getOrders)
}

/** The visitor's name, as the shared wishlist shows who moved what. */
export async function getVisitorName() {
  return visitor().name
}

/** Move a piece of the shared wishlist to just after another, or first: applied to its order as it is now. */
export async function moveInSharedWishlist(productId: string, after: string | null) {
  return Store.runFor(visitor(), Store.moveWishlistItem("shared", productId, after))
}

export async function resetSharedWishlist() {
  return Store.runFor(visitor(), Store.resetWishlist("shared"))
}

export async function getNotices() {
  return Store.runFor(visitor(), Store.getNotices)
}

export async function dismissNotice(id: string) {
  return Store.runFor(visitor(), Store.dismissNotice(id))
}

export async function restoreNotices() {
  return Store.runFor(visitor(), Store.restoreNotices)
}

export async function getSettings() {
  return Store.runFor(visitor(), Store.getSettings)
}

export async function setSettings(settings: Store.Settings) {
  return Store.runFor(visitor(), Store.setSettings(settings))
}
