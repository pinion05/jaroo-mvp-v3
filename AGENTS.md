<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Jaroo runtime rule

When starting the Jaroo development runtime, always run the web app and crawler sidecar together. Prefer the root stack command:

```bash
npm run dev
```

Do not run only `npm run dev:web` unless the user explicitly asks for web-only debugging. The app expects the crawler API to be available alongside Next.js.
