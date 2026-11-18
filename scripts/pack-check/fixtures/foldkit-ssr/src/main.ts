import { Runtime } from "foldkit"
import { app, BUILD_ID, wardic } from "./app.ts"

// The client entry of a server-rendered page: the Handle's `hydrate` in place of `Runtime.hydrate`, with
// the server's build id. No container: the placeholder `#app` was replaced by the rendered root, which
// Foldkit finds by its stamp.
wardic.hydrate(Runtime.makeApplication({ ...app, container: null }), { buildId: BUILD_ID })
