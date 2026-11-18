/**
 * The shop's frame (#296; #795): its header, with the visitor's switches, the store's and the cart,
 * and its footer, around the page. The root is the app's `w.Provider()` element, whose `w.Config`
 * follows the Reduce motion switch.
 */
import { COG, ICON, turnOf } from "@wardic/example-storefront-shared/micro"
import * as Bool from "effect/Boolean"
import type { Html, HtmlBuilder } from "foldkit/html"
import { arc } from "@wardic/foldkit"
import { arrivalId } from "~/lib/arrivals.ts"
import { wardic } from "~/lib/wardic.ts"
import { Message, type Model, type Theme } from "~/model.ts"

const THEME_LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" }

/** Whether Wardic reduces motion: the header's switch makes it always; else the visitor's setting. */
const reducedOf = (model: Model): "always" | "user" => Bool.match(model.prefs.reduceMotion, { onTrue: () => "always" as const, onFalse: () => "user" as const })

// The flight into the cart bows along an arc (#438), one value for every flight, as its side is kept.
const TOSS = arc()

/** The store's switches: the delay on each request, and "fail the next one". */
const storeSettings = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  const { delay, failNext } = model.settings
  return h.div([h.Class("settings")], [
    w.button(
      [h.Class("icon-button"), w.Variants(ICON), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileTap("press"), h.AriaExpanded(model.settingsOpen), h.AriaLabel("Store settings"), h.Title("Store settings"), h.OnClick(Message.ToggleSettings())],
      [w.span([h.Class("glyph"), w.Variants(COG)], ["⚙"])],
    ),
    ...Bool.match(model.settingsOpen, {
      onFalse: () => [],
      onTrue: () => [
        h.div([h.Class("settings-panel"), h.Role("dialog"), h.AriaLabel("Store settings")], [
          h.strong([], ["The store"]),
          h.label([], [
            h.span([], ["Delay on each request: ", h.strong([], [`${delay} ms`])]),
            h.input([h.Type("range"), h.Min("0"), h.Max("2000"), h.Step("100"), h.Value(String(delay)), h.OnChange((value) => Message.SaveSettings({ settings: { delay: Number(value), failNext } }))]),
          ]),
          h.label([h.Class("switch")], [
            h.input([h.Type("checkbox"), h.Checked(failNext), h.OnClick(Message.SaveSettings({ settings: { delay, failNext: Bool.not(failNext) } }))]),
            h.span([], ["Fail the next request"]),
          ]),
          ...(model.settingsProblem === null ? [] : [h.p([h.Class("error-line"), h.Role("alert")], [model.settingsProblem])]),
        ]),
      ],
    }),
  ])
}

/** The cart's count, which pops each time it changes: a new count is a new element, growing in; and the fly-in's twins. */
const cartButton = (model: Model, h: HtmlBuilder<Message>): Html => {
  const w = wardic.html(h)
  const count = model.cart.lines.reduce((sum, line) => sum + line.quantity, 0)
  return w.a(
    [h.Class("icon-button cart-button"), h.Href("/layout/cart-drawer"), w.Variants(ICON), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileTap("press"), h.AriaLabel(`Cart: ${count} items`), h.Title("Cart")],
    [
      h.svg([h.ViewBox("0 0 24 24"), h.Width("18"), h.Height("18"), h.AriaHidden(true)], [
        h.path([h.Attribute("d", "M6 7h12l-1 13H7L6 7Z M9 7a3 3 0 0 1 6 0"), h.Fill("none"), h.Attribute("stroke", "currentColor"), h.Attribute("stroke-width", "1.8"), h.Attribute("stroke-linejoin", "round")]),
      ]),
      ...Bool.match(count > 0, {
        onFalse: () => [],
        onTrue: () => [w.keyed("span")(`count-${count}`, [h.Class("cart-count"), w.Initial({ scale: 1.5 }), w.Animate({ scale: 1 }), w.Transition({ type: "spring", stiffness: 500, damping: 18 })], [String(count)])],
      }),
      // The fly-in (#526): a piece moved to the cart from Saved for later flies here, its photo's twin sharing
      // its row photo's layoutId, one photo flying rather than two crossfading. Landed, it shrinks into the icon.
      w.span(
        [h.Class("cart-arrivals"), w.Presence()],
        model.arrivals.map((piece) =>
          w.keyed("img")(piece.id, [
            h.Class("cart-arrival"),
            h.Src(piece.src),
            h.Alt(""),
            w.LayoutId(arrivalId(piece.id)),
            w.LayoutCrossfade(false),
            w.Transition({ layout: { type: "tween", duration: 0.6, ease: [0.45, 0, 0.55, 1], path: TOSS } }),
            w.Exit({ scale: 0.3, opacity: 0, transition: { type: "tween", duration: 0.25 } }),
            w.OnLayoutAnimationComplete(Message.Landed({ id: piece.id })),
          ]),
        ),
      ),
    ],
  )
}

export const shell = (model: Model, h: HtmlBuilder<Message>, content: Html): Html => {
  const w = wardic.html(h)
  const theme = model.prefs.theme
  return w.div([h.Id("app"), w.Provider(), w.Config({ reducedMotion: reducedOf(model) })], [
    h.header([h.Class("site-header")], [
      h.div([h.Class("page")], [
        h.a([h.Class("brand"), h.Href("/")], ["Wardic Northlight", h.span([h.Class("badges")], [h.span([h.Class("badge badge-binding")], ["Foldkit"])])]),
        h.nav([h.Class("site-nav"), h.AriaLabel("Main")], [h.a([h.Href("/")], ["Examples"])]),
        h.div([h.Class("header-tools")], [
          h.label([h.Class("switch")], [
            h.input([h.Type("checkbox"), h.Checked(model.prefs.reduceMotion), h.OnClick(Message.SetReduceMotion({ on: Bool.not(model.prefs.reduceMotion) }))]),
            h.span([], ["Reduce motion"]),
          ]),
          w.button(
            [h.Class("icon-button"), w.Variants(ICON), w.Initial("rest"), w.Animate("rest"), w.WhileHover("hover"), w.WhileTap("press"), h.AriaLabel(THEME_LABEL[theme]), h.Title(THEME_LABEL[theme]), h.OnClick(Message.CycleTheme())],
            [w.span([h.Class("glyph"), w.Animate(turnOf(model.themeSwitches))], [THEME_ICON[theme]])],
          ),
          storeSettings(model, h),
          cartButton(model, h),
        ]),
      ]),
    ]),
    content,
    h.footer([h.Class("site-footer")], [
      h.div([h.Class("page")], [h.span([], ["Wardic Northlight is a made-up shop: a showcase of Wardic on Foldkit."]), h.span([], ["Photos: CC0, from museums' open-access collections."])]),
    ]),
  ])
}
