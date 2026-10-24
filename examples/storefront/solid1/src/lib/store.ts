/**
 * The app's data, as Solid Router's queries and actions over the server functions (`server.ts`):
 * what pages read with `createAsync`, cached by key, and what they change with `action`.
 */
import { action, query, revalidate } from "@solidjs/router"
import type { Settings } from "@wardic/example-storefront-shared/server"
import * as Server from "./server.ts"

export const products = query((category?: string) => Server.listProducts(category), "products")

export const cart = query(() => Server.getCart(), "cart")

export const settings = query(() => Server.getSettings(), "settings")

export const saveSettings = action(async (next: Settings) => {
  await Server.setSettings(next)
  return revalidate(settings.key)
}, "save-settings")

export const highlighted = query((exampleId: string) => Server.highlightedSource(exampleId), "highlighted")
