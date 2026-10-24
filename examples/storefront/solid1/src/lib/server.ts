"use server"
/**
 * The app's server functions (#296): each one a thin wrapper over the shared store, in Effect
 * (`@wardic/example-storefront-shared/server`). It reads the visitor from their cookie, then runs the
 * store's call for them, which decodes the arguments it was sent and answers or rejects with a
 * message a person can read.
 */
import { getCookie, setCookie } from "@solidjs/start/http"
import * as Store from "@wardic/example-storefront-shared/server"
import { codeToHtml } from "shiki"

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

/** Each demo's source, read here on the server, so the browser never downloads it to show it. */
const SOURCES = import.meta.glob<string>("../examples/*/Demo.tsx", { query: "?raw", import: "default", eager: true })

/** Each Motion snippet (#296 Q4), read here on the server too: typechecked against `motion` in the shared package. */
const MOTION = import.meta.glob<string>("../../../shared/motion/*.tsx", { query: "?raw", import: "default", eager: true })

/** A Motion snippet, highlighted for both themes, for an example's "Coming from Motion" panel. */
export async function highlightedMotion(file: string) {
  const source = MOTION[`../../../shared/motion/${file}`]
  if (source === undefined) throw new Error(`No Motion snippet "${file}"`)
  return codeToHtml(source, { lang: "tsx", themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
}

/** An example's demo, highlighted for both themes: HTML the code panel shows as it is. */
export async function highlightedSource(exampleId: string) {
  const source = SOURCES[`../examples/${exampleId}/Demo.tsx`]
  if (source === undefined) throw new Error(`No demo for "${exampleId}"`)
  return codeToHtml(source, { lang: "tsx", themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
}
