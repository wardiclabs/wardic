// The router, from the file-system route manifest (filesystem-routing): src/routes.
import { createRouter } from "@solidjs/router"
import { fileRoutes } from "@solidjs/router/fs"
import { pageRoutes } from "virtual:file-routes"

export const Router = createRouter({ routes: fileRoutes(pageRoutes) })

export const { paths } = Router
