/**
 * The Wardic instance of a page that lays out (#516): `layout` beside `domAnimation`. Only the pages
 * that import it ship the projection system; its `useAnimateLayout` brings `layout` too.
 */
import { createWardic, domAnimation, layout } from "@wardic/solid/unstable/v2"

export const { w, useAnimateLayout } = createWardic([domAnimation, layout])
