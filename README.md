This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Use Node.js 20.9.0 or newer.

Install dependencies from the monorepo root:

```bash
npm install
```

Before starting the combined dev stack, make sure the crawler has its required env file in place:

```bash
cp packages/crawler/.env.example packages/crawler/.env
```

Run the local development stack from the monorepo root:

```bash
npm run dev
```

This starts both:

- the Next.js web app on [http://localhost:3000](http://localhost:3000)
- the standalone crawler on `http://127.0.0.1:3040`

The home screen's live current quotes depend on the crawler being available, so `npm run dev` now matches the documented local setup.

If you need to run either service by itself, you can still use:

```bash
npm run dev:web
npm run dev:crawler
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
