/**
 * The app's data, as Solid Router's queries over the server functions (`server/store.ts`): what pages
 * read through an async memo, cached by key. Each takes its server function as it is, so the router
 * declares it a read (`GET`, its arguments in the URL); a call that changes the store is a `POST`,
 * whose response the router applies to these.
 */
import { query } from "@solidjs/router"
import * as Server from "~/server/store.ts"

export const products = query(Server.listProducts, "products")

export const product = query(Server.getProduct, "product")

export const cart = query(Server.getCart, "cart")

export const orders = query(Server.getOrders, "orders")

export const settings = query(Server.getSettings, "settings")

export const visitorName = query(Server.getVisitorName, "visitor-name")

export const notices = query(Server.getNotices, "notices")
