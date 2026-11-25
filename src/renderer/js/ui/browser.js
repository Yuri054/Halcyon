// Controller-friendly file and folder picker.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { api } from '../core/state.js';
import { sfx } from '../core/sfx.js';
import { wait } from '../core/bus.js';
import { keyboard } from './osk.js';

const VERBS = { dir: 'Choose a folder', image: 'Choose an image', exec: 'Choose a program', any: 'Choose a file' };

/** mode: 'dir' | 'image' | 'exec' | 'any'. Resolves with an absolute path or null. */
export function browse({ title, mode = 'any', start = '~' }) {
  return new Promise((resolve) => {
    const pathEl = h('div', { class: 'browser__path' });
    const places = h('div', { class: 'browser__places', 'data-focus-group': true, 'data-focus-restore': true });
    const list = h('div', { class: 'browser__list', 'data-scroller': 'y', 'data-focus-group': true, 'data-focus-restore': true });
    const preview = h('div', { class: 'browser__preview' });
    const el = h('div', { class: 'layer layer--browser' },
      h('div', { class: 'layer__scrim' }),
      h('div', { class: `browser browser--${mode}` },
        h('div', { class: 'browser__head' }, h('h2', null, title || VERBS[mode]), pathEl),
        h('div', { class: 'browser__body' }, places, list, mode === 'image' && preview)));
    document.getElementById('layers').append(el);

    let here = null;

    async function finish(result) {
      focus.popLayer(layer);
      el.classList.add('is-closing');
      resolve(result);
      await wait(220);
      el.remove();
    }

    const row = (key, iconName, label, sub, onSelect, extra = {}) => {
      const r = h('div', { class: `row ${extra.cls || ''}`, 'data-focus': true, 'data-key': key, 'data-verb': extra.verb },
        icon(iconName, 'row__icon'),
        h('div', { class: 'row__text' }, h('div', { class: 'row__label' }, label), sub && h('div', { class: 'row__sub' }, sub)));
      r.addEventListener('click', onSelect);
      if (extra.preview) r.dataset.preview = extra.preview;
      return r;
    };

    async function open(dir, focusPath) {
      const data = await api.files.list(dir, mode);
      here = data;
      pathEl.textContent = data.path;
      places.replaceChildren(...data.places.map((p) => row(`place:${p.path}`, 'folder', p.name, null, () => open(p.path), { cls: 'row--compact', verb: 'Go' })));
      const rows = [];
      if (mode === 'dir') rows.push(row('use', 'check', 'Use this folder', data.path, () => finish(data.path), { cls: 'row--primary', verb: 'Choose' }));
      if (data.parent) rows.push(row('up', 'up', 'Up one level', data.parent, () => open(data.parent, data.path), { verb: 'Open' }));
      for (const entry of data.entries) {
        rows.push(entry.dir
          ? row(`p:${entry.path}`, 'folder', entry.name, null, () => open(entry.path), { verb: 'Open' })
          : row(`p:${entry.path}`, mode === 'image' ? 'image' : 'file', entry.name, null, () => finish(entry.path), { preview: entry.preview, verb: 'Choose' }));
      }
      if (data.error) rows.push(h('div', { class: 'browser__empty' }, data.error));
      else if (!data.entries.length) rows.push(h('div', { class: 'browser__empty' }, mode === 'dir' ? 'No sub-folders here' : 'Nothing to choose in this folder'));
      list.replaceChildren(...rows);
      list.scrollTop = 0;
      layer.current = null;
      const target = (focusPath && focus.byKey(list, `p:${focusPath}`)) || rows.find((r) => r.dataset?.key?.startsWith('p:')) || rows[0];
      focus.focus(target, { layer, scroll: 'instant' });
    }

    const layer = focus.pushLayer({
      root: el,
      current: null,
      onBack: () => { sfx.back(); finish(null); },
      onAction(action) {
        if (action === 'lb' || action === 'x') {
          if (here?.parent) { sfx.back(); open(here.parent, here.path); }
          return true;
        }
        if (action === 'y') {
          keyboard({ title: 'Go to path', value: here?.path || '/' }).then((p) => { if (p) open(p); });
          return true;
        }
        if (action === 'rb' || action === 'start' || action === 'select') return true;
        return false;
      },
      hints: (target) => [
        { a: 'accept', label: target?.dataset.verb || 'Open' },
        { a: 'x', label: 'Up' }, { a: 'y', label: 'Type path' }, { a: 'back', label: 'Cancel' },
      ],
    });

    el.addEventListener('nav-focus', (e) => {
      if (mode !== 'image') return;
      const url = e.target.dataset.preview;
      preview.replaceChildren(url ? h('img', { src: url, alt: '' }) : h('div', { class: 'browser__preview-empty' }, icon('image')));
    });

    sfx.open();
    open(start);
  });
}
