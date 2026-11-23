/**
 * The router's cache keys (`lib/store.ts`), here so a server function can name the ones its mutation
 * changes (`server/store.ts`): Solid Router revalidates every query after a mutation that names none.
 */

/** The visitor's cart. */
export const CART = "cart"

/** The visitor's orders: placing one changes them (#910). */
export const ORDERS = "orders"

/**
 * The store's switches. Saving them revalidates them alone (#910): with none named, the router's
 * sweep after the save refetched every query, and with "fail the next request" just turned on, the
 * first of those took the failure meant for the visitor's next request.
 */
export const SETTINGS = "settings"
