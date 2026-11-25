// On-screen keyboard, so text entry never needs a physical keyboard.
// Pad shortcuts: X backspace · Y space · LT shift · RT symbols · Start done.
import { h } from '../core/dom.js';
import * as focus from '../core/focus.js';
import * as input from '../core/input.js';
import { sfx } from '../core/sfx.js';
import { wait } from '../core/bus.js';

const LETTERS = ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.-'];
const SYMBOLS = ['!@#$%^&*()', '~`_=+[]{}|', '\\/:;"<>?%€', '£¥°•…—–·¿¡'];

export function keyboard({ title, value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    let text = value;
    let shift = false;
    let symbols = false;

    const field = h('div', { class: 'osk__field' });
    const keys = h('div', { class: 'osk__keys' });
    const el = h('div', { class: 'layer layer--osk' },
      h('div', { class: 'layer__scrim' }),
      h('div', { class: 'osk' }, h('div', { class: 'osk__title' }, title), field, keys));
    document.getElementById('layers').append(el);

    const paint = () => {
      field.replaceChildren(
        text ? h('span', null, text) : h('span', { class: 'osk__placeholder' }, placeholder),
        h('span', { class: 'osk__caret' }));
    };

    const special = (key, label, cls, fn, glyphAction) => {
      const btn = h('div', { class: `key key--wide ${cls}`, 'data-focus': true, 'data-key': key },
        glyphAction && h('span', { class: `glyph glyph--${glyphAction}`, 'data-glyph': glyphAction }, input.glyph(glyphAction)), label);
      btn.addEventListener('click', fn);
      return btn;
    };

    const build = () => {
      const keep = layer.current?.dataset.key;
      const rows = (symbols ? SYMBOLS : LETTERS).map((row, r) => h('div', { class: 'osk__row' },
        [...row].map((ch, c) => {
          const out = shift && !symbols ? ch.toUpperCase() : ch;
          const btn = h('div', { class: 'key', 'data-focus': true, 'data-key': `k:${r}:${c}` }, out);
          btn.addEventListener('click', () => type(out));
          return btn;
        })));
      rows.push(h('div', { class: 'osk__row' },
        special('shift', 'Shift', shift ? 'is-on' : '', () => { shift = !shift; build(); }, 'lt'),
        special('sym', symbols ? 'abc' : '#+=', '', () => { symbols = !symbols; build(); }, 'rt'),
        special('space', 'Space', 'key--space', () => type(' '), 'y'),
        special('del', 'Delete', '', erase, 'x'),
        special('done', 'Done', 'key--done', () => finish(text), 'start')));
      keys.replaceChildren(...rows);
      if (!(keep && focus.focusKey(keep, { layer, scroll: false }))) focus.focusKey('k:1:4', { layer, scroll: false });
    };

    const type = (ch) => {
      text += ch;
      if (shift) { shift = false; build(); }
      paint();
    };
    function erase() { text = text.slice(0, -1); paint(); }

    async function finish(result) {
      input.setRawKeyHook(null);
      focus.popLayer(layer);
      el.classList.add('is-closing');
      resolve(result);
      await wait(200);
      el.remove();
    }

    const layer = focus.pushLayer({
      root: el,
      current: null,
      onBack: () => { sfx.back(); finish(null); },
      onAction(action) {
        if (action === 'x') { erase(); sfx.typing(); return true; }
        if (action === 'y') { type(' '); sfx.typing(); return true; }
        if (action === 'lt') { shift = !shift; build(); return true; }
        if (action === 'rt') { symbols = !symbols; build(); return true; }
        if (action === 'start') { sfx.select(); finish(text); return true; }
        if (action === 'lb' || action === 'rb' || action === 'select') return true;
        return false;
      },
      hints: () => [
        { a: 'accept', label: 'Type' }, { a: 'x', label: 'Delete' }, { a: 'y', label: 'Space' },
        { a: 'start', label: 'Done' }, { a: 'back', label: 'Cancel' },
      ],
    });

    // A real keyboard just types.
    input.setRawKeyHook((e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        navigator.clipboard.readText().then((t) => { text += t.replace(/[\r\n]+/g, ' '); paint(); }).catch(() => {});
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'Enter') { finish(text); return true; }
      if (e.key === 'Escape') { finish(null); return true; }
      if (e.key === 'Backspace') { erase(); return true; }
      if (e.key.length === 1) { text += e.key; paint(); return true; }
      return false;
    });

    paint();
    build();
    sfx.open();
  });
}
