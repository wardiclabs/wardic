/**
 * Variants down a scene's graph (#885's PR 3; ADR-0073 decision 17): on a Stage whose Environment has a
 * graph, a ward with variants of its own provides its variant context to the wards below its Subject, and
 * a Variant child (variants, and no names of its own) follows the nearest ward above its Subject, not
 * Solid's component tree's. Its stagger slot is its place among that ward's Subject's children: a ward's
 * registry takes its children's slots in the order they registered, so a child that joins out of the
 * graph's order has those after it register again, after it.
 *
 * A Variant child follows the ward it finds:
 * - **at its setup,** from the parent it will join, when its Subject is a value, so it registers before
 *   any Retarget reads a stagger slot, as a ward on the page registers in its component's body;
 * - **at its mount,** from its Subject's parent then;
 * - **when its Subject is moved,** added to a parent or removed from one;
 * - **when a ward with variants starts or stops providing above it.**
 *
 * A Subject outside the graph (a material, a uniforms object) has no parent, and follows no one.
 *
 * @module
 */
// #885's PR 3 (ADR-0073, *Amendment (#885)*, Q7).
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import { type Accessor, createSignal } from "solid-js"

/**
 * A scene's graph, as a Stage ward reads it: what an Environment with one gives its Stage
 * (`@wardic/three/solid` gives three.js's).
 */
export interface StageGraph {
  /** `subject`'s parent in the graph: none at its root, or for a Subject outside it. */
  readonly parentOf: (subject: object) => object | undefined
  /** Hear `subject` added to a parent or removed from one; the call returned stops. */
  readonly onMoved: (subject: object, moved: () => void) => () => void
  /** `descendant`'s place below `ancestor`, for `staggerChildren`: its branch's index among `ancestor`'s children. */
  readonly orderOf: (descendant: object, ancestor: object) => number
  /** Visit every Subject below `subject`. */
  readonly below: (subject: object, visit: (descendant: object) => void) => void
}

/** A ward's variant context, provided for the wards below its Subject, and those following it, in the graph's order. */
interface Provided {
  readonly subject: object
  readonly context: VariantTree.WardicVariantContextValue
  readonly followers: Array<GraphParent>
}

/** A graph's providers, by Subject, and its attached followers' re-resolves, by Subject. */
interface Registry {
  readonly provided: WeakMap<object, Provided>
  readonly resolvers: WeakMap<object, () => void>
}

// Module state (#460, Q7): each graph's registry, held weakly by its graph.
const REGISTRIES = new WeakMap<StageGraph, Registry>()

const registryOf = (graph: StageGraph): Registry =>
  UndefinedOr.match(REGISTRIES.get(graph), {
    onDefined: (known) => known,
    onUndefined: () => {
      const made: Registry = { provided: new WeakMap(), resolvers: new WeakMap() }
      REGISTRIES.set(graph, made)
      return made
    },
  })

/** The nearest provider at `from` or above it: none past the graph's root. */
const nearestFrom = (graph: StageGraph, registry: Registry, from: object | undefined): Provided | undefined => {
  if (Predicate.isUndefined(from)) return undefined
  return UndefinedOr.match(registry.provided.get(from), { onDefined: (provided) => provided, onUndefined: () => nearestFrom(graph, registry, graph.parentOf(from)) })
}

/** The followers below `subject` find their ward again: one above them has started or stopped providing. */
const resolveBelow = (graph: StageGraph, registry: Registry, subject: object): void =>
  graph.below(subject, (descendant) => {
    UndefinedOr.map(registry.resolvers.get(descendant), (resolve) => resolve())
  })

/**
 * `context` provided for the wards below `subject`, from now until the call returned. Those already
 * following a ward above it follow it instead.
 */
export const provide = (graph: StageGraph, subject: object, context: VariantTree.WardicVariantContextValue): (() => void) => {
  const registry = registryOf(graph)
  const mine: Provided = { subject, context, followers: [] }
  registry.provided.set(subject, mine)
  resolveBelow(graph, registry, subject)
  return () => {
    if (registry.provided.get(subject) !== mine) return
    registry.provided.delete(subject)
    resolveBelow(graph, registry, subject)
  }
}

/**
 * A Variant child's registration with the ward it follows: forwarded to that ward's registry, and
 * moved, with its last settle, to the next ward it follows. None while it follows none.
 */
class Forwarded implements VariantTree.WardicChildRegistration {
  real: VariantTree.WardicChildRegistration | undefined = undefined
  settled = false
  constructor(private readonly seen: Accessor<number>) {}
  readonly index = (): number => {
    this.seen()
    return UndefinedOr.match(this.real, { onUndefined: () => 0, onDefined: (real) => real.index() })
  }
  readonly total = (): number => {
    this.seen()
    return UndefinedOr.match(this.real, { onUndefined: () => 1, onDefined: (real) => real.total() })
  }
  readonly setSettled = (done: boolean): void => {
    this.settled = done
    UndefinedOr.map(this.real, (real) => real.setSettled(done))
  }
  readonly setSettledFor = (name: string, done: boolean): void => {
    UndefinedOr.map(this.real, (real) => UndefinedOr.map(real.setSettledFor, (set) => set(name, done)))
  }
  readonly dispose = (): void => {
    UndefinedOr.map(this.real, (real) => real.dispose())
    this.real = undefined
  }
  /** Moved to `next`'s registry, its last settle with it. */
  moveTo(next: VariantTree.WardicChildRegistration | undefined): void {
    UndefinedOr.map(this.real, (real) => real.dispose())
    this.real = next
    UndefinedOr.map(next, (real) => real.setSettled(this.settled))
  }
}

/**
 * The variant context a Variant child on a scene's graph inherits from: the one the nearest ward above
 * its Subject provides, whichever that is now, or none. Read where it tracks, a change of ward is a change.
 */
// A class: `initial` is a getter, which a class keeps on its prototype (memory: getters give own shape).
export class GraphParent implements VariantTree.WardicVariantContextValue {
  private now: Provided | undefined = undefined
  private subject: object | undefined = undefined
  private detach: () => void = () => undefined
  private released = false
  private readonly seen: Accessor<number>
  private readonly see: (change: (n: number) => number) => void
  private readonly forwarded: Forwarded
  private readonly registry: Registry

  /**
   * `joinsUnder` is the parent a Subject will join, before it has (a Scene object's): where it looks first,
   * at its setup and its mount, which come before its join. Else the parent it has.
   */
  constructor(
    private readonly graph: StageGraph,
    private readonly joinsUnder: ((subject: object) => object | undefined) | undefined,
  ) {
    // Written as it follows another ward: at a component's setup too, an owned scope (#257's audit).
    const [seen, see] = createSignal(0, { ownedWrite: true })
    this.seen = seen
    this.see = see
    this.forwarded = new Forwarded(seen)
    this.registry = registryOf(graph)
  }

  /** The context it follows now, tracked. */
  private current(): VariantTree.WardicVariantContextValue | undefined {
    this.seen()
    return UndefinedOr.map(this.now, (provided) => provided.context)
  }

  readonly variant = () => UndefinedOr.map(this.current(), (context) => context.variant())
  get initial(): ReturnType<() => VariantTree.WardicVariantContextValue["initial"]> {
    return UndefinedOr.map(this.now, (provided) => provided.context.initial)
  }
  readonly transition = () => UndefinedOr.map(this.current(), (context) => context.transition())
  readonly gestures = () => UndefinedOr.match(this.current(), { onUndefined: () => VariantTree.NO_HAND_DOWN, onDefined: VariantTree.handDownFrom })
  readonly register = (): VariantTree.WardicChildRegistration => this.forwarded
  readonly stagger = () => UndefinedOr.match(this.current(), { onUndefined: () => VariantTree.staggerOf(undefined), onDefined: (context) => context.stagger() })
  readonly staggerFor = (name: string | undefined) =>
    UndefinedOr.match(this.current(), { onUndefined: () => VariantTree.staggerOf(undefined), onDefined: (context) => VariantTree.staggerOfName(context, name) })
  readonly mayStartFor = (name: string) => UndefinedOr.match(this.current(), { onUndefined: () => true, onDefined: (context) => VariantTree.mayStartOf(context, name) })
  readonly when = () => UndefinedOr.map(this.current(), (context) => context.when())
  readonly childrenMayStart = () => UndefinedOr.match(this.current(), { onUndefined: () => true, onDefined: (context) => context.childrenMayStart() })
  readonly allChildrenSettled = () => UndefinedOr.match(this.current(), { onUndefined: () => true, onDefined: (context) => context.allChildrenSettled() })
  readonly change = () => UndefinedOr.map(this.current(), (context) => UndefinedOr.map(context.change, (change) => change()))

  /** Follow `next`: its registration moves there, in the graph's order. */
  private follow(next: Provided | undefined): void {
    if (Bool.or(this.released, next === this.now)) return
    this.leave()
    this.now = next
    UndefinedOr.match(next, { onUndefined: () => this.forwarded.moveTo(undefined), onDefined: (provided) => this.joinInOrder(provided) })
    this.see((n) => n + 1)
  }

  /** Out of the followers of the ward it follows. */
  private leave(): void {
    UndefinedOr.map(this.now, (provided) => {
      const at = provided.followers.indexOf(this)
      if (at >= 0) provided.followers.splice(at, 1)
    })
  }

  /** Its place below `provided`'s Subject: last while its Subject isn't in the graph. */
  private placeIn(provided: Provided): number {
    return UndefinedOr.match(this.subject, { onUndefined: () => Number.MAX_SAFE_INTEGER, onDefined: (on) => this.graph.orderOf(on, provided.subject) })
  }

  /**
   * Among `provided`'s followers at its place in the graph. Its registry takes stagger slots in the order
   * its children registered, so those after this one register again, after it. Most join in the graph's
   * order, last, and nothing registers again.
   */
  private joinInOrder(provided: Provided): void {
    const followers = provided.followers
    const mine = this.placeIn(provided)
    const at = Option.match(Arr.last(followers), {
      onNone: () => 0,
      onSome: (last) =>
        Bool.match(last.placeIn(provided) <= mine, {
          onTrue: () => followers.length,
          onFalse: () => Option.getOrElse(Arr.findFirstIndex(followers, (follower) => follower.placeIn(provided) > mine), () => followers.length),
        }),
    })
    followers.splice(at, 0, this)
    this.forwarded.moveTo(provided.context.register())
    Arr.forEach(followers.slice(at + 1), (after) => after.forwarded.moveTo(provided.context.register()))
  }

  /** The parent `subject` is joining, else the one it has. */
  private joiningOf(subject: object): object | undefined {
    return UndefinedOr.match(this.joinsUnder, { onUndefined: () => this.graph.parentOf(subject), onDefined: (under) => under(subject) })
  }

  /** At its setup, its Subject a value: the ward above the parent it's joining. */
  early(subject: object): void {
    this.subject = subject
    this.follow(nearestFrom(this.graph, this.registry, this.joiningOf(subject)))
  }

  /**
   * On `subject`, as it mounts, before it joins: the ward above the parent it's joining; then, as it's
   * moved or a ward above it changes, the ward above the parent it has. Until the next, or `release`.
   */
  attach(subject: object): void {
    this.detach()
    this.subject = subject
    const resolve = (): void => this.follow(nearestFrom(this.graph, this.registry, this.graph.parentOf(subject)))
    this.follow(nearestFrom(this.graph, this.registry, this.joiningOf(subject)))
    this.registry.resolvers.set(subject, resolve)
    const stop = this.graph.onMoved(subject, resolve)
    this.detach = () => {
      stop()
      if (this.registry.resolvers.get(subject) === resolve) this.registry.resolvers.delete(subject)
    }
  }

  /** Its ward has ended: it follows no one from now, and its registration is gone. */
  release(): void {
    this.detach()
    this.leave()
    this.released = true
    this.forwarded.dispose()
  }
}
