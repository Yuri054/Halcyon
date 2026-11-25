// Pop-up notifications: a pill that blooms open from its icon, then tucks away.
import { h, icon } from '../core/dom.js';
import { sfx } from '../core/sfx.js';

const queue = [];
let showing = false;

export function toast(message, { type = 'info', title = null, iconName = null, ms = 3600, sound = null } = {}) {
  queue.push({ message, type, title, iconName, ms, sound });
  if (!showing) next();
}

function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;
  const el = h('div', { class: `toast toast--${item.type}` },
    h('div', { class: 'toast__orb' }, icon(item.iconName || (item.type === 'error' ? 'warn' : item.type === 'pad' ? 'pad' : 'check'))),
    h('div', { class: 'toast__text' },
      item.title && h('div', { class: 'toast__title' }, item.title),
      h('div', { class: 'toast__msg' }, item.message)));
  document.getElementById('toasts').append(el);
  if (item.type === 'error') sfx.error(); else if (item.sound && sfx[item.sound]) sfx[item.sound](); else sfx.toast();
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => { el.remove(); next(); }, 420);
  }, item.ms + (item.type === 'error' ? 2200 : 0));
}
