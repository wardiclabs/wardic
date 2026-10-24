/**
 * The app's data, as Solid Router's queries and actions over the server functions (`server.ts`):
 * what pages read with `createAsync`, cached by key, and what they change with `action`. An action
 * answers with `reload({ revalidate })`, naming the queries it changed: the router fetches those
 * again, and only those (an action that answers anything else has every query fetched again).
 */
import { action, query, reload } from "@solidjs/router"
import type { Settings } from "@wardic/example-storefront-shared/server"
import * as Server from "./server.ts"

export const products = query((category?: string) => Server.listProducts(category), "products")

export const product = query((id: string) => Server.getProduct(id), "product")

export const cart = query(() => Server.getCart(), "cart")

/** Add to the cart; the header's count and any open cart read it again. */
export const addToCart = action(async (productId: string, quantity: number) => {
  await Server.addToCart(productId, quantity)
  return reload({ revalidate: cart.key })
}, "add-to-cart")

/** Set a cart line's quantity; 0 removes it. */
export const setCartQuantity = action(async (productId: string, quantity: number) => {
  await Server.setCartQuantity(productId, quantity)
  return reload({ revalidate: cart.key })
}, "set-cart-quantity")

export const orders = query(() => Server.getOrders(), "orders")

export const wishlist = query(() => Server.getMyWishlist(), "wishlist")

/** Save a move in the visitor's wishlist: a piece put just after another, or first. */
export const moveInWishlist = action(async (productId: string, after: string | null) => {
  await Server.moveInMyWishlist(productId, after)
  return reload({ revalidate: wishlist.key })
}, "move-in-wishlist")

export const resetWishlist = action(async () => {
  await Server.resetMyWishlist()
  return reload({ revalidate: wishlist.key })
}, "reset-wishlist")

export const notices = query(() => Server.getNotices(), "notices")

export const dismissNotice = action(async (id: string) => {
  await Server.dismissNotice(id)
  return reload({ revalidate: notices.key })
}, "dismiss-notice")

export const restoreNotices = action(async () => {
  await Server.restoreNotices()
  return reload({ revalidate: notices.key })
}, "restore-notices")

export const settings = query(() => Server.getSettings(), "settings")

export const saveSettings = action(async (next: Settings) => {
  await Server.setSettings(next)
  return reload({ revalidate: settings.key })
}, "save-settings")

export const highlighted = query((exampleId: string) => Server.highlightedSource(exampleId), "highlighted")

export const highlightedMotion = query((file: string) => Server.highlightedMotion(file), "highlighted-motion")
