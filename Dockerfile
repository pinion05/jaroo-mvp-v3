# syntax=docker/dockerfile:1

# Playwright base keeps Chromium and browser OS dependencies available for the
# crawler while still supporting a standard Next.js `next start` runtime.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS deps

WORKDIR /app

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=768 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY packages/deepscan-runtime-core/package.json packages/deepscan-runtime-core/package.json
COPY packages/crawler/package.json packages/crawler/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/instrument-core/package.json packages/instrument-core/package.json

RUN npm ci --include=dev --no-audit --no-fund

FROM deps AS builder

# Surface Railway-injected NEXT_PUBLIC_* so Next.js inlines them at build.
# Fallback keeps OCI (jaroo.kr) working if the var is absent.
ENV NEXT_PUBLIC_JAROO_ORIGIN="${NEXT_PUBLIC_JAROO_ORIGIN:-https://jaroo.kr}"

COPY . .

RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN chown pwuser:pwuser /app

COPY --from=builder --chown=pwuser:pwuser /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=pwuser:pwuser /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=pwuser:pwuser /app/public ./public
COPY --from=builder --chown=pwuser:pwuser /app/scripts ./scripts
COPY --from=builder --chown=pwuser:pwuser /app/packages ./packages
COPY --from=builder --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=builder --chown=pwuser:pwuser /app/.next ./.next

USER pwuser

COPY --from=builder --chmod=0755 --chown=pwuser:pwuser /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Railway proxies the web port ($PORT). Crawler binds 127.0.0.1:3040 inside the container.
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
