#!/usr/bin/env node
'use strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

let failed = 0;

async function request(path, options = {}) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body, headers: res.headers };
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`ok   ${name}`);
    return;
  }
  failed += 1;
  console.error(`fail ${name}${detail ? ` — ${detail}` : ''}`);
}

async function postCheckout(amountCents, extra = {}) {
  const body = amountCents === undefined ? extra : { amountCents, ...extra };
  return request('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

async function run() {
  const health = await request('/api/health');
  check('health is ok', health.res.status === 200 && health.body.ok === true);

  const config = await request('/api/checkout-config');
  check(
    'checkout-config reports not configured',
    config.res.status === 200 && config.body.configured === false,
    JSON.stringify(config.body)
  );
  check(
    'checkout-config explains the state',
    typeof config.body.message === 'string' && /not configured/i.test(config.body.message)
  );
  check('checkout-config lists preset amounts', Array.isArray(config.body.amounts) && config.body.amounts.join() === '100,300,500');

  const validUnconfigured = await postCheckout(300);
  check(
    'valid tip amount without keys returns not-configured 503',
    validUnconfigured.res.status === 503 &&
      validUnconfigured.body.configured === false &&
      /not configured/i.test(validUnconfigured.body.error || ''),
    JSON.stringify(validUnconfigured.body)
  );

  const cases = [
    ['missing amount', {}, 400],
    ['string garbage', { amountCents: 'abc' }, 400],
    ['fractional cents', { amountCents: 150.5 }, 400],
    ['negative', { amountCents: -100 }, 400],
    ['below minimum', { amountCents: 99 }, 400],
    ['above maximum', { amountCents: 10001 }, 400],
    ['not a whole dollar', { amountCents: 250 }, 400],
    ['object amount', { amountCents: { gotcha: 100 } }, 400],
  ];

  for (const [name, payload, status] of cases) {
    const result = await postCheckout(undefined, payload);
    check(
      `rejects ${name}`,
      result.res.status === status && typeof result.body.error === 'string',
      `${result.res.status} ${JSON.stringify(result.body)}`
    );
  }

  const customOk = await postCheckout(2000);
  check(
    'valid custom amount still 503 without keys',
    customOk.res.status === 503 && customOk.body.configured === false
  );

  const presetString = await postCheckout(undefined, { amountCents: '500' });
  check(
    'preset amount as a digit string is accepted then 503',
    presetString.res.status === 503 && presetString.body.configured === false
  );

  const webhook = await request('/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  check(
    'webhook without keys returns 503',
    webhook.res.status === 503 && /not configured/i.test(webhook.body.error || '')
  );

  const page = await request('/');
  check('garden page is served', page.res.status === 200 && String(page.body).includes('Pocket Garden'));
  check(
    'Content-Security-Policy is present',
    /default-src 'self'/.test(page.headers.get('content-security-policy') || '')
  );
  check(
    'X-Content-Type-Options is nosniff',
    page.headers.get('x-content-type-options') === 'nosniff'
  );
  check(
    'X-Frame-Options or CSP frame-ancestors denies framing',
    /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || '') ||
      /DENY|SAMEORIGIN/i.test(page.headers.get('x-frame-options') || '')
  );

  const session = await request('/api/session-status?session_id=not-a-session');
  check(
    'session-status without keys is 503',
    session.res.status === 503 && session.body.configured === false
  );

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll API checks passed.');
}

run().catch((err) => {
  console.error('verify failed to run:', err.message);
  console.error(`Is the server up at ${BASE}?`);
  process.exit(1);
});
