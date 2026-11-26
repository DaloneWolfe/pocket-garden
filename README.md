# Pocket Garden

A cozy little idle garden you can tend on a phone or computer while you do other things. Plant seeds, wander off, and come back later — plants keep growing in real time, even if the tab is closed. Optionally, leave a tip through Stripe Checkout.

This is a small, self-contained Node site. Card numbers never touch this server; payments use Stripe's hosted Checkout page.

## What's included

- A mobile-first garden game saved in `localStorage` on the player's device
- Real-time growth based on timestamps (not on the tab staying open)
- A few unlockable plants and extra plots, paid for with in-game coins
- A tip jar with $1 / $3 / $5 plus a custom whole-dollar amount ($1–$100)
- Stripe Checkout in test mode, a webhook endpoint with signature verification, and success/cancel pages
- A thank-you cosmetic (a golden watering can) granted only after the success page verifies the session with the server
- Helmet security headers, a strict Content-Security-Policy, checkout rate limiting, and server-side amount validation
- A simple PWA setup: `manifest.json` plus an optional service worker for offline play of the static game files

## Run it locally

You need Node.js 18 or newer.

```bash
cp .env.example .env
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

Without Stripe keys, the game still works. The tip jar shows a clear **Payments are not configured yet** state and will not crash.

To auto-restart the server while you edit files:

```bash
npm run dev
```

API checks (no Stripe account required):

```bash
npm test
```

## Create a free Stripe account and get test keys

1. Sign up at [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register).
2. Make sure the Dashboard is in **Test mode** (the toggle is in the Stripe sidebar).
3. Open [Developers → API keys](https://dashboard.stripe.com/test/apikeys) and copy the **Secret key** (`sk_test_...`).
4. Put it in `.env`:

   ```bash
   STRIPE_SECRET_KEY=sk_test_your_key_here
   ```

5. For local webhooks, install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and in another terminal run:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhook
   ```

   Copy the webhook signing secret it prints (`whsec_...`) into `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the server.

6. In the garden, open the tip jar and choose an amount. Stripe Checkout should open. Use a [test card](https://docs.stripe.com/testing#cards) such as `4242 4242 4242 4242`, any future expiry, any CVC, and any postal code.

Never put the secret key in client-side code, a public repo, or a screenshot.

## Go live

1. Host the app on HTTPS (required for Stripe Checkout in live mode, and a good idea for the service worker).
2. In the Stripe Dashboard, switch off Test mode.
3. Copy the **live** secret key (`sk_live_...`) into your host's environment variables. Do not reuse test keys in production.
4. Add a webhook endpoint pointing at `https://your-domain/api/webhook` for the event `checkout.session.completed` (and any others you want to log). Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Set `BASE_URL` to your public origin, for example `https://your-app.onrender.com`, so success and cancel redirects come back to the right place.
6. Set `NODE_ENV=production`.
7. Run through a small live payment yourself, then confirm the success page grants the golden watering can.

Tips are voluntary donations. They do not change the game, aside from that cosmetic thank-you.

## Recommended host: Render

[Render](https://render.com) is a straightforward place to run a small Node app. A free or starter web service is enough.

1. Push this project to a Git repository (GitHub, GitLab, or Bitbucket). Do not commit `.env`.
2. In Render, create a new **Web Service** and point it at that repo. You can also use the included `render.yaml`.
3. Use these settings:
   - **Runtime:** Node
   - **Build command:** `npm ci --omit=dev`
   - **Start command:** `npm start`
4. Add environment variables: `NODE_ENV=production`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `BASE_URL` (your `https://….onrender.com` URL, or a custom domain).
5. Deploy, open the URL, and add the same URL as a Stripe webhook endpoint.

**Railway** and **Fly.io** are also good fits. On Railway, create a Node service from the repo, set the same environment variables, and use `npm start`. On Fly, `fly launch` in this folder, set secrets with `fly secrets set`, and deploy. Whatever you choose, keep the secret key only in the host's secret store.

## Security notes

- Card details are collected only on Stripe's hosted Checkout page.
- Tip amounts are validated on the server: the presets `$1`, `$3`, and `$5`, or a whole-dollar custom amount from `$1` to `$100`.
- The checkout endpoint is rate limited (20 requests per minute per IP).
- Security headers are set with Helmet, including a strict Content-Security-Policy. In production, HTTPS is assumed and HSTS is enabled.
- The webhook route verifies Stripe signatures and needs the raw request body. Do not put a generic JSON parser in front of it.
- Dependencies are pinned in `package-lock.json`. After installing, run `npm audit`.

## Project layout

```
server.js              Express app, Stripe, security headers
public/                The garden, tip success/cancel pages, PWA assets
scripts/verify.mjs     API tests that do not need a Stripe key
.env.example           Environment template — copy to .env
```

Progress is stored in the browser, not in a database. Clearing site data resets the garden.
