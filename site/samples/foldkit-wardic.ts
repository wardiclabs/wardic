/**
 * The Foldkit samples' `~/lib/wardic.ts` (#795), as an app's is: the Handle, made once at module scope,
 * with the Features the samples use. Only typechecked (`tsconfig.foldkit.json`): the site runs the Solid
 * 2 samples, whose `~/lib/wardic.ts` is `src/lib/wardic.ts`. A sample that needs a Feature the others
 * don't makes a Handle of its own.
 */
import { DomLive } from "@wardic/dom"
import { Features, Wardic } from "@wardic/foldkit"

export const wardic = Wardic.make({ env: DomLive, features: Features.domAnimation })
