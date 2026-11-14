/**
 * The Wardic instance of a page that drags (#516): `drag` beside `domAnimation`. Only the pages that
 * import it ship the drag track.
 */
import { createWardic, domAnimation, drag } from "@wardic/solid"

export const { w } = createWardic([domAnimation, drag])
