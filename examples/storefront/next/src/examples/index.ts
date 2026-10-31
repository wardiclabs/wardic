/**
 * The examples this app has in Motion (#366), by id: each one's `Demo`, from its folder. Every file
 * in the folder is what the Solid apps show beside their own code, in the "Motion · Next.js" tab.
 */
import type { ComponentType } from "react"
import AddToCart from "./add-to-cart/Demo.tsx"
import Announcements from "./announcements/Demo.tsx"
import BeforeHydration from "./before-hydration/Demo.tsx"
import Browse from "./browse/Demo.tsx"
import CartDrawer from "./cart-drawer/Demo.tsx"
import DeliveryFaq from "./delivery-faq/Demo.tsx"
import DetailsTabs from "./details-tabs/Demo.tsx"
import Gallery from "./gallery/Demo.tsx"
import Magnifier from "./magnifier/Demo.tsx"
import Notifications from "./notifications/Demo.tsx"
import Parallax from "./parallax/Demo.tsx"
import OrderHistory from "./order-history/Demo.tsx"
import ProductDetail from "./product-detail/Demo.tsx"
import ProductGrid from "./product-grid/Demo.tsx"
import ProductTabs from "./product-tabs/Demo.tsx"
import QuickView from "./quick-view/Demo.tsx"
import ReadingProgress from "./reading-progress/Demo.tsx"
import Reveals from "./reveals/Demo.tsx"
import SavedForLater from "./saved/Demo.tsx"
import SizeGuide from "./size-guide/Demo.tsx"
import SortBy from "./sort-by/Demo.tsx"
import Spotlight from "./spotlight/Demo.tsx"
import Stock from "./stock/Demo.tsx"
import Toasts from "./toasts/Demo.tsx"
import SharedWishlist from "./wishlist/Demo.tsx"

export const DEMOS: Readonly<Record<string, ComponentType>> = {
  "product-grid": ProductGrid,
  stock: Stock,
  "product-detail": ProductDetail,
  browse: Browse,
  "product-tabs": ProductTabs,
  "add-to-cart": AddToCart,
  "delivery-faq": DeliveryFaq,
  "cart-drawer": CartDrawer,
  "order-history": OrderHistory,
  notifications: Notifications,
  wishlist: SharedWishlist,
  toasts: Toasts,
  gallery: Gallery,
  "quick-view": QuickView,
  saved: SavedForLater,
  magnifier: Magnifier,
  "reading-progress": ReadingProgress,
  parallax: Parallax,
  reveals: Reveals,
  spotlight: Spotlight,
  announcements: Announcements,
  "before-hydration": BeforeHydration,
  "size-guide": SizeGuide,
  "sort-by": SortBy,
  "details-tabs": DetailsTabs,
}
