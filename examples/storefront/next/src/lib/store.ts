"use server"
/**
 * The app's server actions (#366): each a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`), for the visitor the proxy put on the request, as the
 * Solid apps' server functions are. A write refreshes the page it came from, so the server
 * components that read the store (the header's cart count) render again with what it changed.
 */
import * as Store from "@wardic/example-storefront-shared/server"
import { refresh } from "next/cache"
import { visitor } from "./visitor.ts"

export async function listProducts(category?: string) {
  return Store.runFor(await visitor(), Store.listProducts(category))
}

export async function getProduct(id: string) {
  return Store.runFor(await visitor(), Store.getProduct(id))
}

export async function getStock(when: "now" | "delivery") {
  return Store.runFor(await visitor(), Store.getStock(when))
}

export async function getCart() {
  return Store.runFor(await visitor(), Store.getCart)
}

export async function addToCart(productId: string, quantity: number) {
  const cart = await Store.runFor(await visitor(), Store.addToCart(productId, quantity))
  refresh()
  return cart
}

export async function setCartQuantity(productId: string, quantity: number) {
  const cart = await Store.runFor(await visitor(), Store.setCartQuantity(productId, quantity))
  refresh()
  return cart
}

export async function getOrders() {
  return Store.runFor(await visitor(), Store.getOrders)
}

/** The visitor's name, as the shared wishlist shows who moved what. */
export async function getVisitorName() {
  return (await visitor()).name
}

export async function getSharedWishlist() {
  return Store.runFor(await visitor(), Store.getWishlist("shared"))
}

/** Move a piece of the shared wishlist to just after another, or first: applied to its order as it is now. */
export async function moveInSharedWishlist(productId: string, after: string | null) {
  return Store.runFor(await visitor(), Store.moveWishlistItem("shared", productId, after))
}

export async function resetSharedWishlist() {
  return Store.runFor(await visitor(), Store.resetWishlist("shared"))
}

export async function getNotices() {
  return Store.runFor(await visitor(), Store.getNotices)
}

export async function dismissNotice(id: string) {
  return Store.runFor(await visitor(), Store.dismissNotice(id))
}

export async function restoreNotices() {
  return Store.runFor(await visitor(), Store.restoreNotices)
}

export async function getSettings() {
  return Store.runFor(await visitor(), Store.getSettings)
}

export async function setSettings(settings: Store.Settings) {
  return Store.runFor(await visitor(), Store.setSettings(settings))
}
