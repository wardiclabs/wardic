/**
 * The program (#795): `init` from the Flags the server rendered with and the URL; `update` for the
 * app's own Messages and each page's, wrapped; the view in the shop's frame; the pages' subscriptions
 * lifted under the route; the routing. The same module on the server (`renderToString`) and the
 * client (`wardic.hydrate`).
 */
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as UndefinedOr from "effect/UndefinedOr"
import * as Command from "foldkit/command"
import type { Document, HtmlBuilder } from "foldkit/html"
import * as Navigation from "foldkit/navigation"
import * as Subscription from "foldkit/subscription"
import * as Url from "foldkit/url"
import type * as Update from "foldkit/update"
import { exampleById } from "@wardic/example-storefront-shared/examples"
import { Settings } from "@wardic/example-storefront-shared/server"
import * as Match from "effect/Match"
import { wardic } from "~/lib/wardic.ts"
import { type Arrival, type Flags, Message, type Model, type PageState, Prefs, REDUCE_MOTION_COOKIE, Theme, THEME_COOKIE } from "~/model.ts"
import type { AnyPage, PageEnv, PageOut, PageServices } from "~/page.ts"
import { pageOf, PAGES } from "~/pages.ts"
import { AppRoute, exampleOf, urlToRoute } from "~/routes.ts"
import { Shop } from "~/shop.ts"
import { ShopClient } from "~/shop/client.ts"
import { asked } from "~/shop/text.ts"
import { examplePage, notFound } from "~/views/example-page.ts"
import { gallery } from "~/views/gallery.ts"
import { shell } from "~/views/shell.ts"
import { titleOf } from "~/views/words.ts"

type Return = Update.Return<Model, Message, PageServices>

const NONE: PageState = { _tag: "None" }

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" }

/** The theme on the document, as the stylesheet reads it; the system's leaves it off. */
const applyTheme = (theme: Theme): void => {
  if (theme === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

/** A cookie the server reads on the next request, for a year. */
const cookie = (name: string, value: string): string => `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`

// The Commands: navigation, the visitor's switches, the store, and a page's data.
const PushUrl = Command.define("PushUrl", { args: { url: Schema.String }, messages: [Message.Navigated], execute: ({ url }) => Navigation.pushUrl(url).pipe(Effect.as(Message.Navigated())) })
const Load = Command.define("Load", { args: { href: Schema.String }, messages: [Message.Navigated], execute: ({ href }) => Navigation.load(href).pipe(Effect.as(Message.Navigated())) })
const ScrollTop = Command.define("ScrollTop", { messages: [Message.Navigated], execute: Effect.sync(() => window.scrollTo(0, 0)).pipe(Effect.as(Message.Navigated())) })
const SavePrefs = Command.define("SavePrefs", {
  args: { prefs: Prefs },
  messages: [Message.PrefsSaved],
  execute: ({ prefs }) =>
    Effect.sync(() => {
      document.cookie = cookie(THEME_COOKIE, prefs.theme)
      document.cookie = cookie(REDUCE_MOTION_COOKIE, String(prefs.reduceMotion))
      applyTheme(prefs.theme)
    }).pipe(Effect.as(Message.PrefsSaved())),
})
/** At init, on the client: the theme the Flags carried onto the document, and the system's reduced-motion setting read. */
const ApplyPrefs = Command.define("ApplyPrefs", {
  args: { theme: Theme },
  messages: [Message.SystemMotion],
  execute: ({ theme }) =>
    Effect.sync(() => {
      applyTheme(theme)
      return Message.SystemMotion({ reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches })
    }),
})
const SaveSettings = Command.define("SaveSettings", {
  args: { settings: Settings },
  messages: [Message.SettingsSaved, Message.SettingsFailed],
  execute: ({ settings }) =>
    asked(
      Shop.use((shop) => shop.setSettings(settings)),
      (saved) => Message.SettingsSaved({ settings: saved }),
      (reason) => Message.SettingsFailed({ reason }),
    ),
})
/** A page's first-paint data, for a page reached by a link; a later navigation interrupts it. */
const LoadPage = Command.define("LoadPage", {
  args: { id: Schema.String },
  messages: [Message.PageLoaded, Message.PageFailed],
  interrupt: true,
  execute: ({ id }) =>
    Option.match(pageOf(id), {
      onNone: () => Effect.succeed(Message.PageFailed({ id, reason: `No page for "${id}".` })),
      onSome: (page) =>
        asked(
          page.load,
          (data) => Message.PageLoaded({ id, data }),
          (reason) => Message.PageFailed({ id, reason }),
        ),
    }),
})
const LoadCode = Command.define("LoadCode", {
  args: { id: Schema.String },
  messages: [Message.CodeLoaded, Message.CodeFailed],
  interrupt: true,
  execute: ({ id }) =>
    asked(
      Shop.use((shop) => shop.highlighted(id)),
      (code) => Message.CodeLoaded({ id, code }),
      (reason) => Message.CodeFailed({ id, reason }),
    ),
})

/** Whether `model`'s page is `id`'s, loading or loaded: a route that stays on the example keeps it. */
const onExample = (model: Model, id: string): boolean => model.page._tag !== "None" && model.page.id === id

/** An example's page, entered: loading, with its Commands; kept where the route stays on it (the catalogue's pieces). */
const enteringExample = (model: Model, route: AppRoute, id: string, path: string): Return => {
  if (Predicate.isUndefined(exampleById(id)) || Option.isNone(pageOf(id))) return { model: { ...model, route: AppRoute.NotFound({ path }), page: NONE, code: null } }
  if (onExample(model, id)) return { model: { ...model, route } }
  return { model: { ...model, route, page: { _tag: "Loading", id }, code: null }, commands: [LoadPage({ id }), LoadCode({ id })] }
}

/** The page under `route`, from the Flags where they carry it; else loading, with its Commands. */
const entering = (model: Model, route: AppRoute): Return =>
  AppRoute.match(route, {
    Home: (): Return => ({ model: { ...model, route, page: NONE, code: null } }),
    NotFound: (): Return => ({ model: { ...model, route, page: NONE, code: null } }),
    Example: ({ area, id }): Return => enteringExample(model, route, id, `/${area}/${id}`),
    Piece: ({ area, id, piece }): Return => enteringExample(model, route, id, `/${area}/${id}/${piece}`),
  })

/** What the app gives a page: whether motion is reduced, by the system or the header's switch (#388), the visitor's name, the route's piece and the URL's query. */
const envOf = (model: Model): PageEnv => ({
  reduceMotion: Bool.or(model.prefs.reduceMotion, model.systemReducedMotion),
  visitorName: model.visitorName,
  piece: Option.match(exampleOf(model.route), { onNone: () => null, onSome: ({ piece }) => piece }),
  query: model.query,
})

/** The URL's query, as the Model keeps it: `""` without one. */
const queryOf = (url: Url.Url): string => Option.getOrElse(url.search, () => "")

/** What a page told the app, applied: the cart, or a piece's twin in the cart button, arriving or recalled. */
const told = (model: Model, out: PageOut): Model =>
  Match.value(out).pipe(
    Match.tag("CartChanged", ({ cart }) => ({ ...model, cart })),
    Match.tag("Arriving", ({ id, src }) => ({ ...model, arrivals: [...model.arrivals.filter((one) => one.id !== id), { id, src }] })),
    Match.tag("Recalled", ({ id }) => ({ ...model, arrivals: model.arrivals.filter((one) => one.id !== id) })),
    Match.exhaustive,
  )

/** The page under the route, loaded, when it's `id`'s, with its definition. */
const loadedPage = (model: Model, id: string): Option.Option<{ readonly page: Extract<PageState, { readonly _tag: "Loaded" }>; readonly definition: AnyPage }> => {
  const page = model.page
  if (page._tag !== "Loaded" || page.id !== id) return Option.none()
  return Option.map(pageOf(id), (definition) => ({ page, definition }))
}

/** A page's own Message, for the page under the route, if it's still the one it was sent to. */
const pageMessage = (model: Model, id: string, message: unknown): Return =>
  Option.match(loadedPage(model, id), {
    onNone: () => ({ model }),
    onSome: ({ page, definition }) => {
      if (!Schema.is(definition.Message)(message)) return { model }
      const next = definition.update(page.model, message, envOf(model))
      const withPage: Model = { ...model, page: { ...page, model: next.model } }
      return {
        model: UndefinedOr.match(next.outMessage, { onUndefined: () => withPage, onDefined: (out) => told(withPage, out) }),
        commands: Command.mapMessages(next.commands, (inner) => Message.Page({ id, message: inner })),
      }
    },
  })

export const init = (flags: Flags, url: Url.Url): Return => {
  const route = urlToRoute(url)
  const base: Model = {
    route,
    query: queryOf(url),
    prefs: flags.prefs,
    themeSwitches: 0,
    visitorName: flags.visitorName,
    settings: flags.settings,
    settingsOpen: false,
    settingsProblem: null,
    cart: flags.cart,
    arrivals: [],
    systemReducedMotion: false,
    page: NONE,
    code: flags.code,
  }
  // On the client, after hydration: the theme onto the document, the system's setting read. The server runs no Command.
  const commands = [ApplyPrefs({ theme: flags.prefs.theme })]
  const carried = flags.page
  const on = exampleOf(route)
  if (Option.isSome(on) && carried !== null && carried.id === on.value.id) {
    const { id } = on.value
    const data = carried.data
    return Option.match(pageOf(id), {
      onNone: () => entering(base, route),
      onSome: (page) => ({ model: { ...base, page: { _tag: "Loaded", id, data, model: page.init(data), run: 1 } }, commands }),
    })
  }
  const entered = entering(base, route)
  return { model: entered.model, commands: [...commands, ...(entered.commands ?? [])] }
}

export const update = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    RequestedUrl: ({ request }) =>
      Navigation.UrlRequest.match(request, {
        Internal: ({ url }) => ({ model, commands: [PushUrl({ url: Url.toString(url) })] }),
        External: ({ href }) => ({ model, commands: [Load({ href })] }),
      }),
    ChangedUrl: ({ url }) => {
      const route = urlToRoute(url)
      const entered = entering({ ...model, query: queryOf(url), settingsOpen: false }, route)
      // A route that stays on the example (the catalogue's pieces) keeps the page's scroll: the demo sits partway down it.
      const stays = Option.match(exampleOf(route), { onNone: () => false, onSome: ({ id }) => onExample(model, id) })
      return { model: entered.model, commands: [...(entered.commands ?? []), ...(stays ? [] : [ScrollTop()])] }
    },
    Navigated: () => ({ model }),
    SetReduceMotion: ({ on }) => {
      const prefs = { ...model.prefs, reduceMotion: on }
      return { model: { ...model, prefs }, commands: [SavePrefs({ prefs })] }
    },
    CycleTheme: () => {
      const prefs = { ...model.prefs, theme: NEXT_THEME[model.prefs.theme] }
      return { model: { ...model, prefs, themeSwitches: model.themeSwitches + 1 }, commands: [SavePrefs({ prefs })] }
    },
    PrefsSaved: () => ({ model }),
    SystemMotion: ({ reduced }) => ({ model: { ...model, systemReducedMotion: reduced } }),
    ToggleSettings: () => ({ model: { ...model, settingsOpen: Bool.not(model.settingsOpen), settingsProblem: null } }),
    // Switched at once: the store answers after its delay, and refuses when asked to.
    SaveSettings: ({ settings }) => ({ model: { ...model, settings, settingsProblem: null }, commands: [SaveSettings({ settings })] }),
    SettingsSaved: ({ settings }) => ({ model: { ...model, settings } }),
    SettingsFailed: ({ reason }) => ({ model: { ...model, settingsProblem: reason } }),
    PageLoaded: ({ id, data }) => {
      if (model.page._tag !== "Loading" || model.page.id !== id) return { model }
      return Option.match(pageOf(id), {
        onNone: () => ({ model }),
        onSome: (page) => ({ model: { ...model, page: { _tag: "Loaded", id, data, model: page.init(data), run: 1 } } }),
      })
    },
    PageFailed: ({ id, reason }) => {
      if (model.page._tag !== "Loading" || model.page.id !== id) return { model }
      return { model: { ...model, page: { _tag: "Failed", id, reason } } }
    },
    CodeLoaded: ({ id, code }) => {
      if (model.route._tag !== "Example" || model.route.id !== id) return { model }
      return { model: { ...model, code } }
    },
    CodeFailed: () => ({ model }),
    Page: ({ id, message }) => pageMessage(model, id, message),
    Replay: () => {
      if (model.page._tag !== "Loaded") return { model }
      return Option.match(loadedPage(model, model.page.id), {
        onNone: () => ({ model }),
        onSome: ({ page, definition }) => ({ model: { ...model, page: { ...page, model: definition.init(page.data), run: page.run + 1 }, arrivals: [] } }),
      })
    },
    Landed: ({ id }) => ({ model: { ...model, arrivals: model.arrivals.filter((one: Arrival) => one.id !== id) } }),
  })

/** The page's title: the example's, or the shop's. */
const documentTitleOf = (model: Model): string =>
  Option.match(Option.flatMap(exampleOf(model.route), ({ id }) => Option.fromUndefinedOr(exampleById(id))), {
    onNone: () => "Wardic Northlight · Foldkit",
    onSome: (example) => `${titleOf(example)} · Wardic Northlight`,
  })

const content = (model: Model, h: HtmlBuilder<Message>) =>
  AppRoute.match(model.route, {
    Home: () => gallery(h),
    Example: ({ id }) => examplePage(model, h, id, envOf(model)),
    Piece: ({ id }) => examplePage(model, h, id, envOf(model)),
    NotFound: () => notFound(h),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({ title: documentTitleOf(model), body: shell(model, h, content(model, h)) })

/** Each page's subscriptions, live while its page is the one under the route. */
const lifted = (page: AnyPage) => {
  const own = page.subscriptions
  if (own === undefined) return []
  return [
    Subscription.lift(own)<Model, Message>({
      read: (model) => Option.map(loadedPage(model, page.id), (loaded) => loaded.page.model),
      toParentMessage: (message) => Message.Page({ id: page.id, message }),
    }),
  ]
}

export const subscriptions = Subscription.aggregate<Model, Message, PageServices>()(...PAGES.flatMap(lifted))

export const routing = { onUrlRequest: (request: Navigation.UrlRequest) => Message.RequestedUrl({ request }), onUrlChange: (url: Url.Url) => Message.ChangedUrl({ url }) }

/** What the Commands run on: Wardic's service for the Handle, and the store over the wire. */
export const resources = Layer.merge(wardic.resources, ShopClient)
