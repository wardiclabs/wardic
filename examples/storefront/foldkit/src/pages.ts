/** The examples' pages, by id (#795): each a module under `examples/<id>/Demo.ts`. */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import AddToCart from "~/examples/add-to-cart/Demo.ts"
import ArrangeRoom from "~/examples/arrange-room/Demo.ts"
import Browse from "~/examples/browse/Demo.ts"
import CartDrawer from "~/examples/cart-drawer/Demo.ts"
import DeliveryFaq from "~/examples/delivery-faq/Demo.ts"
import Gallery from "~/examples/gallery/Demo.ts"
import Notifications from "~/examples/notifications/Demo.ts"
import OrderHistory from "~/examples/order-history/Demo.ts"
import ProductDetail from "~/examples/product-detail/Demo.ts"
import ProductGrid from "~/examples/product-grid/Demo.ts"
import ProductTabs from "~/examples/product-tabs/Demo.ts"
import QuickView from "~/examples/quick-view/Demo.ts"
import Saved from "~/examples/saved/Demo.ts"
import Stock from "~/examples/stock/Demo.ts"
import Toasts from "~/examples/toasts/Demo.ts"
import Wishlist from "~/examples/wishlist/Demo.ts"
import type { AnyPage } from "~/page.ts"

export const PAGES: ReadonlyArray<AnyPage> = [ProductGrid, Stock, ProductDetail, Browse, ProductTabs, AddToCart, DeliveryFaq, CartDrawer, OrderHistory, Notifications, Wishlist, ArrangeRoom, Toasts, Gallery, QuickView, Saved]

export const pageOf = (id: string): Option.Option<AnyPage> => Arr.findFirst(PAGES, (page) => page.id === id)
