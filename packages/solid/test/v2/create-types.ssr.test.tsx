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

// The wraps, made only inside `typed`: the components are declared, with nothing to wrap at run time.
const wrapPanel = () => wardic.create(Panel)
const wrapBadge = () => wardic.create(Badge)

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
    typed(() => {
      const WardicPanel = wrapPanel()
      return (
        <WardicPanel tone="calm" role="dialog" onDismiss={() => {}} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Its children
        </WardicPanel>
      )
    })
    typed(() => {
      const WardicPanel = wrapPanel()
      // @ts-expect-error a tone it doesn't take
      return <WardicPanel tone="shouting" />
    })
    typed(() => {
      const WardicPanel = wrapPanel()
      // @ts-expect-error a mistyped motion value
      return <WardicPanel animate={{ opacty: 1 }} />
    })
  })

  it("CT2: a plain component keeps its props, a required one required", () => {
    typed(() => {
      const WardicBadge = wrapBadge()
      return <WardicBadge label="New" animate={{ scale: 1 }} />
    })
    typed(() => {
      const WardicBadge = wrapBadge()
      // @ts-expect-error its required label
      return <WardicBadge animate={{ scale: 1 }} />
    })
  })
})
