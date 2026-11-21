/**
 * The router's cache keys (`lib/store.ts`), here so a server function can name the ones its mutation
 * changes (`server/store.ts`): Solid Router revalidates every query after a mutation that names none.
 */

/** The visitor's cart. */
export const CART = "cart"
