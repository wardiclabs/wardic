/**
 * The plugin's `start.clientSetup` (#388): its generated client entry imports this before it
 * hydrates, and waits for this await to settle. At once, unless the page asks otherwise:
 * `?hydrate=2000` hydrates two seconds late and `?hydrate=off` never, so the before-hydration
 * example can show what plays without the JavaScript. (An authored `src/entry-client.tsx` would
 * need an authored server entry beside it, with the server components' wiring.)
 */
import { hydrateWhenAsked } from "@wardic/example-storefront-shared/hydration"

await new Promise<void>((resolve) => hydrateWhenAsked(resolve))
