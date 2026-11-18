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
import { wardic } from "~/lib/wardic.ts"
import { type Arrival, type Flags, Message, type Model, type PageState, Prefs, type Theme } from "~/model.ts"
import type { PageEnv, PageOut, PageServices } from "~/page.ts"
import { pageOf, PAGES } from "~/pages.ts"
import { AppRoute, urlToRoute } from "~/routes.ts"
import { Shop, type ShopError } from "~/shop.ts"
import { ShopClient } from "~/shop/client.ts"
import { textOf } from "~/shop/text.ts"
import { examplePage, notFound } from "~/views/example-page.ts"
import { gallery } from "~/views/gallery.ts"
import { shell } from "~/views/shell.ts"

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
      document.cookie = cookie("storefront-theme", prefs.theme)
      document.cookie = cookie("storefront-reduce-motion", String(prefs.reduceMotion))
      applyTheme(prefs.theme)
    }).pipe(Effect.as(Message.PrefsSaved())),
})
/** At init, on the client: the theme the Flags carried onto the document, and the system's reduced-motion setting read. */
const ApplyPrefs = Command.define("ApplyPrefs", {
  args: { theme: Schema.Literals(["system", "light", "dark"]) },
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
    Shop.use((shop) => shop.setSettings(settings)).pipe(
      Effect.map((saved) => Message.SettingsSaved({ settings: saved })),
      Effect.catch((error) => Effect.succeed(Message.SettingsFailed({ reason: textOf(error) }))),
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
        page.load.pipe(
          Effect.map((data) => Message.PageLoaded({ id, data })),
          Effect.catch((error: ShopError) => Effect.succeed(Message.PageFailed({ id, reason: textOf(error) }))),
        ),
    }),
})
const LoadCode = Command.define("LoadCode", {
  args: { id: Schema.String },
  messages: [Message.CodeLoaded, Message.CodeFailed],
  interrupt: true,
  execute: ({ id }) =>
    Shop.use((shop) => shop.highlighted(id)).pipe(
      Effect.map((code) => Message.CodeLoaded({ id, code })),
      Effect.catch((error) => Effect.succeed(Message.CodeFailed({ id, reason: textOf(error) }))),
    ),
})

/** The page under `route`, from the Flags where they carry it; else loading, with its Commands. */
const entering = (model: Model, route: AppRoute): Return =>
  AppRoute.match<Return>(route, {
    Home: () => ({ model: { ...model, route, page: NONE, code: null } }),
    NotFound: () => ({ model: { ...model, route, page: NONE, code: null } }),
    Example: ({ area, id }) => {
      if (Predicate.isUndefined(exampleById(id)) || Option.isNone(pageOf(id))) return { model: { ...model, route: AppRoute.NotFound({ path: `/${area}/${id}` }), page: NONE, code: null } }
      return { model: { ...model, route, page: { _tag: "Loading", id }, code: null, codeTab: "own" }, commands: [LoadPage({ id }), LoadCode({ id })] }
    },
  })

/** Whether motion is reduced for a page: the system's setting, or the header's switch (#388). */
const envOf = (model: Model): PageEnv => ({ reduceMotion: Bool.or(model.prefs.reduceMotion, model.systemReducedMotion) })

/** What a page told the app, applied. */
const told = (model: Model, out: PageOut): Model => {
  if (out._tag === "CartChanged") return { ...model, cart: out.cart }
  if (out._tag === "Arriving") return { ...model, arrivals: [...model.arrivals.filter((one) => one.id !== out.id), { id: out.id, src: out.src }] }
  return { ...model, arrivals: model.arrivals.filter((one) => one.id !== out.id) }
}

/** A page's own Message, for the page under the route, if it's still the one it was sent to. */
const pageMessage = (model: Model, id: string, message: unknown): Return => {
  const page = model.page
  if (page._tag !== "Loaded" || page.id !== id) return { model }
  return Option.match(pageOf(id), {
    onNone: () => ({ model }),
    onSome: (definition) => {
      if (!Schema.is(definition.Message)(message)) return { model }
      const next = definition.update(page.model, message, envOf(model))
      const withPage: Model = { ...model, page: { ...page, model: next.model } }
      return {
        model: UndefinedOr.match(next.outMessage, { onUndefined: () => withPage, onDefined: (out) => told(withPage, out) }),
        commands: Command.mapMessages(next.commands, (inner) => Message.Page({ id, message: inner })),
      }
    },
  })
}

export const init = (flags: Flags, url: Url.Url): Return => {
  const route = urlToRoute(url)
  const base: Model = {
    route,
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
    codeTab: "own",
  }
  // On the client, after hydration: the theme onto the document, the system's setting read. The server runs no Command.
  const commands = [ApplyPrefs({ theme: flags.prefs.theme })]
  const carried = flags.page
  if (route._tag === "Example" && carried !== null && carried.id === route.id) {
    const data = carried.data
    return Option.match(pageOf(route.id), {
      onNone: () => entering(base, route),
      onSome: (page) => ({ model: { ...base, page: { _tag: "Loaded", id: route.id, data, model: page.init(data), run: 1 } }, commands }),
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
      const entered = entering({ ...model, settingsOpen: false }, urlToRoute(url))
      return { model: entered.model, commands: [...(entered.commands ?? []), ScrollTop()] }
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
    ShowCode: ({ tab }) => ({ model: { ...model, codeTab: tab } }),
    Page: ({ id, message }) => pageMessage(model, id, message),
    Replay: () => {
      const page = model.page
      if (page._tag !== "Loaded") return { model }
      return Option.match(pageOf(page.id), {
        onNone: () => ({ model }),
        onSome: (definition) => ({ model: { ...model, page: { ...page, model: definition.init(page.data), run: page.run + 1 }, arrivals: [] } }),
      })
    },
    Landed: ({ id }) => ({ model: { ...model, arrivals: model.arrivals.filter((one: Arrival) => one.id !== id) } }),
  })

/** The page's title: the example's, or the shop's. */
const titleOf = (model: Model): string => {
  if (model.route._tag === "Example") {
    const example = exampleById(model.route.id)
    if (example !== undefined) return `${example.foldkit?.title ?? example.title} · Wardic Northlight`
  }
  return "Wardic Northlight · Foldkit"
}

const content = (model: Model, h: HtmlBuilder<Message>) =>
  AppRoute.match(model.route, {
    Home: () => gallery(h),
    Example: ({ id }) => examplePage(model, h, id, envOf(model)),
    NotFound: () => notFound(h),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({ title: titleOf(model), body: shell(model, h, content(model, h)) })

/** Each page's subscriptions, live while its page is the one under the route. */
export const subscriptions = Subscription.aggregate<Model, Message, PageServices>()(
  ...PAGES.filter((page) => page.subscriptions !== undefined).map((page) =>
    Subscription.lift(page.subscriptions!)<Model, Message>({
      read: (model) => {
        if (model.page._tag === "Loaded" && model.page.id === page.id) return Option.some(model.page.model)
        return Option.none()
      },
      toParentMessage: (message) => Message.Page({ id: page.id, message }),
    }),
  ),
)

export const routing = { onUrlRequest: (request: Navigation.UrlRequest) => Message.RequestedUrl({ request }), onUrlChange: (url: Url.Url) => Message.ChangedUrl({ url }) }

/** What the Commands run on: Wardic's service for the Handle, and the store over the wire. */
export const resources = Layer.merge(wardic.resources, ShopClient)
