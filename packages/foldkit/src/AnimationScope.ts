/**
 * **Animation scopes** on Foldkit (#433, Motion's `useAnimate`'s scope; #798, Q7–Q9): made apart from any
 * element with {@link make}, at module scope or in the Model's making, and given to one `w.*` element as
 * `w.AnimationScope(scope)` (the bundle's `animationScope` too). A Command's `Wardic.animate(subject,
 * values, { scope })`, or `Wardic.animate(sequence, { scope })`, then looks its selectors up inside that
 * element, and the element's release stops the animations started in the scope where they are, each
 * awaiting Command then succeeding with `landed: false`. `scope.element()` is the element while it's
 * mounted. Without a scope, selectors resolve under the `w.Provider()` element, else the document.
 *
 * @example
 * const listScope = AnimationScope.make()
 * // in the view
 * w.ul([w.AnimationScope(listScope)], items)
 * // in a Command
 * Wardic.animate("li", { opacity: 1 }, { delay: stagger(0.05), scope: listScope })
 *
 * @module
 */
export { type AnimationScope, make } from "./internal/scope.ts"
