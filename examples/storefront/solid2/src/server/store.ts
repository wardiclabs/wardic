"use server"
/**
 * The app's server functions (#296): each a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`), for the visitor the middleware put on the request.
 * The store decodes the arguments it was sent, and answers or rejects with a message a person can
 * read.
 */
import { getRequestEvent } from "@solidjs/web"
import * as Store from "@wardic/example-storefront-shared/server"

/** The visitor the middleware found or made for this request. */
const visitor = (): Store.VisitorInfo => {
  const known = getRequestEvent()?.locals.visitor as Store.VisitorInfo | undefined
  if (known === undefined) throw new Error("No visitor on the request: is the middleware wired?")
  return known
}

export async function listProducts(category?: string) {
  return Store.runFor(visitor(), Store.listProducts(category))
}

export async function getProduct(id: string) {
  return Store.runFor(visitor(), Store.getProduct(id))
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

export async function getSettings() {
  return Store.runFor(visitor(), Store.getSettings)
}

export async function setSettings(settings: Store.Settings) {
  return Store.runFor(visitor(), Store.setSettings(settings))
}
