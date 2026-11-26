// Adjust how a game's background sits in the home screen's wide tiles: move the part that
// stays in view with the stick or d-pad, zoom with LT / RT, and see it in each tile shape
// the dashboard uses. A saves, Y goes back to automatic, B leaves without saving.
import { h } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api, game as findGame } from '../core/state.js';
import { app } from '../core/bus.js';
import { artImg } from './art.js';
import { applyCrop } from './tile.js';

// The shapes a background appears in: the big feature tile, a wide tile, the narrow column.
const SHAPES = [['Feature', 1.84, 46], ['Wide tile', 1.9, 22], ['Narrow tile', 1.34, 15.5]];
const AUTO = { x: 50, y: 25, z: 1 };   // what tiles do without a crop (centre, a quarter down)

/** Resolves true if a crop was saved or cleared. */
export function cropBackground(gameId) {
  return new Promise((done) => {
    const g = findGame(gameId);
    const urls = g ? (g.art.hero.length ? g.art.hero : g.art.cover) : [];
    let crop = { ...AUTO, ...(g?.bgCrop || {}) };
    let closed = false;

    const imgs = [];
    const frames = SHAPES.map(([label, ratio, width]) => {
      const img = artImg(urls, 'crop__img', { lazy: false });
      if (img) imgs.push(img);
      return h('div', { class: 'crop__shape' },
        h('div', { class: 'crop__frame', style: { width: `${width}rem`, height: `${(width / ratio).toFixed(2)}rem` } }, img || ''),
        h('div', { class: 'crop__label' }, label));
    });
    // The whole picture, with the point that stays in view marked.
    const whole = artImg(urls, 'crop__whole', { lazy: false });
    const dot = h('div', { class: 'crop__dot' });
    const read = h('div', { class: 'crop__readout' });
    const el = h('div', { class: 'layer layer--crop' },
      h('div', { class: 'crop__head' }, h('div', { class: 'crop__title' }, 'Adjust background'), h('div', { class: 'crop__sub' }, g?.name || '')),
      h('div', { class: 'crop__body' },
        h('div', { class: 'crop__shapes' }, ...frames),
        h('div', { class: 'crop__side' }, h('div', { class: 'crop__wholebox' }, whole || '', dot), read)));
    document.getElementById('layers').append(el);

    function paint() {
      for (const img of imgs) applyCrop(img, crop);
      dot.style.left = `${crop.x}%`;
      dot.style.top = `${crop.y}%`;
      read.textContent = `Focus ${Math.round(crop.x)}% across, ${Math.round(crop.y)}% down · zoom ${crop.z.toFixed(2)}×`;
    }

    function close(save) {
      if (closed) return;
      closed = true;
      focus.popLayer(layer);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 250);
      app.refreshChrome();
      done(save);
    }

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const layer = focus.pushLayer({
      root: el,
      current: null,
      onBack: () => { sfx.back(); close(false); },
      onAction(action, _t, repeat) {
        const step = repeat ? 3 : 2;
        if (action === 'left') crop.x = clamp(crop.x - step, 0, 100);
        else if (action === 'right') crop.x = clamp(crop.x + step, 0, 100);
        else if (action === 'up') crop.y = clamp(crop.y - step, 0, 100);
        else if (action === 'down') crop.y = clamp(crop.y + step, 0, 100);
        else if (action === 'rt' || action === 'rup') crop.z = clamp(crop.z + 0.05, 1, 3);
        else if (action === 'lt' || action === 'rdown') crop.z = clamp(crop.z - 0.05, 1, 3);
        else if (action === 'y' && !repeat) { crop = { ...AUTO }; sfx.move(); }
        else if (action === 'accept' && !repeat) {
          const auto = crop.x === AUTO.x && crop.y === AUTO.y && crop.z === 1;
          api.game.patch(gameId, { bgCrop: auto ? null : { x: Math.round(crop.x * 10) / 10, y: Math.round(crop.y * 10) / 10, z: Math.round(crop.z * 100) / 100 } })
            .then(() => { sfx.select(); close(true); });
          return true;
        } else return false;
        paint();
        return true;
      },
      hints: () => [{ a: 'left', b: 'right', label: 'Move' }, { a: 'lt', b: 'rt', label: 'Zoom' }, { a: 'accept', label: 'Save' }, { a: 'y', label: 'Automatic' }, { a: 'back', label: 'Cancel' }],
    });
    sfx.open();
    paint();
    app.refreshChrome();
  });
}
