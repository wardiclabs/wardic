/**
 * The `drag` Feature, for an `import()` (#526): Shipping less's room loads it when you press
 * Rearrange. A module of its own, so the import names this module alone, and `drag`'s code is a chunk
 * the page fetches then, not part of what it loads with the route.
 */
export { drag } from "@wardic/solid/unstable/v2"
