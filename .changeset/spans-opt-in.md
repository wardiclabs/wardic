---
"@wardic/core": minor
"@wardic/dom": minor
"@wardic/solid": minor
---

Wardic's spans are now an app's to give: merge `WardicSpans`, from `@wardic/dom`, beside `DomLive` with a tracer installed (the devtools', an OpenTelemetry exporter's) to see each animation, burst of frames, gesture, layout pass and exit in its span. Without it, Wardic opens no spans, and an app ships none of Effect's span code: every app is about 1.8 KB gzipped smaller. With a tracer installed and no `WardicSpans`, each `WardicProvider` warns once in development. Core adds the `Spans` module: `Spans.layer`, which `WardicSpans` is; `Spans.withSpan`, for a binding's own spans; and `Spans.missing`, whether a tracer reads spans nothing gives.
