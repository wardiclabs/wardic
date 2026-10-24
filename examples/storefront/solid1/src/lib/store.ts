/**
 * The app's data, as Solid Router's queries and actions over the server functions (`server.ts`):
 * what pages read with `createAsync`, cached by key, and what they change with `action`.
 */
import { action, query, revalidate } from "@solidjs/router"
import type { Settings } from "@wardic/example-storefront-shared/server"
import * as Server from "./server.ts"

export const products = query((category?: string) => Server.listProducts(category), "products")

export const product = query((id: string) => Server.getProduct(id), "product")

export const cart = query(() => Server.getCart(), "cart")

/** Add to the cart; the header's count and any open cart read it again. */
export const addToCart = action(async (productId: string, quantity: number) => {
  await Server.addToCart(productId, quantity)
  return revalidate(cart.key)
}, "add-to-cart")

/** Set a cart line's quantity; 0 removes it. */
export const setCartQuantity = action(async (productId: string, quantity: number) => {
  await Server.setCartQuantity(productId, quantity)
  return revalidate(cart.key)
}, "set-cart-quantity")

export const orders = query(() => Server.getOrders(), "orders")

export const settings = query(() => Server.getSettings(), "settings")

export const saveSettings = action(async (next: Settings) => {
  await Server.setSettings(next)
  return revalidate(settings.key)
}, "save-settings")

export const highlighted = query((exampleId: string) => Server.highlightedSource(exampleId), "highlighted")

export const highlightedMotion = query((file: string) => Server.highlightedMotion(file), "highlighted-motion")
