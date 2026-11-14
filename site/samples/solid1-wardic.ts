/**
 * The Solid 1 samples' `~/lib/wardic.ts` (#516), as an app's is: a Wardic instance of `domAnimation`. Only
 * typechecked: the site runs the Solid 2 samples, whose `~/lib/wardic.ts` is `src/lib/wardic.ts`.
 */
import { createWardic, domAnimation } from "@wardic/solid"

export const { w } = createWardic(domAnimation)
