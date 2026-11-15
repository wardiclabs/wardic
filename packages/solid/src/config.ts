/**
 * The Solid bindings' configuration types (#209): what an element's `initial`, `animate`,
 * `transition`, variants, gestures, drag and layout props take, for the Solid 1 binding and the
 * Solid 2 one (`@wardic/solid/unstable/v2`) alike.
 *
 * @module
 */
// #672 (the build grill's Q24 A): the DOM's half is `@wardic/dom/unstable/WardConfig`, which re-exports
// core's half (`@wardic/core/unstable/Config`) and fills its `ValueKeys` with the DOM's keys. Solid's
// modules import both through here until each has moved.
export * from "@wardic/dom/unstable/WardConfig"
