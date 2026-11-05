/**
 * Base values in the DOM (ADR-0022): an element's Own value for a key, and the `style` link's
 * lookup. A binding calls these and hands them to core's `BaseValue.of` / `BaseValue.start`, so a
 * new binding writes no DOM code for them (the thin-bindings rule). Tier 2, for binding
 * authors.
 *
 * Client-only: the read runs after mount, never during a server render (ADR-0021, "Nothing
 * reads the DOM on a server"). `styleValueOf` and `valueLike` are pure.
 *
 * Observability: per element and cold (once per key), so quiet; the spine logs what it
 * started from and returned to.
 */
import * as BaseValue from "@wardic/core/BaseValue"
import * as Interpolator from "@wardic/core/Interpolator"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"
import { parseCssText } from "./starting-style.ts"
import { dashCase, isSvgInner, svgAttrNameOf } from "./svg.ts"

/** An element's own value for a key: the raw value read, a string, a transform key's identity, or `None`. */
export type OwnValue = (key: string) => Option.Option<number | string>

/**
 * A reader of `element`'s own values, each read once, the first time it's needed, and kept, a miss too,
 * so a later CSS change doesn't move it, as Motion's. For each key:
 * 1. a transform key: its identity, with no read;
 * 2. on an SVG element inside an `<svg>`, a key it takes as an attribute: that attribute, if it has one;
 * 3. else its computed style, a custom property by its own name.
 *
 * Making a reader reads nothing, and a read from an element not in the document isn't kept. Values read
 * are raw strings: `valueLike` reads one in a target's shape.
 */
// Motion's C12. A transform key: Motion's projected branch, HTMLVisualElement.ts:51 at
// 16c61222c4166bbef5ff6ab0051192faa79fa8c8. An attribute: ADR-0014's routing.
export const ownValues = (element: Element): OwnValue => {
  const cache = new Map<string, Option.Option<number | string>>()
  // The element's computed style, read once, at the first key that needs it.
  const computed = MutableRef.make(Option.none<CSSStyleDeclaration>())
  const computedStyle = (): CSSStyleDeclaration =>
    Option.getOrElse(MutableRef.get(computed), () => {
      const style = getComputedStyle(element)
      MutableRef.set(computed, Option.some(style))
      return style
    })
  // On an svg-inner element, the attribute the key is written as, if it has one.
  const attributeOf = (key: string): Option.Option<string> =>
    Bool.match(isSvgInner(element), {
      onTrue: () => Option.flatMap(svgAttrNameOf(key), (name) => nonEmpty(element.getAttribute(name))),
      onFalse: () => Option.none(),
    })
  const read = (key: string): Option.Option<number | string> =>
    Option.orElse(BaseValue.transformIdentity(key), () =>
      Option.orElse(attributeOf(key), () => nonEmpty(computedStyle().getPropertyValue(dashCase(key)).trim()))
    )
  return (key) =>
    Option.getOrElse(Option.fromUndefinedOr(cache.get(key)), () => {
      const value = read(key)
      // An element not in the document has an empty computed style: that miss isn't the
      // element's, so it isn't kept, and the key is read again once the element is in.
      if (element.isConnected) cache.set(key, value)
      return value
    })
}

/** A read string, `None` when there's none or it's empty. */
const nonEmpty = (value: string | null): Option.Option<string> => Option.filter(Option.fromNullOr(value), Str.isNonEmpty)

/**
 * The app's `style` value for `key`: from an object style by the key, then by the key dash-cased; from a
 * CSS-text style, parsed as `Style.over` parses it. `undefined`, `null` and an empty string are `None`. A
 * transform key, `x`, `scale`, `rotate`, is Wardic's, as Motion's is: a binding draws it into `transform`.
 * The value is as given, so a binding reads a live value, an Atom or an accessor, itself.
 *
 * @example
 * OwnValues.styleValueOf({ opacity: 0.5 }, "opacity") // Some(0.5)
 */
// The `style` link of a Base value. #130, ADR-0043 decision 4: through the flush gate.
export const styleValueOf = (style: object | string | undefined, key: string): Option.Option<unknown> =>
  Option.flatMap(
    Option.fromNullishOr(style),
    (given) => {
      const map = recordOf(given)
      // A value at `k`: `undefined`, `null` and an empty string are misses.
      const at = (k: string): Option.Option<unknown> =>
        Option.filter(
          Option.flatMap(Option.liftPredicate(k, (name: string) => Object.hasOwn(map, name)), (name) => Option.fromNullishOr(map[name])),
          (value) => value !== "",
        )
      // A custom property by its own name only; any other key then dash-cased.
      return Option.orElse(at(key), () =>
        Option.flatMap(Option.liftPredicate(dashCase(key), (dashed: string) => Bool.not(key.startsWith("--")) && dashed !== key), at)
      )
    },
  )

/** A style given as CSS text, parsed; a record as it is. */
const recordOf: (style: object | string) => Readonly<Record<string, unknown>> = Match.type<object | string>().pipe(
  Match.when(Predicate.isString, parseCssText),
  Match.orElse((record) => record as Readonly<Record<string, unknown>>),
)

/** A plain number, or a number in `px`. */
const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(px)?\s*$/i

/**
 * `raw` in the shape of a key's target `like`, or `None` when it can't be:
 * - **A number target** takes a finite number, or a plain number or a `px` string, parsed (`"0.5"` is
 *   0.5, `"120px"` 120). Anything else misses, `auto`, `50%`, `1em`, a colour, so the key starts at its
 *   target. On a key that places or sizes the box, a miss of another type, `auto` or `50%`, is a Measured
 *   pair instead: both ends are measured in px, as Motion's are.
 * - **A string target** takes a string as it is, or a finite number as a string, but not a length in a
 *   unit other than the target's (`"120px"` for `"0%"`), which can't blend with it.
 */
// A **Measured pair** (#430, `measured-pairs.ts`): its binding keeps the start. The unit interpolator dies
// on a pair of two units, so it misses, as a numeric target misses `50%`.
export const valueLike = (raw: unknown, like: number | string): Option.Option<number | string> => valueLikeOf({ raw, like })

// The matchers are built once, at module load, not per call: a start reads every key's (#69).
/** A plain number, or a number in `px`, as a numeric target takes it. */
const isNumericString = (raw: unknown): raw is string => Predicate.isString(raw) && NUMERIC.test(raw)

/** `raw` for a numeric target: a finite number, or a plain-number or `px` string, parsed. */
const numericLike: (raw: unknown) => Option.Option<number> = Match.type<unknown>().pipe(
  Match.when(Match.number, (n) => Option.liftPredicate(n, Number.isFinite)),
  Match.when(isNumericString, (s) => Option.some(Number.parseFloat(s))),
  Match.orElse(() => Option.none()),
)

/** `raw` for a string target `like`: a string as is unless its unit clashes with the target's, or a finite number as a string. */
const stringLike: (pair: { readonly raw: unknown; readonly like: string }) => Option.Option<string> = Match.type<{
  readonly raw: unknown
  readonly like: string
}>().pipe(
  Match.when({ raw: Match.string }, ({ raw, like }) => Option.liftPredicate(raw, (given: string) => Bool.not(unitsClash(like, given)))),
  Match.when({ raw: Match.number }, ({ raw }) => Option.map(Option.liftPredicate(raw, Number.isFinite), String)),
  Match.orElse(() => Option.none()),
)

const valueLikeOf: (pair: { readonly raw: unknown; readonly like: number | string }) => Option.Option<number | string> = Match.type<{
  readonly raw: unknown
  readonly like: number | string
}>().pipe(
  Match.when({ like: Match.number }, ({ raw }): Option.Option<number | string> => numericLike(raw)),
  // The rest have a string target.
  Match.orElse((pair): Option.Option<number | string> => stringLike(pair as { readonly raw: unknown; readonly like: string })),
)

/** Whether `raw` is a length in another unit than `like`'s (both have a unit, and they differ). */
const unitsClash = (like: string, raw: string): boolean =>
  Option.exists(Interpolator.unitOf(like), (want) => want !== "" && Option.exists(Interpolator.unitOf(raw), (got) => got !== "" && got !== want))
