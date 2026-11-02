/**
 * What an element reads of its section's gesture Features (#511, ADR-0067 decision 3): each gesture's
 * service, `undefined` without its Feature, the gestures' input a section with one has, and the words
 * development's message on a missing one names. Solid-free, for both bindings; it reaches no Feature's
 * code, only their keys.
 *
 * @module
 */
import * as InputSource from "@wardic/core/InputSource"
import * as Context from "effect/Context"
import * as Option from "effect/Option"

/** `key`'s service among `services`, or `undefined` when they hold none: its Feature isn't there. */
export const serviceIn = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): S | undefined =>
  Option.getOrUndefined(Context.getOption(services as Context.Context<I>, key))

/** The gestures' input among `services`: a section with any gesture Feature but `inView` has it. */
export const inputIn = (services: Context.Context<never>): InputSource.InputSource["Service"] =>
  Context.get(services as Context.Context<InputSource.InputSource>, InputSource.InputSource)

/** What development's word on a missing gesture Feature names, by Feature: what the element asked of it. */
export const GESTURE_WORDS = {
  hover: "Its hover (`whileHover`, or a hover event)",
  press: "Its press (`whileTap`, or a tap event)",
  focus: "Its focus (`whileFocus`)",
  inView: "Its view (`whileInView`, or a viewport event)",
  pan: "Its pan (a pan event)",
  drag: "Its drag (`drag`)",
} as const

/** Whether `services` hold `key`'s service: its Feature is there. */
export const hasService = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): boolean => Option.isSome(Context.getOption(services as Context.Context<I>, key))

/** `key`'s service among `services`, which hold it: a Feature a hook or component brought. */
export const serviceOf = <I, S>(services: Context.Context<never>, key: Context.Key<I, S>): S => Context.get(services as Context.Context<I>, key)
