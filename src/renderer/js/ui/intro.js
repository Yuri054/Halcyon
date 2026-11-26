// The launch scene: a short Halcyon "ident", like the studio cards games open with,
// played while a game is starting. A calm sea at first light, a kingfisher (the
// halcyon of the name) skimming low across it, the wordmark, then the game's own
// title card, which holds until the game's window takes over.
// Everything is drawn here: a canvas for sky and water, inline SVG for the bird.
import { h } from '../core/dom.js';
import { artImg, fallbackArt } from './art.js';

const BIRD = `
<svg viewBox="-60 -40 150 80" aria-hidden="true">
  <g class="intro__bird-body">
    <path class="intro__wing intro__wing--far" d="M-6 -4 C 4 -30, 22 -34, 34 -30 C 20 -22, 10 -12, 6 -2 Z"/>
    <path class="intro__back" d="M-38 2 C -26 -10, 0 -14, 22 -8 C 30 -6, 36 -2, 40 0 C 30 6, 8 12, -14 10 C -26 9, -34 6, -38 2 Z"/>
    <path class="intro__breast" d="M-14 10 C 4 12, 24 8, 38 1 C 30 9, 12 16, -8 14 Z"/>
    <path class="intro__tail" d="M-38 2 L -56 -4 L -54 4 L -38 6 Z"/>
    <path class="intro__beak" d="M38 -3 L 72 1 L 38 4 Z"/>
    <circle class="intro__eye" cx="30" cy="-3" r="2"/>
    <path class="intro__wing intro__wing--near" d="M-10 -2 C -2 -36, 20 -44, 36 -40 C 20 -28, 8 -14, 4 0 Z"/>
  </g>
</svg>`;

/** game: the library entry. Returns { el, status, bar, dispose }. */
export function createIntro(game) {
  const sea = h('canvas', { class: 'intro__sea' });
  const bird = h('div', { class: 'intro__bird', html: BIRD });
  const ripples = h('div', { class: 'intro__ripples' }, h('i'), h('i'), h('i'));
  const mark = h('div', { class: 'intro__mark' },
    h('div', { class: 'intro__word' }, ...'HALCYON'.split('').map((c, i) => h('span', { style: { '--n': i } }, c))),
    h('div', { class: 'intro__presents' }, 'presents'));
  const status = h('div', { class: 'launch__status intro__status' }, 'Starting');
  const bar = h('div', { class: 'launch__bar intro__bar' }, h('i'));
  const card = h('div', { class: 'intro__card' },
    h('div', { class: 'intro__backdrop' }, artImg(game.art.hero.length ? game.art.hero : game.art.cover, 'intro__backdrop-img', { lazy: false })),
    h('div', { class: 'intro__cover' }, fallbackArt(game), artImg(game.art.cover, 'intro__cover-img', { lazy: false })),
    h('div', { class: 'intro__title' },
      h('div', { class: 'intro__name' }, game.name),
      h('div', { class: 'intro__platform' }, game.platform),
      bar, status));
  const el = h('div', { class: 'layer layer--launch layer--intro' }, sea, ripples, bird, mark, card);

  // ---- sky and water
  const ctx = sea.getContext('2d');
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3ee08a';
  let raf = 0;
  let alive = true;
  const t0 = performance.now();

  function size() {
    const r = window.devicePixelRatio || 1;
    sea.width = Math.round(innerWidth * r * 0.6);
    sea.height = Math.round(innerHeight * r * 0.6);
    // The bird's flight, fitted to this screen: in low from the left, down to touch the
    // water at the middle (where the ripples are), and away up to the right.
    const W = innerWidth;
    const H = innerHeight;
    bird.style.offsetPath = `path('M ${-0.15 * W} ${0.3 * H} C ${0.15 * W} ${0.42 * H}, ${0.36 * W} ${0.565 * H}, ${0.5 * W} ${0.565 * H} S ${0.86 * W} ${0.4 * H}, ${1.2 * W} ${0.26 * H}')`;
  }
  size();
  addEventListener('resize', size);

  function draw(now) {
    if (!alive) return;
    raf = requestAnimationFrame(draw);
    const t = (now - t0) / 1000;
    const w = sea.width;
    const H = sea.height;
    const horizon = H * 0.58;
    // Dawn: the sky warms up over the first few seconds.
    const dawn = Math.min(1, t / 3.2);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, `rgba(4, 8, 14, 1)`);
    sky.addColorStop(0.55, mix('#0b1622', accent, 0.18 * dawn));
    sky.addColorStop(1, mix('#1c2b33', '#ffb070', 0.55 * dawn));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);
    // The sun, just breaking the horizon.
    const sunY = horizon + H * 0.05 - dawn * H * 0.07;
    const glow = ctx.createRadialGradient(w * 0.62, sunY, 0, w * 0.62, sunY, H * 0.5);
    glow.addColorStop(0, `rgba(255, 214, 160, ${0.9 * dawn})`);
    glow.addColorStop(0.08, `rgba(255, 190, 130, ${0.55 * dawn})`);
    glow.addColorStop(1, 'rgba(255, 170, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, horizon + 2);
    // Water: dark, with long low swells, catching the sun in a broken column.
    const water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, mix('#1a2a33', '#ffb070', 0.25 * dawn));
    water.addColorStop(0.25, '#0a141b');
    water.addColorStop(1, '#03070a');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, H - horizon);
    for (let i = 0; i < 46; i++) {
      const d = i / 46;                       // 0 at the horizon, 1 at the bottom
      const y = horizon + Math.pow(d, 1.9) * (H - horizon);
      const amp = 0.6 + d * 5;
      const len = 30 + d * 260;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const yy = y + Math.sin(x / len + t * (0.6 + d) + i) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = `rgba(160, 200, 210, ${0.05 + 0.08 * (1 - d)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Sun glints near the column under the sun.
      const spread = 20 + d * w * 0.16;
      for (let k = 0; k < 3; k++) {
        const gx = w * 0.62 + Math.sin(t * 1.7 + i * 3.1 + k * 2) * spread;
        const gl = 6 + d * 40 * (0.5 + 0.5 * Math.sin(t * 2.3 + i + k));
        ctx.fillStyle = `rgba(255, 210, 160, ${0.5 * dawn * (1 - d * 0.6)})`;
        ctx.fillRect(gx - gl / 2, y - 0.6, gl, 1.3 + d);
      }
    }
  }
  raf = requestAnimationFrame(draw);

  return {
    el,
    status,
    bar,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', size);
    },
  };
}

/** Blend two #rrggbb colours (the accent may also come as rgb()). */
function mix(a, b, t) {
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function parse(c) {
  if (c.startsWith('#')) {
    const n = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }
  const m = c.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [62, 224, 138];
}
