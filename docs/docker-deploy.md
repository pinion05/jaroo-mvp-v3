# Jaroo MVP v3 Docker runtime

This Docker setup runs the two Jaroo production processes from one Dockerfile:

- `web`: Next.js `next start` on port `3000`
- `crawler`: crawler sidecar on port `3040`

Compose tags separate local images for each service so `docker compose build web` and `docker compose build crawler` both work independently while reusing Docker layer cache.

The image intentionally does **not** bake secrets. Runtime env files are mounted by Compose:

- `.env.local` -> `/app/.env.local`
- `.env.cookie` -> `/app/.env.cookie`

## Local smoke run

```bash
docker compose up --build
curl -fsS http://127.0.0.1:3000/home
curl -fsS http://127.0.0.1:3040/api/source/system/catalog
```

Stop it with:

```bash
docker compose down
```

## Production notes

- Keep `JAROO_CRAWLER_BASE_URL=http://crawler:3040` for a Compose-style private network. `WITH_LOCAL_ENV_PROCESS_PRECEDENCE=1` makes this Compose value win over any mounted local `.env.local` value such as `127.0.0.1:3040`.
- Put a reverse proxy such as nginx or Caddy in front of the web container before exposing it publicly.
- Do not copy `.env.local` or `.env.cookie` into the image; mount them or provide equivalent runtime secrets.
- The image uses the Playwright base image so WiseReport/FnGuide browser crawling has Chromium and OS dependencies available.
