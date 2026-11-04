/**
 * The `layout` Feature, imported lazily by the shell's cart fly-in (#526): a flight starts from a page
 * that lays out, which has loaded it already, so the import resolves from the module cache and the
 * pages that don't lay out never fetch the projection engine.
 */
export { layout } from "@wardic/solid/unstable/v2"
