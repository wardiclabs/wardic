"use server"
/**
 * The app's server functions (#296): each one a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`). It reads the visitor from their cookie, then runs the
 * store's call for them, which decodes the arguments it was sent and answers or rejects with a
 * message a person can read.
 */
import { getCookie, setCookie } from "@solidjs/start/http"
import { APPS, appUrl } from "@wardic/example-storefront-shared/apps"
import { highlightOptions, inShowingOrder } from "@wardic/example-storefront-shared/code"
import { exampleById, routeOf } from "@wardic/example-storefront-shared/examples"
import * as Store from "@wardic/example-storefront-shared/server"
import { codeToHtml } from "shiki"
import { getRequestEvent } from "solid-js/web"

const COOKIE = "storefront-visitor"

/** The visitor, from their cookie, given one on their first request. */
const visitor = (): Store.VisitorInfo => {
  const known = getCookie(COOKIE)
  if (known) return Store.visitorFromId(known)
  const id = crypto.randomUUID()
  setCookie(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 })
  return Store.visitorFromId(id)
}

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

export async function getMyWishlist() {
  return Store.runFor(visitor(), Store.getWishlist("mine"))
}

export async function moveInMyWishlist(productId: string, after: string | null) {
  return Store.runFor(visitor(), Store.moveWishlistItem("mine", productId, after))
}

export async function resetMyWishlist() {
  return Store.runFor(visitor(), Store.resetWishlist("mine"))
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

/** Each demo's source, read here on the server, so the browser never downloads it to show it. */
const SOURCES = import.meta.glob<string>("../examples/*/Demo.tsx", { query: "?raw", import: "default", eager: true })

/** Each example's Motion version (#366): every file in its folder in the Next.js app, read here too. */
const MOTION = import.meta.glob<string>("../../../next/src/examples/*/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })
const MOTION_SRC = "../../../next/src/"

/** A file, highlighted for both themes: HTML the code panel shows as it is. */
export interface Highlighted {
  readonly path: string
  readonly html: string
}

const highlight = async (path: string, source: string): Promise<Highlighted> => ({ path, html: await codeToHtml(source, highlightOptions(path)) })

/**
 * An example's code: its demo; Motion's version, every file in its folder in the Next.js app, its
 * `Demo.tsx` first (none until the app has it); and where that runs, on the host this page was
 * asked for.
 */
export async function highlightedCode(exampleId: string) {
  const source = SOURCES[`../examples/${exampleId}/Demo.tsx`]
  const example = exampleById(exampleId)
  if (source === undefined || example === undefined) throw new Error(`No demo for "${exampleId}"`)
  const keys = inShowingOrder(Object.keys(MOTION).filter((key) => key.startsWith(`${MOTION_SRC}examples/${exampleId}/`)))
  return {
    solid: await highlight(`examples/${exampleId}/Demo.tsx`, source),
    motion: await Promise.all(keys.map((key) => highlight(key.slice(MOTION_SRC.length), MOTION[key] as string))),
    run: appUrl(APPS.next, routeOf(example), getRequestEvent()?.request.headers.get("host"), process.env),
  }
}
