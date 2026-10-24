/**
 * The app's data, as Solid Router's queries over the server functions (`server/store.ts`): what pages
 * read through an async memo, cached by key. A call that changes the store revalidates them itself
 * (the router applies every non-GET server function's response).
 */
import { query } from "@solidjs/router"
import * as Server from "~/server/store.ts"

export const products = query((category?: string) => Server.listProducts(category), "products")

export const product = query((id: string) => Server.getProduct(id), "product")

export const cart = query(() => Server.getCart(), "cart")

export const orders = query(() => Server.getOrders(), "orders")

export const settings = query(() => Server.getSettings(), "settings")

export const visitorName = query(() => Server.getVisitorName(), "visitor-name")

export const notices = query(() => Server.getNotices(), "notices")
