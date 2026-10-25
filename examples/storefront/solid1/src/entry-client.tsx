// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { hydrateWhenAsked } from "@wardic/example-storefront-shared/hydration"

// At once, unless the page asks otherwise (#388): `?hydrate=2000` mounts two seconds late and
// `?hydrate=off` never, so the before-hydration example can show what plays without the JavaScript.
hydrateWhenAsked(() => mount(() => <StartClient />, document.getElementById("app")!))
