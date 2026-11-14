/**
 * The Wardic instance of a page that drags and lays out (#516): `drag` and `layout` beside
 * `domAnimation`.
 */
import { createWardic, domAnimation, drag, layout } from "@wardic/solid"

export const { w } = createWardic([domAnimation, drag, layout])
