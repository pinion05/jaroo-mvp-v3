# syntax=docker/dockerfile:1

# Playwright base keeps Chromium and browser OS dependencies available for the
# crawler while still supporting a standard Next.js `next start` runtime.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS deps

WORKDIR /app

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY packages/deepscan-runtime-core/package.json packages/deepscan-runtime-core/package.json
COPY packages/crawler/package.json packages/crawler/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/instrument-core/package.json packages/instrument-core/package.json

RUN npm ci --include=dev --no-audit --no-fund

FROM deps AS builder

COPY . .

RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=builder /app ./

RUN npm prune --omit=dev --no-audit --no-fund \
    && npm cache clean --force

EXPOSE 3000 3040

CMD ["npm", "run", "start:web"]
