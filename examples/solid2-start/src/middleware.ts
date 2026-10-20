// The server's middleware chain (`start.middleware` in vite.config.ts): the file routes' API handlers
// (src/routes/api), as the `fullstack` template wires them. `createAPIHandler` answers the GET/POST/…
// exports of route modules and passes everything else down the chain; it speaks `(request, next)`,
// so it's adapted onto the event.
import type { StartMiddleware } from "@solidjs/vite-plugin"
import { createAPIHandler } from "filesystem-routing/api"
import routes from "virtual:file-routes"

const api = createAPIHandler(routes)

const handleAPI: StartMiddleware = (event, next) => api(event.request, next)

export default [handleAPI]
