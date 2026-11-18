/**
 * The Wardic instance of a page that drags (#516): `drag` beside `domAnimation`. Only the pages that
 * import it ship the drag track.
 */
import { createWardic, domAnimation, drag } from "@wardic/solid/v1"

export const { w } = createWardic([domAnimation, drag])
