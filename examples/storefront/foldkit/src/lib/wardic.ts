/**
 * The storefront's Handle (#795; ADR-0071, decision 9): one per program, at module scope, the same
 * module on the server and the client. Every DOM Feature and the binding's presence: a Foldkit app
 * has one Handle, so its Features are the app's, where a Solid page picks its own (#516).
 */
import { DomLive } from "@wardic/dom"
import { Features, Wardic } from "@wardic/foldkit"

export const wardic = Wardic.make({ env: DomLive, features: [Features.domMax, Features.presence] })

/** The builder's type, for a view's signature. */
export type W<Message> = Wardic.Html<Message, readonly [typeof Features.domMax, typeof Features.presence]>
