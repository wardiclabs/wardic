/**
 * The app's Model, Messages and Flags (#795, Q22): the route, the visitor's switches, the header's
 * store settings and cart, the page under the route, and its code panel. The Flags are what the
 * server rendered with, which the client hydrates from; a page reached by a link loads its own.
 */
import * as Schema from "effect/Schema"
import { defineMessageUnion } from "foldkit/message"
import { UrlRequest } from "foldkit/navigation"
import { Url } from "foldkit/url"
import { Cart, Settings } from "@wardic/example-storefront-shared/server"
import { AppRoute } from "~/routes.ts"
import { Code } from "~/shop.ts"

export const Theme = Schema.Literals(["system", "light", "dark"])
export type Theme = typeof Theme.Type

/** The cookies the switches keep, read by the server into the Flags (Q26). */
export const THEME_COOKIE = "storefront-theme"
export const REDUCE_MOTION_COOKIE = "storefront-reduce-motion"

/** The visitor's switches (#296 Q12), kept in cookies the server reads too. */
export const Prefs = Schema.Struct({ theme: Theme, reduceMotion: Schema.Boolean })
export type Prefs = typeof Prefs.Type

/** What the server renders a page with: the first paint's data, encoded into the page for the client. */
export const Flags = Schema.Struct({
  prefs: Prefs,
  visitorName: Schema.String,
  settings: Settings,
  cart: Cart,
  /** The route's example and what its page loads, when the route is an example's. */
  page: Schema.NullOr(Schema.Struct({ id: Schema.String, data: Schema.Unknown })),
  /** Its code panel, when the route is an example's. */
  code: Schema.NullOr(Code),
})
export type Flags = typeof Flags.Type

/** A piece arriving at the cart's icon: its photo. */
export const Arrival = Schema.Struct({ id: Schema.String, src: Schema.String })
export type Arrival = typeof Arrival.Type

/** The page under the route: none on the gallery; loading, failed or loaded on an example's. */
export const PageState = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("None") }),
  Schema.Struct({ _tag: Schema.Literal("Loading"), id: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Failed"), id: Schema.String, reason: Schema.String }),
  /** `data` is kept for Replay, which inits the page again; `run` keys the demo, so a replay mounts it afresh. */
  Schema.Struct({ _tag: Schema.Literal("Loaded"), id: Schema.String, data: Schema.Unknown, model: Schema.Unknown, run: Schema.Number }),
])
export type PageState = typeof PageState.Type

export const Model = Schema.Struct({
  route: AppRoute,
  prefs: Prefs,
  /** Each theme switch turns its icon half a turn on (#365). */
  themeSwitches: Schema.Number,
  visitorName: Schema.String,
  settings: Settings,
  settingsOpen: Schema.Boolean,
  settingsProblem: Schema.NullOr(Schema.String),
  cart: Cart,
  /** Pieces on their way to the cart's icon (Saved for later): each photo's twin flies there from its row (#526). */
  arrivals: Schema.Array(Arrival),
  /** The system's reduced-motion setting, read on the client at init; `false` as the server renders. */
  systemReducedMotion: Schema.Boolean,
  page: PageState,
  code: Schema.NullOr(Code),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  RequestedUrl: { request: UrlRequest },
  ChangedUrl: { url: Url },
  Navigated: {},
  SetReduceMotion: { on: Schema.Boolean },
  CycleTheme: {},
  PrefsSaved: {},
  ToggleSettings: {},
  SaveSettings: { settings: Settings },
  SettingsSaved: { settings: Settings },
  SettingsFailed: { reason: Schema.String },
  PageLoaded: { id: Schema.String, data: Schema.Unknown },
  PageFailed: { id: Schema.String, reason: Schema.String },
  CodeLoaded: { id: Schema.String, code: Code },
  CodeFailed: { id: Schema.String, reason: Schema.String },
  /** A page's own Message, wrapped: `id` names the page it's for, which may have left. */
  Page: { id: Schema.String, message: Schema.Unknown },
  Replay: {},
  /** A piece's twin landed in the cart's icon: it goes. */
  Landed: { id: Schema.String },
  SystemMotion: { reduced: Schema.Boolean },
})
export type Message = typeof Message.Type
