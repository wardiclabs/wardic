/**
 * The site's Wardic instance (#516): `domAnimation` for its frame and every sample, as an app's
 * `src/lib/wardic.ts` is. A sample that drags or lays out makes its own; the frame's sidebar marker,
 * which lays out, is `wardic-layout.ts`'s.
 */
import { createWardic, domAnimation } from "@wardic/solid/unstable/v2"

export const { w } = createWardic(domAnimation)
