/**
 * The app's routes (#795, Q6): the gallery at `/`, each example at `/<area>/<id>`, and what fits
 * neither. Foldkit's parsers print them too: `exampleRouter({ area, id })` is an example's path.
 */
import * as Schema from "effect/Schema"
import { pipe } from "effect/Function"
import { defineRouteUnion, mapTo, oneOf, parseUrlWithFallback, root, slash, string } from "foldkit/route"

export const AppRoute = defineRouteUnion({ Home: {}, Example: { area: Schema.String, id: Schema.String }, NotFound: { path: Schema.String } })
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const exampleRouter = pipe(string("area"), slash(string("id")), mapTo(AppRoute.Example))

/** A URL's route: the first parser that takes every segment, else `NotFound`. */
export const urlToRoute = parseUrlWithFallback(oneOf(exampleRouter, homeRouter), AppRoute.NotFound)
