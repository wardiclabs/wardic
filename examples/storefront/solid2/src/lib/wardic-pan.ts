/**
 * The Wardic instance of a page that pans (#516): `pan` beside `domAnimation`.
 */
import { createWardic, domAnimation, pan } from "@wardic/solid/unstable/v2"

export const { w } = createWardic([domAnimation, pan])
