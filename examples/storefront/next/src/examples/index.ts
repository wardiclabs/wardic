/**
 * The examples this app has in Motion (#366), by id: each one's `Demo`, from its folder. Every file
 * in the folder is what the Solid apps show beside their own code, in the "Motion · Next.js" tab.
 */
import type { ComponentType } from "react"
import BeforeHydration from "./before-hydration/Demo.tsx"
import Gallery from "./gallery/Demo.tsx"
import Magnifier from "./magnifier/Demo.tsx"
import OrderHistory from "./order-history/Demo.tsx"
import SavedForLater from "./saved/Demo.tsx"
import Stock from "./stock/Demo.tsx"
import SharedWishlist from "./wishlist/Demo.tsx"

export const DEMOS: Readonly<Record<string, ComponentType>> = {
  stock: Stock,
  "order-history": OrderHistory,
  wishlist: SharedWishlist,
  gallery: Gallery,
  saved: SavedForLater,
  magnifier: Magnifier,
  "before-hydration": BeforeHydration,
}

export const hasDemo = (id: string): boolean => id in DEMOS
