/**
 * The **Flush gate**: the accumulator a binding writes each element's values into, committed once per Refresh frame (ADR-0006, ADR-0031, ADR-0033, ADR-0034). A server render gets `inert`, which does nothing (ADR-0021).
 *
 * `@wardic/dom/FlushGate` (#132, ADR-0041).
 */
export {
  makeFlushGate as make,
  INERT_GATE as inert,
  type FlushGate,
  type FlushSink as Sink,
  type FlushGateOptions as Options,
  type FlushGateRuntime as Runtime,
} from "./internal/gate.ts"
