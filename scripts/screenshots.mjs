#!/usr/bin/env node
'use strict';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = process.env.SHOT_DIR || '/workspace/garden-site-shots';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

const now = Date.now();

function planted(id, progress, watered = false, growMs) {
  const p = Math.max(0, Math.min(progress, 1));
  // For unwatered plants, progress is elapsed / growMs.
  const plantedAt = now - Math.round(p * growMs) - (p >= 1 ? 8000 : 0);
  let wateredAt = null;
  if (watered && p < 1) {
    wateredAt = plantedAt + Math.round(growMs * Math.min(0.3, p * 0.5));
  }
  return { plantId: id, plantedAt, wateredAt };
}

const GROW = {
  clover: 45_000,
  daisy: 2 * 60_000,
  mint: 5 * 60_000,
  tomato: 12 * 60_000,
  sunflower: 25 * 60_000,
  rose: 45 * 60_000,
  moonflower: 2 * 60 * 60_000,
};

const lushSave = {
  v: 1,
  coins: 86,
  unlockedPlots: 7,
  unlockedPlants: ['clover', 'daisy', 'mint', 'tomato', 'sunflower'],
  plots: [
    { id: 0, ...planted('sunflower', 1, true, GROW.sunflower) },
    { id: 1, ...planted('daisy', 0.82, true, GROW.daisy) },
    { id: 2, ...planted('mint', 0.48, false, GROW.mint) },
    { id: 3, ...planted('clover', 1, false, GROW.clover) },
    { id: 4, ...planted('tomato', 0.16, false, GROW.tomato) },
    { id: 5, plantId: null, plantedAt: null, wateredAt: null },
    { id: 6, ...planted('rose', 0.62, true, GROW.rose) },
    { id: 7, plantId: null, plantedAt: null, wateredAt: null },
    { id: 8, plantId: null, plantedAt: null, wateredAt: null },
  ],
  goldenCan: false,
  startedAt: now - 4 * 60 * 60 * 1000,
  lastSeenAt: now - 60 * 1000,
  seenHelp: true,
  totalHarvests: 11,
  totalEarned: 74,
};

async function shot(page, name, width, height, after) {
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.plot');
  if (after) await after(page);
  await new Promise((r) => setTimeout(r, 500));
  const file = join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  console.log('wrote', file);
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.evaluateOnNewDocument((raw) => {
    localStorage.setItem('pocket-garden-save', raw);
  }, JSON.stringify(lushSave));

  try {
    await shot(page, 'phone-garden.png', 390, 844);
    await shot(page, 'desktop-garden.png', 1280, 800);
    await shot(page, 'phone-shop.png', 390, 844, async (p) => {
      await p.click('#btn-shop');
      await p.waitForSelector('#shop-sheet[open]');
    });
    await shot(page, 'desktop-tipjar.png', 1280, 800, async (p) => {
      await p.click('#btn-tip');
      await p.waitForSelector('#tip-sheet[open]');
    });
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
