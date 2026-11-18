/**
 * The client entry (#795, Q4): the Handle's `hydrate` in place of Foldkit's, on the page the server
 * rendered, at once or as `?hydrate=` asks (#388). The build id is the plugin's, compiled into both
 * sides.
 */
import "@wardic/example-storefront-shared/styles.css"
import { hydrateWhenAsked } from "@wardic/example-storefront-shared/hydration"
import * as Runtime from "foldkit/runtime"
import { init, resources, routing, subscriptions, update, view } from "~/app.ts"
import { wardic } from "~/lib/wardic.ts"
import { Flags, Model } from "~/model.ts"

hydrateWhenAsked(() => wardic.hydrate(Runtime.makeApplication({ Model, Flags, init, update, view, subscriptions, routing, resources, container: null })))
