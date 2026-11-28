// Artwork loading with fallback chains, and the crossfading dashboard backdrop.
import { h, hashHue } from '../core/dom.js';

/** <img> that walks a list of candidate URLs and removes itself if none load. */
export function artImg(urls, cls, { lazy = true } = {}) {
  if (!urls || !urls.length) return null;
  const img = new Image();
  img.className = cls;
  img.decoding = 'async';
  if (lazy) img.loading = 'lazy';
  img.draggable = false;
  img.alt = '';
  img.dataset.first = urls[0];   // which picture this is, even after falling back to another URL
  let i = 0;
  img.addEventListener('error', () => {
    i += 1;
    if (i < urls.length) img.src = urls[i];
    else img.remove();
  });
  img.addEventListener('load', () => img.classList.add('is-loaded'));
  img.src = urls[0];
  return img;
}

/** Generated cover for games with no artwork: tinted gradient, platform mark and title. */
export function fallbackArt(game) {
  const hue = hashHue(game.name + (game.system || game.source));
  return h('div', { class: 'art-fallback', style: { '--hue': hue } },
    h('span', { class: 'art-fallback__mark' }, game.platformShort || game.platform),
    h('span', { class: 'art-fallback__title' }, game.name));
}

function firstLoadable(urls) {
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return resolve(null);
      const url = urls[i++];
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = next;
      img.src = url;
    };
    next();
  });
}

let token = 0;
let timer = null;
let shown = null;
let front = 0;

/** Crossfade the full-screen backdrop to the first URL that loads (debounced). */
export function setBackdrop(urls) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++token;
    const url = urls && urls.length ? await firstLoadable(urls) : null;
    if (mine !== token || url === shown) return;
    shown = url;
    const planes = [document.getElementById('bgA'), document.getElementById('bgB')];
    const next = planes[1 - front];
    next.style.backgroundImage = url ? `url("${url}")` : 'none';
    next.classList.toggle('is-on', Boolean(url));
    planes[front].classList.remove('is-on');
    front = 1 - front;
    document.getElementById('bg').classList.toggle('has-art', Boolean(url));
  }, 240);
}
