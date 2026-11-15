/**
 * The few reactive primitives the Solid-free modules take from a binding's Solid (#209): the Solid 1
 * binding's (`./solid-reactivity.ts`) or the Solid 2 one's (`./unstable/v2/solid-reactivity.ts`).
 *
 * @module
 */
// #672: core's `unstable/Reactivity` since the lift; solid's modules import it through here until each
// has moved.
export type { Accessor, Reactivity, Trigger } from "@wardic/core/unstable/Reactivity"
