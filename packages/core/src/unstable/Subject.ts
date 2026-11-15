/**
 * What an Environment draws and a Ward binds (**Subject**): opaque to core. An element in `@wardic/dom`, an
 * object in a scene; an Environment decides what its Subjects are.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise.
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672 (the build grill's Q20): a type, not a port; nothing core holds
// checks what kind of Subject it has.

/** A Subject: any object its Environment draws. */
export type Subject = object
