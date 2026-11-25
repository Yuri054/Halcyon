// Spatial focus engine. Anything with [data-focus] is navigable; the topmost
// "layer" (base dashboard, or a dialog stacked above it) owns input.
//   [data-focus-group][data-focus-restore]  re-entering the group returns to its last item
//   [data-scroller="x|y"]                   scroll container that follows focus
//   [data-key]                              stable identity, survives re-renders

const layers = [];
const memory = new WeakMap();
let onChange = () => {};

export const setOnChange = (fn) => { onChange = fn; };
export const top = () => layers[layers.length - 1];
export const base = () => layers[0];
export const current = () => top()?.current || null;

export function usable(el) {
  return Boolean(el && el.isConnected && el.offsetParent !== null && !el.closest('[inert]') && !el.hasAttribute('data-disabled'));
}

export function items(root) {
  return [...root.querySelectorAll('[data-focus]')].filter(usable);
}

export function pushLayer(layer) {
  layers.push(layer);
  return layer;
}

export function popLayer(layer) {
  const i = layers.indexOf(layer);
  if (i >= 0) layers.splice(i, 1);
  const t = top();
  if (!t) return;
  if (!usable(t.current)) {
    t.current = null;
    const first = (t.fallback && t.fallback()) || items(t.root)[0];
    if (first && focus(first, { scroll: false })) return;
  }
  onChange(t.current, t);
}

function reveal(el, behavior) {
  const sc = el.closest('[data-scroller]');
  if (!sc) return;
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  // A theme can ask for "nearest" scrolling (--reveal: nearest): move only as far as needed
  // to keep the item in view, instead of centring it.
  if (getComputedStyle(sc).getPropertyValue('--reveal').trim() === 'nearest') {
    const margin = parseFloat(getComputedStyle(document.documentElement).fontSize) * 6;
    if (sc.dataset.scroller === 'x') {
      const left = r.left - s.left - margin;
      const right = r.right - s.right + margin;
      if (left < 0) sc.scrollTo({ left: sc.scrollLeft + left, behavior });
      else if (right > 0) sc.scrollTo({ left: sc.scrollLeft + Math.min(right, left), behavior });
    } else {
      const top = r.top - s.top - margin;
      const bottom = r.bottom - s.bottom + margin;
      if (top < 0) sc.scrollTo({ top: sc.scrollTop + top, behavior });
      else if (bottom > 0) sc.scrollTo({ top: sc.scrollTop + Math.min(bottom, top), behavior });
    }
    return;
  }
  if (sc.dataset.scroller === 'x') {
    sc.scrollTo({ left: sc.scrollLeft + (r.left + r.width / 2) - (s.left + s.width / 2), behavior });
  } else {
    sc.scrollTo({ top: sc.scrollTop + (r.top + r.height / 2) - (s.top + s.height / 2), behavior });
  }
}

/** Focus an element. `layer` defaults to the top layer; lower layers update silently. */
export function focus(el, { scroll = 'smooth', layer = top() } = {}) {
  if (!layer || !usable(el) || !layer.root.contains(el)) return false;
  if (layer.current && layer.current !== el) layer.current.classList.remove('is-focused');
  layer.root.querySelectorAll('.is-focused').forEach((n) => { if (n !== el) n.classList.remove('is-focused'); });
  layer.current = el;
  el.classList.add('is-focused');
  const group = el.closest('[data-focus-group]');
  if (group) memory.set(group, el);
  if (scroll) reveal(el, scroll);
  if (layer === top()) {
    onChange(el, layer);
    el.dispatchEvent(new CustomEvent('nav-focus', { bubbles: true }));
  }
  return true;
}

export function byKey(root, key) {
  return key ? root.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
}

export function focusKey(key, opts) {
  const layer = opts?.layer || top();
  return focus(byKey(layer.root, key), opts);
}

export function focusFirst(root, opts) {
  return focus(items(root)[0], opts);
}

/** Move focus in a direction using geometry. Returns false at an edge. */
export function move(dir) {
  const layer = top();
  if (!layer) return false;
  const list = items(layer.root);
  if (!list.length) return false;
  const cur = layer.current;
  if (!usable(cur) || !layer.root.contains(cur)) return focus(list[0]);

  const c = cur.getBoundingClientRect();
  const horiz = dir === 'left' || dir === 'right';
  const ccx = c.left + c.width / 2;
  const ccy = c.top + c.height / 2;
  let best = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const rcx = r.left + r.width / 2;
    const rcy = r.top + r.height / 2;
    let primary;
    if (dir === 'right') { if (rcx <= ccx + 1) continue; primary = r.left - c.right; }
    else if (dir === 'left') { if (rcx >= ccx - 1) continue; primary = c.left - r.right; }
    else if (dir === 'down') { if (rcy <= ccy + 1) continue; primary = r.top - c.bottom; }
    else { if (rcy >= ccy - 1) continue; primary = c.top - r.bottom; }

    const overlap = horiz
      ? Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top)
      : Math.min(c.right, r.right) - Math.max(c.left, r.left);
    // Overlapping along the travel axis without sharing a row/column means it
    // is really above/below (or beside) us, not in this direction.
    if (primary < -1 && overlap <= 0) continue;
    const ortho = overlap > 0 ? 0 : -overlap;
    const centerDiff = horiz ? Math.abs(rcy - ccy) : Math.abs(rcx - ccx);
    const score = Math.max(0, primary) + ortho * 4 + centerDiff * 0.3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;

  const group = best.closest('[data-focus-group]');
  if (group && group !== cur.closest('[data-focus-group]') && group.hasAttribute('data-focus-restore')) {
    const last = memory.get(group);
    if (usable(last) && group.contains(last)) best = last;
  }
  return focus(best);
}

/** Jump several steps at once (trigger paging). */
export function page(dir, steps) {
  let moved = false;
  const before = current();
  for (let i = 0; i < steps; i++) {
    const layer = top();
    const prevGroup = layer.current?.closest('[data-focus-group]');
    const prev = layer.current;
    if (!move(dir)) break;
    if (layer.current.closest('[data-focus-group]') !== prevGroup) { focus(prev); break; }
    moved = true;
  }
  return moved && current() !== before;
}
