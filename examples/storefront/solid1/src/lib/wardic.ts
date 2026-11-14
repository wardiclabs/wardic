/**
 * The storefront's Wardic instance (#516): `domAnimation`, the shell's and every page's hover, press,
 * focus and in-view. A page that lays out, drags or pans imports one of its own instead, so a page that
 * does none ships none of their code.
 */
import { createWardic, domAnimation } from "@wardic/solid"

export const { w } = createWardic(domAnimation)
