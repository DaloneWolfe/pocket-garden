'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');

const PORT = Number(process.env.PORT) || 3000;
const PRESET_AMOUNTS = Object.freeze([100, 300, 500]);
const MIN_CUSTOM_CENTS = 100;
const MAX_CUSTOM_CENTS = 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function secretKey() {
  return (process.env.STRIPE_SECRET_KEY || '').trim() || null;
}

function webhookSecret() {
  return (process.env.STRIPE_WEBHOOK_SECRET || '').trim() || null;
}

function paymentsConfigured() {
  return Boolean(secretKey());
}

function paymentMode() {
  const key = secretKey();
  if (!key) return null;
  return key.startsWith('sk_live_') ? 'live' : 'test';
}

function getStripe() {
  const key = secretKey();
  return key ? new Stripe(key) : null;
}

function getBaseUrl(req) {
  const fromEnv = (process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function parseAmount(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid request body.' };
  }

  const raw = body.amountCents;
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, error: 'Amount is required.' };
  }

  let amount;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      return { ok: false, error: 'Amount must be a whole number of cents.' };
    }
    amount = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      return { ok: false, error: 'Amount must be a whole number of cents.' };
    }
    amount = Number(trimmed);
  } else {
    return { ok: false, error: 'Amount must be a whole number of cents.' };
  }

  if (!Number.isSafeInteger(amount)) {
    return { ok: false, error: 'Amount is invalid.' };
  }

  if (PRESET_AMOUNTS.includes(amount)) {
    return { ok: true, amountCents: amount };
  }

  if (amount < MIN_CUSTOM_CENTS || amount > MAX_CUSTOM_CENTS) {
    return {
      ok: false,
      error: `Custom tips must be between $${MIN_CUSTOM_CENTS / 100} and $${MAX_CUSTOM_CENTS / 100}.`,
    };
  }

  if (amount % 100 !== 0) {
    return { ok: false, error: 'Custom tips must be in whole dollars.' };
  }

  return { ok: true, amountCents: amount };
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
    hsts:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
  })
);

app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  );
  next();
});

// Raw body is required for Stripe signature verification. This route must
// be registered before express.json().
app.post('/api/webhook', express.raw({ type: 'application/json', limit: '64kb' }), (req, res) => {
  const stripe = getStripe();
  const secret = webhookSecret();

  if (!stripe || !secret) {
    return res.status(503).json({ error: 'Payments are not configured yet.' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature header.' });
  }

  try {
    stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  // Tips are one-off Checkout payments. The thank-you cosmetic is granted
  // on the success page after the session is verified server-side, so there
  // is no additional state to store here.
  return res.json({ received: true });
});

app.use(express.json({ limit: '16kb' }));

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts. Please wait a minute and try again.' },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/checkout-config', (req, res) => {
  const configured = paymentsConfigured();
  res.json({
    configured,
    mode: paymentMode(),
    amounts: PRESET_AMOUNTS,
    minCustomCents: MIN_CUSTOM_CENTS,
    maxCustomCents: MAX_CUSTOM_CENTS,
    message: configured
      ? null
      : 'Payments are not configured yet. Add a Stripe test key to enable the tip jar.',
  });
});

app.post('/api/create-checkout-session', checkoutLimiter, async (req, res) => {
  const parsed = parseAmount(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }

  if (!paymentsConfigured()) {
    return res.status(503).json({
      configured: false,
      error: 'Payments are not configured yet.',
    });
  }

  try {
    const stripe = getStripe();
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: parsed.amountCents,
            product_data: {
              name: 'Tip for Pocket Garden',
              description:
                'A voluntary donation. Card details are handled by Stripe, not this site.',
            },
          },
        },
      ],
      metadata: {
        source: 'pocket-garden-tip',
        amountCents: String(parsed.amountCents),
      },
    });

    return res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again later.' });
  }
});

app.get('/api/session-status', async (req, res) => {
  if (!paymentsConfigured()) {
    return res.status(503).json({
      configured: false,
      error: 'Payments are not configured yet.',
    });
  }

  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id.trim() : '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId) || sessionId.length > 200) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';
    return res.json({
      paid,
      grant: paid ? 'golden_can' : null,
      amountCents: session.amount_total,
      currency: session.currency,
    });
  } catch {
    return res.status(404).json({ error: 'Session not found.' });
  }
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(js|css|svg|png|webmanifest)$/.test(filePath) || filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Garden listening on http://localhost:${PORT}`);
  if (!paymentsConfigured()) {
    console.log('Stripe is not configured. The tip jar will show a not-configured state.');
  }
});
