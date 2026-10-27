// `wardic.create(Component)`'s props on Solid 2 (#387), by the type checker (`typecheck:tests`): each
// `@ts-expect-error` is a prop the wrap's types reject. The JSX is only type-checked, never rendered.
//
// - CT1: a component generic over what it renders, as a component library's parts are (Kobalte's
//   `Dialog.Content<T extends ValidComponent = "div">`), keeps its own props through the wrap: its
//   children, the element's attributes, its own options, each checked. Its props were inferred as `{}`,
//   so its children were refused.
// - CT2: a plain component keeps its props, a required one required, beside the motion props.
import type { ComponentProps, JSX, ValidComponent } from "@solidjs/web"
import { wardic } from "@wardic/solid/unstable/v2"
import { describe, it } from "vitest"

/** `make()`'s JSX, type-checked only: the function is never called. */
const typed = (make: () => JSX.Element): void => void make

/** A component library's polymorphic props: the rendered element's, overridden by the part's own. */
type PolymorphicProps<T extends ValidComponent, P> = Omit<ComponentProps<T>, keyof P> & P & { readonly as?: T }

interface PanelOptions {
  readonly tone?: "calm" | "loud"
  readonly onDismiss?: () => void
}

/** A library's part, generic over what it renders, declared as Kobalte's are. */
declare function Panel<T extends ValidComponent = "div">(props: PolymorphicProps<T, PanelOptions>): JSX.Element

/** A plain component that forwards its ref, with a required prop. */
declare function Badge(props: { readonly label: string; readonly ref?: JSX.Ref<HTMLElement> }): JSX.Element

describe("wardic.create's props on Solid 2 (#387)", () => {
  it("CT1: a component generic over what it renders keeps its own props", () => {
    const WardicPanel = wardic.create(Panel)
    typed(() => (
      <WardicPanel tone="calm" role="dialog" onDismiss={() => {}} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        Its children
      </WardicPanel>
    ))
    // @ts-expect-error a tone it doesn't take
    typed(() => <WardicPanel tone="shouting" />)
    // @ts-expect-error a mistyped motion value
    typed(() => <WardicPanel animate={{ opacty: 1 }} />)
  })

  it("CT2: a plain component keeps its props, a required one required", () => {
    const WardicBadge = wardic.create(Badge)
    typed(() => <WardicBadge label="New" animate={{ scale: 1 }} />)
    // @ts-expect-error its required label
    typed(() => <WardicBadge animate={{ scale: 1 }} />)
  })
})
