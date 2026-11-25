// The side "blade": a menu panel that slides in over the dashboard.
// openPanel() keeps one panel on screen across several ask() calls so forms
// and sub-menus update in place instead of re-animating.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { wait } from '../core/bus.js';
import { artImg } from './art.js';

export function openPanel({ side = 'right', silent = false } = {}) {
  const head = h('div', { class: 'panel__head' });
  const list = h('div', { class: 'panel__list', 'data-scroller': 'y' });
  const scrim = h('div', { class: 'layer__scrim' });
  const el = h('div', { class: `layer layer--panel${side === 'left' ? ' layer--left' : ''}` }, scrim, h('aside', { class: 'panel' }, h('div', { class: 'panel__edge' }), head, list));
  document.getElementById('layers').append(el);

  let resolve = null;
  let extra = null;
  const finish = (value) => {
    const r = resolve;
    resolve = null;
    if (r) r(value);
  };
  const layer = focus.pushLayer({
    root: el,
    current: null,
    onBack: () => { sfx.back(); finish(null); },
    onAction: (action, target) => (extra ? extra(action, target, finish) : false),
    hints: (target) => [
      target && { a: 'accept', label: target.dataset.verb || 'Select' },
      ...(layer.extraHints || []),
      { a: 'back', label: 'Back' },
    ].filter(Boolean),
  });
  scrim.addEventListener('click', () => finish(null));
  if (!silent) sfx.open();

  return {
    /**
     * items: [{ label, value, sub, hint, iconName, checked, danger, disabled, heading, verb, key, meter }]
     * Resolves with the chosen item's value, or null when backed out.
     */
    ask({ title, subtitle, art, items, selected, onAction, hints }) {
      extra = onAction || null;
      layer.extraHints = hints || [];
      head.replaceChildren(
        art || '',
        h('div', { class: 'panel__titles' },
          h('h2', { class: 'panel__title' }, title),
          subtitle && h('div', { class: 'panel__subtitle' }, subtitle)));
      const rows = items.filter(Boolean).map((item, i) => {
        if (item.heading) return h('div', { class: 'panel__heading' }, item.heading);
        if (item.card) {
          // A custom block (such as a live download card); selectable when it has a value.
          const wrap = h('div', { class: `row row--card${item.cls ? ` ${item.cls}` : ''}`, 'data-focus': item.value != null, 'data-key': `row:${item.key ?? i}`, 'data-verb': item.verb }, item.card);
          wrap.itemValue = item.value;
          if (item.value != null) wrap.addEventListener('click', () => finish(item.value));
          return wrap;
        }
        const thumb = item.art && artImg(item.art, 'row__thumb-img', { lazy: false });
        const row = h('div', {
          class: `row${item.danger ? ' row--danger' : ''}${item.disabled ? ' row--disabled' : ''}${item.cls ? ` ${item.cls}` : ''}`,
          'data-focus': !item.disabled,
          'data-key': `row:${item.key ?? i}`,
          'data-verb': item.verb,
        },
        thumb ? h('div', { class: 'row__thumb' }, icon(item.iconName || 'grid', 'row__thumb-icon'), thumb) : item.iconName && icon(item.iconName, 'row__icon'),
        h('div', { class: 'row__text' },
          h('div', { class: 'row__label' }, item.label),
          item.sub && h('div', { class: 'row__sub' }, item.sub),
          item.meter != null && h('div', { class: 'row__meter' }, h('i', { style: { width: `${item.meter}%` } }))),
        item.hint != null && h('div', { class: 'row__hint' }, item.hint),
        item.checked != null && h('div', { class: `row__check${item.checked ? ' is-on' : ''}` }, icon('check')));
        row.itemValue = item.value;
        if (!item.disabled) row.addEventListener('click', () => finish(item.value));
        return row;
      });
      list.replaceChildren(...rows);
      const want = selected != null ? rows.find((r) => r.itemValue === selected) : null;
      const target = focus.usable(want) ? want : rows.find((r) => r.hasAttribute('data-focus'));
      layer.current = null;
      if (target) focus.focus(target, { scroll: 'instant', layer });
      return new Promise((r) => { resolve = r; });
    },
    el,
    /** Back out of the current ask() from outside (resolves it with null). */
    cancel: () => finish(null),
    async close() {
      finish(null);
      focus.popLayer(layer);
      el.classList.add('is-closing');
      await wait(240);
      el.remove();
    },
  };
}

/** One-shot menu. */
export async function menu(opts) {
  const panel = openPanel();
  const value = await panel.ask(opts);
  await panel.close();
  return value;
}

export async function confirm({ title, subtitle, yes = 'Confirm', no = 'Cancel', danger = false, iconName = 'check' }) {
  const value = await menu({
    title,
    subtitle,
    selected: danger ? 'no' : 'yes',
    items: [
      { label: yes, value: 'yes', iconName, danger },
      { label: no, value: 'no', iconName: 'up' },
    ],
  });
  return value === 'yes';
}
