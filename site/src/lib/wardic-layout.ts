/**
 * The site frame's Wardic instance that lays out (#516): `layout` beside `domAnimation`, for the
 * sidebar's marker, which slides to the page you're on.
 */
import { createWardic, domAnimation, layout } from "@wardic/solid/unstable/v2"

export const { w } = createWardic([domAnimation, layout])
