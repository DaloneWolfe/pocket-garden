'use strict';

const SAVE_KEY = 'pocket-garden-save';
const GOLDEN_FLAG = 'pocket-garden-golden-can';
const PLOT_COUNT = 9;
const PLOT_COSTS = Object.freeze([0, 0, 0, 0, 40, 80, 150, 250, 400]);
const WATER_REMAINING_FACTOR = 0.8;

const PLANTS = {
  clover: {
    id: 'clover',
    name: 'Clover',
    blurb: 'Lucky, humble, and quick to sprout.',
    unlock: 0,
    seedCost: 0,
    growMs: 45 * 1000,
    harvest: 3,
  },
  daisy: {
    id: 'daisy',
    name: 'Daisy',
    blurb: 'A cheerful face for any weather.',
    unlock: 0,
    seedCost: 2,
    growMs: 2 * 60 * 1000,
    harvest: 6,
  },
  mint: {
    id: 'mint',
    name: 'Mint',
    blurb: 'Cool leaves with a sweet little spike.',
    unlock: 25,
    seedCost: 5,
    growMs: 5 * 60 * 1000,
    harvest: 14,
  },
  tomato: {
    id: 'tomato',
    name: 'Cherry tomato',
    blurb: 'A sunny cluster of tiny fruit.',
    unlock: 60,
    seedCost: 10,
    growMs: 12 * 60 * 1000,
    harvest: 28,
  },
  sunflower: {
    id: 'sunflower',
    name: 'Sunflower',
    blurb: 'Tall, gold, and always looking up.',
    unlock: 120,
    seedCost: 18,
    growMs: 25 * 60 * 1000,
    harvest: 55,
  },
  rose: {
    id: 'rose',
    name: 'Rose',
    blurb: 'Slow, fragrant, and a little proud.',
    unlock: 250,
    seedCost: 30,
    growMs: 45 * 60 * 1000,
    harvest: 90,
  },
  moonflower: {
    id: 'moonflower',
    name: 'Moonflower',
    blurb: 'Opens on its own time, pale as moonlight.',
    unlock: 500,
    seedCost: 50,
    growMs: 2 * 60 * 60 * 1000,
    harvest: 180,
  },
};

const PLANT_ORDER = Object.keys(PLANTS);

const $ = (id) => document.getElementById(id);

let state = null;
let watering = false;
let plantTarget = null;
let tipConfig = { configured: false, mode: null };
let tipPending = false;
let toastTimer = 0;

function defaultState() {
  return {
    v: 1,
    coins: 20,
    unlockedPlots: 4,
    unlockedPlants: ['clover', 'daisy'],
    plots: Array.from({ length: PLOT_COUNT }, (_, id) => ({
      id,
      plantId: null,
      plantedAt: null,
      wateredAt: null,
    })),
    goldenCan: false,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
    seenHelp: false,
    totalHarvests: 0,
    totalEarned: 0,
  };
}

function loadState() {
  const fresh = defaultState();
  try {
    if (localStorage.getItem(GOLDEN_FLAG) === '1') fresh.goldenCan = true;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return fresh;

    const next = { ...fresh, ...saved, v: 1 };
    next.coins = Number.isFinite(saved.coins) ? Math.max(0, Math.floor(saved.coins)) : fresh.coins;
    next.unlockedPlots = Math.min(PLOT_COUNT, Math.max(4, Math.floor(saved.unlockedPlots || 4)));
    next.unlockedPlants = Array.isArray(saved.unlockedPlants)
      ? saved.unlockedPlants.filter((id) => PLANTS[id])
      : fresh.unlockedPlants;
    if (!next.unlockedPlants.includes('clover')) next.unlockedPlants.unshift('clover');
    next.goldenCan = Boolean(saved.goldenCan) || fresh.goldenCan;
    next.plots = fresh.plots.map((slot, id) => {
      const plot = (saved.plots && saved.plots[id]) || slot;
      const plantId = PLANTS[plot.plantId] ? plot.plantId : null;
      return {
        id,
        plantId,
        plantedAt: plantId && Number.isFinite(plot.plantedAt) ? plot.plantedAt : null,
        wateredAt: plantId && Number.isFinite(plot.wateredAt) ? plot.wateredAt : null,
      };
    });
    return next;
  } catch {
    return fresh;
  }
}

function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    if (state.goldenCan) localStorage.setItem(GOLDEN_FLAG, '1');
  } catch {
    // Private mode or full storage should not break the live session.
  }
}

function plantReadyAt(plot) {
  const plant = PLANTS[plot.plantId];
  if (!plant || !plot.plantedAt) return 0;
  if (plot.wateredAt && plot.wateredAt >= plot.plantedAt) {
    const elapsedThen = Math.min(Math.max(0, plot.wateredAt - plot.plantedAt), plant.growMs);
    const remaining = (plant.growMs - elapsedThen) * WATER_REMAINING_FACTOR;
    return plot.wateredAt + remaining;
  }
  return plot.plantedAt + plant.growMs;
}

function plantProgress(plot, now) {
  const readyAt = plantReadyAt(plot);
  const start = plot.plantedAt;
  if (!start || readyAt <= start) return 1;
  return Math.max(0, Math.min(1, (now - start) / (readyAt - start)));
}

function plantStage(progress) {
  if (progress >= 1) return 'ready';
  if (progress >= 0.72) return 'budding';
  if (progress >= 0.38) return 'growing';
  if (progress >= 0.12) return 'sprout';
  return 'seed';
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s && m < 3 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function formatAge(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000);
  if (days > 1) return `Tended for ${days} days`;
  if (days === 1) return 'Tended for a day';
  if (hours >= 2) return `Tended for ${hours} hours`;
  if (minutes >= 5) return 'A quiet afternoon garden';
  return 'A brand-new patch';
}

function svgWrap(inner) {
  return `<svg viewBox="0 0 80 100" aria-hidden="true">${inner}</svg>`;
}

function seedArt() {
  return `<ellipse cx="40" cy="86" rx="7" ry="5" fill="#5a3c1c"/><ellipse cx="38" cy="85" rx="2" ry="1.4" fill="#c9a16b66"/>`;
}

function sproutArt(leaf = '#6a9a62', leaf2 = '#3f6b4e') {
  return `
    <path d="M40 90 C40 76 40 70 40 62" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
    <path d="M40 76 C30 72 26 64 28 58 C36 61 40 70 40 76Z" fill="${leaf}"/>
    <path d="M40 76 C50 72 54 64 52 58 C44 61 40 70 40 76Z" fill="${leaf2}"/>
  `;
}

function plantArt(id, stage) {
  if (stage === 'seed') return svgWrap(seedArt());
  if (stage === 'sprout') return svgWrap(sproutArt());

  const growing = stage === 'growing';
  const budding = stage === 'budding';

  if (id === 'clover') {
    const bloom = stage === 'ready'
      ? `<circle cx="28" cy="36" r="5" fill="#f7f2e8"/><circle cx="52" cy="34" r="5" fill="#f7f2e8"/><circle cx="40" cy="28" r="4.5" fill="#f7f2e8"/>`
      : budding
        ? `<circle cx="28" cy="38" r="3" fill="#dfe8c8"/><circle cx="52" cy="36" r="3" fill="#dfe8c8"/>`
        : '';
    return svgWrap(`
      <path d="M40 92 V48" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 68 C22 68 20 50 32 52 C34 42 46 42 48 52 C60 50 58 68 40 68Z" fill="#3f6b4e"/>
      <path d="M28 58 C18 60 18 46 28 46 C30 38 40 40 38 50 C32 50 28 54 28 58Z" fill="#6a9a62"/>
      <path d="M52 56 C62 58 62 44 52 44 C50 36 40 38 42 48 C48 48 52 52 52 56Z" fill="#6a9a62"/>
      ${bloom}
    `);
  }

  if (id === 'daisy') {
    const head = stage === 'ready'
      ? `<g transform="translate(40 34)">
           ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse transform="rotate(${a})" cy="-8" rx="3.2" ry="7.2" fill="#f7f2e8"/>`).join('')}
           <circle r="5" fill="#f0c75e"/>
         </g>`
      : budding
        ? `<circle cx="40" cy="36" r="6" fill="#f7f2e8"/><circle cx="40" cy="36" r="3" fill="#f0c75e"/>`
        : `<circle cx="40" cy="40" r="4" fill="#6a9a62"/>`;
    return svgWrap(`
      <path d="M40 92 C42 70 36 58 40 34" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 68 C26 66 24 54 32 54 C36 60 40 64 40 68Z" fill="#6a9a62"/>
      <path d="M40 60 C52 54 56 46 50 44 C46 52 42 58 40 60Z" fill="#3f6b4e"/>
      ${head}
    `);
  }

  if (id === 'mint') {
    const spike = stage === 'ready'
      ? `<path d="M40 42 V20" stroke="#7a5ea7" stroke-width="4" stroke-linecap="round"/>
         <circle cx="37" cy="24" r="2.2" fill="#9b7ec8"/><circle cx="43" cy="28" r="2.2" fill="#9b7ec8"/>
         <circle cx="37" cy="32" r="2.2" fill="#9b7ec8"/><circle cx="43" cy="36" r="2.2" fill="#9b7ec8"/>`
      : budding
        ? `<path d="M40 44 V30" stroke="#7a5ea7" stroke-width="3" stroke-linecap="round"/>`
        : '';
    return svgWrap(`
      <path d="M40 92 V36" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 80 C24 78 20 64 30 62 C24 70 32 80 40 80Z" fill="#3f6b4e"/>
      <path d="M40 80 C56 78 60 64 50 62 C56 70 48 80 40 80Z" fill="#6a9a62"/>
      <path d="M40 66 C26 62 24 50 34 50 C30 58 36 66 40 66Z" fill="#6a9a62"/>
      <path d="M40 66 C54 62 56 50 46 50 C50 58 44 66 40 66Z" fill="#3f6b4e"/>
      ${growing && !budding && !spike ? `<circle cx="40" cy="40" r="3.5" fill="#4d7a4f"/>` : spike}
    `);
  }

  if (id === 'tomato') {
    const fruit = stage === 'ready'
      ? `<circle cx="32" cy="40" r="6" fill="#d4543a"/><circle cx="48" cy="36" r="6.5" fill="#c43b2a"/><circle cx="40" cy="48" r="5.5" fill="#e06a4a"/><circle cx="30" cy="38" r="1.5" fill="#fff6"/>`
      : budding
        ? `<circle cx="34" cy="42" r="3.5" fill="#8fce74"/><circle cx="46" cy="38" r="3.5" fill="#8fce74"/>`
        : '';
    return svgWrap(`
      <path d="M40 92 C38 70 44 60 36 42" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
      <path d="M38 70 C24 60 22 48 32 50 C34 58 38 64 38 70Z" fill="#3f6b4e"/>
      <path d="M42 62 C58 54 58 40 48 42 C48 52 44 58 42 62Z" fill="#6a9a62"/>
      ${fruit || `<circle cx="36" cy="44" r="3" fill="#4d7a4f"/>`}
    `);
  }

  if (id === 'sunflower') {
    const head = stage === 'ready'
      ? `<g transform="translate(40 28)">
           ${[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => `<ellipse transform="rotate(${a})" cy="-10" rx="3.4" ry="8.4" fill="#f0c75e"/>`).join('')}
           <circle r="7" fill="#5a3c1c"/>
           <circle r="3.2" fill="#3d2818"/>
         </g>`
      : budding
        ? `<circle cx="40" cy="30" r="8" fill="#e2b84c"/><circle cx="40" cy="30" r="4" fill="#5a3c1c"/>`
        : `<circle cx="40" cy="36" r="5" fill="#6a9a62"/>`;
    return svgWrap(`
      <path d="M40 94 V28" fill="none" stroke="#3f6b4e" stroke-width="4" stroke-linecap="round"/>
      <path d="M40 72 C18 70 16 50 32 52 C30 64 36 72 40 72Z" fill="#3f6b4e"/>
      <path d="M40 64 C60 58 62 42 48 44 C48 56 44 62 40 64Z" fill="#6a9a62"/>
      ${head}
    `);
  }

  if (id === 'rose') {
    const bloom = stage === 'ready'
      ? `<g transform="translate(40 32)">
           <circle r="11" fill="#b44b5c"/>
           <path d="M0 8 C6 2 6 -4 0 -6 C-6 -4 -6 2 0 8Z" fill="#d46a78"/>
           <path d="M-1 2 C2 -2 5 0 3 4 C0 6 -3 5 -1 2Z" fill="#f0c0c8"/>
         </g>`
      : budding
        ? `<path d="M40 42 C34 34 36 24 40 24 C44 24 46 34 40 42Z" fill="#b44b5c"/>`
        : `<circle cx="40" cy="36" r="4" fill="#4d7a4f"/>`;
    return svgWrap(`
      <path d="M40 94 V36" fill="none" stroke="#3f6b4e" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 58 L48 50" stroke="#3f6b4e" stroke-width="2"/>
      <path d="M40 78 C24 76 22 62 32 62 C34 70 38 76 40 78Z" fill="#3f6b4e"/>
      <path d="M40 68 C54 62 56 50 46 52 C46 60 42 66 40 68Z" fill="#6a9a62"/>
      ${bloom}
    `);
  }

  const moon = stage === 'ready'
    ? `<path d="M40 24 C28 26 22 40 32 48 C24 36 30 24 42 26 C44 30 44 36 40 40 C52 36 52 24 40 24Z" fill="#e8e0f4" stroke="#c8b8e0" stroke-width="1"/>`
    : budding
      ? `<path d="M38 36 C32 38 30 46 36 50 C32 42 36 36 42 38 C40 42 38 44 36 46 C44 44 44 36 38 36Z" fill="#d8d0ea"/>`
      : `<circle cx="40" cy="40" r="4" fill="#6a7a9a"/>`;
  return svgWrap(`
    <path d="M26 92 C30 70 54 62 40 36" fill="none" stroke="#4d6a58" stroke-width="3" stroke-linecap="round"/>
    <path d="M34 70 C20 64 22 50 32 54 C32 62 34 68 34 70Z" fill="#3f6b4e"/>
    <path d="M46 58 C60 50 56 38 46 42 C48 50 46 56 46 58Z" fill="#6a9a62"/>
    ${moon}
  `);
}

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function setWaterMode(on) {
  watering = on;
  const btn = $('btn-water');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('water-label').textContent = on ? 'Tap a plant' : 'Water';
}

function canWater(plot, now) {
  if (!plot.plantId || plot.wateredAt) return false;
  return plantProgress(plot, now) < 1;
}

function noteAwayGrowth(previousSeen) {
  const now = Date.now();
  if (!previousSeen || now - previousSeen < 8000) return;
  const ready = state.plots.filter((plot) => {
    if (!plot.plantId) return false;
    const readyAt = plantReadyAt(plot);
    return readyAt <= now && readyAt > previousSeen;
  }).length;
  const note = $('away-note');
  if (!ready) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  note.textContent =
    ready === 1
      ? 'While you were away, a plant finished growing.'
      : `While you were away, ${ready} plants finished growing.`;
}

function renderPills() {
  $('coin-count').textContent = String(state.coins);
  $('garden-age').textContent = formatAge(Date.now() - state.startedAt);
  const waterBtn = $('btn-water');
  waterBtn.classList.toggle('has-gold', state.goldenCan);
}

function renderPlots() {
  const now = Date.now();
  const root = $('plots');
  const existing = root.children.length === PLOT_COUNT;

  state.plots.forEach((plot, index) => {
    let btn = existing ? root.children[index] : document.createElement('button');
    if (!existing) {
      btn.type = 'button';
      btn.className = 'plot';
      btn.addEventListener('click', () => onPlotClick(plot.id));
      root.appendChild(btn);
    }

    const locked = index >= state.unlockedPlots;
    const plant = PLANTS[plot.plantId];
    const progress = plant ? plantProgress(plot, now) : 0;
    const stage = plant ? plantStage(progress) : 'empty';

    btn.classList.toggle('is-locked', locked);
    btn.classList.toggle('is-ready', stage === 'ready');
    btn.disabled = false;

    let label;
    let art;
    if (locked) {
      label = `Locked · ${PLOT_COSTS[index]} coins`;
      art = `<svg viewBox="0 0 24 24" fill="none" stroke="#f6eedc" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
    } else if (!plant) {
      label = 'Empty';
      art = '';
    } else if (stage === 'ready') {
      label = `${plant.name} · Ready`;
      art = plantArt(plant.id, stage);
    } else {
      label = `${plant.name} · ${formatDuration(plantReadyAt(plot) - now)}`;
      art = plantArt(plant.id, stage);
    }

    const watered = Boolean(plant && plot.wateredAt);
    btn.innerHTML = `
      <span class="plot-art">${art}</span>
      ${plant && stage !== 'ready' ? `<span class="plot-progress"><span style="width:${Math.round(progress * 100)}%"></span></span>` : ''}
      ${watered ? '<span class="water-drop" title="Watered"></span>' : ''}
      <span class="plot-label"></span>
    `;
    btn.querySelector('.plot-label').textContent = label;
    btn.setAttribute('aria-label', locked ? `Locked plot, ${PLOT_COSTS[index]} coins to unlock` : label);
  });
}

function renderPlantSheet() {
  const list = $('plant-list');
  list.replaceChildren();
  PLANT_ORDER.forEach((id) => {
    const plant = PLANTS[id];
    const unlocked = state.unlockedPlants.includes(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.disabled = !unlocked || state.coins < plant.seedCost;
    btn.innerHTML = `<span class="choice-art">${plantArt(id, 'ready')}</span><span class="choice-copy"></span><span class="price"></span>`;
    const copy = btn.querySelector('.choice-copy');
    const title = document.createElement('strong');
    title.textContent = plant.name;
    const blurb = document.createElement('span');
    blurb.className = 'muted';
    if (!unlocked) blurb.textContent = `Unlock in the shop for ${plant.unlock} coins`;
    else blurb.textContent = `${plant.blurb} · ${formatDuration(plant.growMs)} · +${plant.harvest} coins`;
    copy.append(title, blurb);
    btn.querySelector('.price').textContent = unlocked ? (plant.seedCost ? `${plant.seedCost} coins` : 'Free') : 'Locked';
    if (unlocked) {
      btn.addEventListener('click', () => plantSeed(id));
    }
    list.appendChild(btn);
  });
}

function renderShop() {
  const body = $('shop-body');
  body.replaceChildren();

  const plotTitle = document.createElement('h3');
  plotTitle.textContent = 'Plots';
  plotTitle.style.fontFamily = 'var(--font-display)';
  plotTitle.style.margin = '0 0 0.55rem';
  body.appendChild(plotTitle);

  if (state.unlockedPlots >= PLOT_COUNT) {
    const done = document.createElement('p');
    done.className = 'muted';
    done.textContent = 'Every plot in this little bed is open.';
    body.appendChild(done);
  } else {
    const next = state.unlockedPlots;
    const cost = PLOT_COSTS[next];
    const row = document.createElement('div');
    row.className = 'shop-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = state.coins >= cost ? `Unlock for ${cost}` : `Need ${cost}`;
    btn.disabled = state.coins < cost;
    btn.addEventListener('click', () => unlockPlot());
    row.innerHTML = `<span class="shop-art">${svgWrap(seedArt())}</span><span class="shop-copy"></span>`;
    const copy = row.querySelector('.shop-copy');
    const title = document.createElement('strong');
    title.textContent = `Plot ${next + 1}`;
    const blurb = document.createElement('span');
    blurb.className = 'muted';
    blurb.textContent = 'Another square of earth to tend.';
    copy.append(title, blurb);
    row.appendChild(btn);
    body.appendChild(row);
  }

  const plantTitle = document.createElement('h3');
  plantTitle.textContent = 'Plants';
  plantTitle.style.fontFamily = 'var(--font-display)';
  plantTitle.style.margin = '1rem 0 0.55rem';
  body.appendChild(plantTitle);

  PLANT_ORDER.forEach((id) => {
    const plant = PLANTS[id];
    const owned = state.unlockedPlants.includes(id);
    const row = document.createElement('div');
    row.className = 'shop-row' + (owned ? ' is-owned' : '');
    row.innerHTML = `<span class="shop-art">${plantArt(id, 'ready')}</span><span class="shop-copy"></span>`;
    const copy = row.querySelector('.shop-copy');
    const title = document.createElement('strong');
    title.textContent = plant.name;
    const blurb = document.createElement('span');
    blurb.className = 'muted';
    blurb.textContent = owned
      ? `${plant.blurb} Already in your seed tin.`
      : `${plant.blurb} Grows in ${formatDuration(plant.growMs)}, harvests for ${plant.harvest} coins.`;
    copy.append(title, blurb);
    if (owned) {
      const mark = document.createElement('span');
      mark.className = 'price';
      mark.textContent = 'Owned';
      row.appendChild(mark);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = state.coins >= plant.unlock ? `Unlock for ${plant.unlock}` : `Need ${plant.unlock}`;
      btn.disabled = state.coins < plant.unlock;
      btn.addEventListener('click', () => unlockPlant(id));
      row.appendChild(btn);
    }
    body.appendChild(row);
  });
}

function openSheet(id) {
  const dialog = $(id);
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
}

function closeSheet(id) {
  const dialog = $(id);
  if (dialog.open) dialog.close();
}

function onPlotClick(id) {
  const plot = state.plots[id];
  const now = Date.now();

  if (id >= state.unlockedPlots) {
    setWaterMode(false);
    renderShop();
    openSheet('shop-sheet');
    showToast('Unlock this plot in the shop.');
    return;
  }

  if (watering) {
    if (canWater(plot, now)) {
      plot.wateredAt = now;
      setWaterMode(false);
      saveState();
      render();
      showToast(state.goldenCan ? 'The golden can drinks in the light.' : 'Watered. It will be ready a little sooner.');
    } else if (!plot.plantId) {
      showToast('Nothing to water in that plot.');
    } else if (plantProgress(plot, now) >= 1) {
      showToast('That plant is already ready to harvest.');
    } else {
      showToast('Already watered this cycle.');
    }
    return;
  }

  if (!plot.plantId) {
    plantTarget = id;
    renderPlantSheet();
    openSheet('plant-sheet');
    return;
  }

  if (plantProgress(plot, now) >= 1) {
    harvest(id);
    return;
  }

  const left = formatDuration(plantReadyAt(plot) - now);
  showToast(`${PLANTS[plot.plantId].name} will be ready in ${left}.`);
}

function plantSeed(plantId) {
  const plant = PLANTS[plantId];
  const plot = state.plots[plantTarget];
  if (!plot || plot.plantId || plantTarget >= state.unlockedPlots) return;
  if (!state.unlockedPlants.includes(plantId)) return;
  if (state.coins < plant.seedCost) {
    showToast('Not enough coins for that seed.');
    return;
  }
  state.coins -= plant.seedCost;
  plot.plantId = plantId;
  plot.plantedAt = Date.now();
  plot.wateredAt = null;
  closeSheet('plant-sheet');
  saveState();
  render();
}

function harvest(id) {
  const plot = state.plots[id];
  const plant = PLANTS[plot.plantId];
  if (!plant) return;
  const now = Date.now();
  if (plantProgress(plot, now) < 1) return;
  state.coins += plant.harvest;
  state.totalHarvests += 1;
  state.totalEarned += plant.harvest;
  plot.plantId = null;
  plot.plantedAt = null;
  plot.wateredAt = null;
  saveState();
  render();
  showToast(`Harvested ${plant.name} for ${plant.harvest} coins.`);
}

function unlockPlot() {
  if (state.unlockedPlots >= PLOT_COUNT) return;
  const cost = PLOT_COSTS[state.unlockedPlots];
  if (state.coins < cost) return;
  state.coins -= cost;
  state.unlockedPlots += 1;
  saveState();
  renderShop();
  render();
  showToast('A new plot is yours.');
}

function unlockPlant(id) {
  const plant = PLANTS[id];
  if (!plant || state.unlockedPlants.includes(id)) return;
  if (state.coins < plant.unlock) return;
  state.coins -= plant.unlock;
  state.unlockedPlants.push(id);
  saveState();
  renderShop();
  render();
  showToast(`${plant.name} is in your seed tin.`);
}

function render() {
  renderPills();
  renderPlots();
}

function applyTipConfig(config) {
  tipConfig = config;
  const notice = $('tip-notice');
  const amounts = document.querySelectorAll('#tip-amounts .amount, #btn-custom-tip, #custom-tip');
  if (!config.configured) {
    notice.hidden = false;
    notice.className = 'notice is-warn';
    notice.textContent = config.message || 'Payments are not configured yet.';
    amounts.forEach((el) => {
      el.disabled = true;
    });
    $('tip-status').textContent = 'The tip jar will open once a Stripe test key is added on the server.';
    return;
  }
  notice.hidden = config.mode !== 'test';
  notice.className = 'notice';
  notice.textContent =
    config.mode === 'test'
      ? 'Test mode is on. Use a Stripe test card — no real charges will be made.'
      : '';
  amounts.forEach((el) => {
    el.disabled = false;
  });
  $('tip-status').textContent = '';
}

async function loadTipConfig() {
  try {
    const res = await fetch('/api/checkout-config', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    applyTipConfig(data);
  } catch {
    applyTipConfig({
      configured: false,
      message: 'Payments are not configured yet. The tip jar could not reach the server.',
    });
  }
}

async function startCheckout(amountCents) {
  if (tipPending) return;
  if (!tipConfig.configured) {
    $('tip-status').textContent = 'Payments are not configured yet.';
    return;
  }
  tipPending = true;
  $('tip-status').textContent = 'Opening a secure Stripe checkout…';
  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ amountCents }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 || data.configured === false) {
      applyTipConfig({
        configured: false,
        message: data.error || 'Payments are not configured yet.',
      });
      return;
    }
    if (!res.ok || !data.url) {
      $('tip-status').textContent = data.error || 'Could not start checkout.';
      return;
    }
    window.location.href = data.url;
  } catch {
    $('tip-status').textContent = 'Could not start checkout. Please try again.';
  } finally {
    tipPending = false;
  }
}

function bindUi() {
  $('btn-water').addEventListener('click', () => setWaterMode(!watering));
  $('btn-shop').addEventListener('click', () => {
    setWaterMode(false);
    renderShop();
    openSheet('shop-sheet');
  });
  $('btn-tip').addEventListener('click', () => {
    setWaterMode(false);
    openSheet('tip-sheet');
  });
  $('btn-help').addEventListener('click', () => {
    setWaterMode(false);
    state.seenHelp = true;
    saveState();
    openSheet('help-sheet');
  });

  document.querySelectorAll('#tip-amounts .amount').forEach((btn) => {
    btn.addEventListener('click', () => startCheckout(Number(btn.dataset.cents)));
  });
  $('btn-custom-tip').addEventListener('click', () => {
    const value = Number($('custom-tip').value);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      $('tip-status').textContent = 'Enter a whole-dollar amount between $1 and $100.';
      return;
    }
    startCheckout(value * 100);
  });

  $('tip-form').addEventListener('submit', (event) => {
    // The close button is type=submit for the dialog. Prevent accidental tip posts.
    event.preventDefault();
  });
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function persistOnLeave() {
  const persist = () => {
    state.lastSeenAt = Date.now();
    saveState();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    else render();
  });
  window.addEventListener('pagehide', persist);
}

function init() {
  const previousSeen = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      return saved && Number.isFinite(saved.lastSeenAt) ? saved.lastSeenAt : null;
    } catch {
      return null;
    }
  })();

  state = loadState();
  noteAwayGrowth(previousSeen);
  state.lastSeenAt = Date.now();
  saveState();
  bindUi();
  render();
  loadTipConfig();
  registerWorker();
  persistOnLeave();

  window.setInterval(render, 1000);

  if (!state.seenHelp) {
    showToast('Tap an empty plot to plant your first seed.');
  }
}

init();
