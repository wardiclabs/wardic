/**
 * The app's routes (#795, Q6): the gallery at `/`, each example at `/<area>/<id>`, a piece of the
 * catalogue at `/<area>/<id>/<piece>` (the transitions area's routes of its own), and what fits none.
 * Foldkit's parsers print them too: `exampleRouter({ area, id })` is an example's path.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { pipe } from "effect/Function"
import { defineRouteUnion, mapTo, oneOf, parseUrlWithFallback, root, slash, string } from "foldkit/route"

export const AppRoute = defineRouteUnion({
  Home: {},
  Example: { area: Schema.String, id: Schema.String },
  Piece: { area: Schema.String, id: Schema.String, piece: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const exampleRouter = pipe(string("area"), slash(string("id")), mapTo(AppRoute.Example))
export const pieceRouter = pipe(string("area"), slash(string("id")), slash(string("piece")), mapTo(AppRoute.Piece))

/** A URL's route: the first parser that takes every segment, else `NotFound`. */
export const urlToRoute = parseUrlWithFallback(oneOf(pieceRouter, exampleRouter, homeRouter), AppRoute.NotFound)

/** The example a route is on, with the piece under it where there is one. */
export const exampleOf = (route: AppRoute): Option.Option<{ readonly id: string; readonly piece: string | null }> =>
  AppRoute.match(route, {
    Home: () => Option.none(),
    NotFound: () => Option.none(),
    Example: ({ id }) => Option.some({ id, piece: null }),
    Piece: ({ id, piece }) => Option.some({ id, piece }),
  })
