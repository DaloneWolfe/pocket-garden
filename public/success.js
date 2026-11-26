'use strict';

const SAVE_KEY = 'pocket-garden-save';
const GOLDEN_FLAG = 'pocket-garden-golden-can';

function grantGoldenCan() {
  try {
    localStorage.setItem(GOLDEN_FLAG, '1');
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return;
    state.goldenCan = true;
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable; the dedicated flag is best-effort.
  }
}

function setStatus(text, granted) {
  const el = document.getElementById('success-status');
  if (el) el.textContent = text;
  const art = document.getElementById('success-art');
  if (art && granted) art.classList.add('granted');
}

async function confirmSession() {
  const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
  if (!sessionId) {
    setStatus('No checkout session was found. You can return to your garden.');
    return;
  }

  try {
    const res = await fetch('/api/session-status?session_id=' + encodeURIComponent(sessionId), {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.paid && data.grant === 'golden_can') {
      grantGoldenCan();
      setStatus(
        'Your tip is confirmed. A golden watering can is waiting in your garden — a small thank-you, nothing more.',
        true
      );
      return;
    }

    if (res.status === 503) {
      setStatus('Payments are not configured yet, so this tip could not be confirmed.');
      return;
    }

    setStatus('This payment could not be confirmed yet. If you were charged, refresh this page in a moment.');
  } catch {
    setStatus('Could not confirm the payment right now. If you were charged, refresh this page in a moment.');
  }
}

confirmSession();
