# The storefront's three apps in one image (#366), built from the repo's root: Node 24, which
# SolidStart 2 requires, with Bun for the workspace install. Each app is built here; compose.yaml
# runs each from its own directory: the Solid apps with `vite preview`, as the smoke test does, and
# the Next.js app with `next start`.
FROM oven/bun:1.3.13 AS bun

FROM node:24.21.0-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN cd examples/storefront/solid1 && node_modules/.bin/vite build
RUN cd examples/storefront/solid2 && node_modules/.bin/vite build
RUN cd examples/storefront/next && node node_modules/next/dist/bin/next build
