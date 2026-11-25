// Store: Steam's front page and search, browsable from the couch.
// Buying is always handed to Steam itself; nothing here takes payment.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { api, state, game as findGame } from '../core/state.js';
import { app } from '../core/bus.js';
import { actionTile } from '../ui/tile.js';
import { artImg } from '../ui/art.js';
import { openPanel } from '../ui/dialog.js';
import { keyboard } from '../ui/osk.js';
import { toast } from '../ui/toast.js';
import { report } from '../ui/gamemenu.js';

const PAD = { full: 'Full controller support', partial: 'Partial controller support', none: 'No controller support' };

export function createStore() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--store' }, scroller);
  const items = new Map();   // appid -> listing, for context and backdrop
  let rails = null;
  let results = null;        // { term, items } while a search is showing
  let loading = false;
  let error = null;

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` },
    h('h3', { class: 'block__title' }, title), h('div', { class: 'block__tiles' }, tiles));

  function priceTag(p) {
    if (!p) return null;
    return h('div', { class: 'price' },
      p.discount > 0 && h('span', { class: 'price__cut' }, `-${p.discount}%`),
      p.was && h('span', { class: 'price__was' }, p.was),
      h('span', { class: 'price__now' }, p.text));
  }

  function storeTile(item, rail, index) {
    items.set(item.appid, item);
    const owned = findGame(`steam:${item.appid}`);
    const tile = h('div', {
      class: 'tile tile--wide tile--store', 'data-focus': true, 'data-key': `st:${rail}:${item.appid}`, 'data-app': item.appid,
      style: { '--i': Math.min(index, 22) },
    }, h('div', { class: 'tile__body' },
      artImg([item.image, item.fallbackImage].filter(Boolean), 'tile__img'),
      h('div', { class: 'tile__shade' }),
      h('div', { class: 'tile__caption' }, h('div', { class: 'tile__title' }, item.name)),
      priceTag(item.price),
      owned && h('div', { class: 'tile__badges' }, h('span', { class: 'badge', title: 'In your library' }, icon('check'))),
      h('div', { class: 'tile__sheen' })));
    tile.addEventListener('click', () => showDetails(item.appid));
    return tile;
  }

  function render() {
    if (!rails && !loading && !error) load();
    let i = 0;
    const tools = block('store', 'block--quick', [
      actionTile({ key: 'st:search', label: 'Search', sub: results ? `“${results.term}”` : 'The whole Steam store', iconName: 'search', tone: 'accent', index: i++, onSelect: doSearch }),
      actionTile({ key: 'st:steam', label: 'Open in Steam', sub: 'Cart, wishlist, checkout', iconName: 'cloud', tone: 'slate', index: i++, onSelect: () => report(api.steam.action('storefront'), 'Opening the store in Steam') }),
      results && actionTile({ key: 'st:clear', label: 'Clear search', iconName: 'up', tone: 'glass', index: i++, onSelect: clearSearch }),
      !results && actionTile({ key: 'st:reload', label: 'Refresh', iconName: 'refresh', tone: 'glass', index: i++, onSelect: () => { rails = null; error = null; render(); } }),
    ].filter(Boolean));

    const note = (iconName, title, sub) => h('div', { class: 'block' }, h('h3', { class: 'block__title' }, ' '),
      h('div', { class: 'store-note', style: { width: '46rem', height: '33rem', 'justify-content': 'center' } },
        icon(iconName, 'empty__icon'), h('div', { class: 'empty__title' }, title), sub && h('div', { class: 'empty__sub' }, sub)));

    const blocks = [tools];
    if (results) {
      if (results.items.length) blocks.push(block(`results for “${results.term}”`, 'block--wide', results.items.map((it) => storeTile(it, 'search', i++))));
      else blocks.push(note('search', `Nothing on Steam matches “${results.term}”`, 'Try fewer words.'));
    } else if (rails) {
      for (const rail of rails) blocks.push(block(rail.title, 'block--wide', rail.items.map((it) => storeTile(it, rail.id, i++))));
    } else if (error) {
      blocks.push(note('warn', 'The store could not be loaded', error));
    } else {
      blocks.push(note('cloud', 'Loading the Steam store…', null));
    }
    scroller.replaceChildren(...blocks);
  }

  async function load() {
    loading = true;
    const res = await api.store.featured();
    loading = false;
    if (res.ok) { rails = res.data; error = null; } else { error = res.error; }
    if (state.section !== 'store') return;
    const key = focus.base().current?.dataset.key;
    render();
    flash(el, 'view--from-right');
    const again = focus.byKey(el, key) || scroller.querySelector('[data-focus]');
    focus.focus(again, { layer: focus.base(), scroll: false });
    app.refreshChrome();
  }

  async function doSearch() {
    const term = await keyboard({ title: 'Search the Steam store', value: results?.term || '', placeholder: 'Game title' });
    if (term == null || !term.trim()) return;
    const res = await api.store.search(term.trim());
    if (!res.ok) { toast(res.error, { type: 'error', title: 'Search failed' }); return; }
    results = { term: term.trim(), items: res.data };
    render();
    scroller.scrollLeft = 0;
    focus.focus(scroller.querySelector('.tile--store') || focus.byKey(el, 'st:search'));
    app.refreshChrome();
  }

  function clearSearch() {
    results = null;
    render();
    scroller.scrollLeft = 0;
    focus.focus(focus.byKey(el, 'st:search'));
    app.refreshChrome();
  }

  async function showDetails(appid) {
    const listing = items.get(appid) || { name: 'Steam store' };
    const panel = openPanel();
    let details = null;
    const waiting = panel.ask({ title: listing.name, subtitle: 'Loading the store page…', items: [{ label: 'Asking Steam', disabled: true, iconName: 'cloud' }] });
    api.store.details(appid).then((res) => { details = res; panel.cancel(); });
    await waiting;
    if (!details) { await panel.close(); return; }             // backed out while loading
    if (!details.ok) { await panel.close(); toast(details.error, { type: 'error', title: listing.name }); return; }

    const d = details.data;
    for (;;) {
      const mine = findGame(`steam:${appid}`);
      const p = d.price;
      const pick = await panel.ask({
        title: d.name,
        subtitle: [p ? (p.discount ? `${p.text} (-${p.discount}%, was ${p.was})` : p.text) : (d.comingSoon ? 'Coming soon' : null), d.release, d.developer].filter(Boolean).join('  ·  '),
        art: h('div', { class: 'panel__art panel__art--wide' }, artImg([d.image], 'panel__art-img', { lazy: false })),
        selected: mine ? 'play' : 'steam',
        items: [
          mine && { label: mine.installed ? 'Play' : 'Install', value: 'play', iconName: mine.installed ? 'play' : 'download', sub: 'In your library' },
          { label: mine ? 'View in Steam' : (p && p.free ? 'Get it in Steam' : 'Buy in Steam'), value: 'steam', iconName: 'cloud', sub: 'Opens this game’s store page in the Steam client' },
          { heading: 'About' },
          d.description && { label: d.description, disabled: true },
          { heading: 'Details' },
          { label: PAD[d.controller], disabled: true, iconName: 'pad' },
          { label: d.linux ? 'Runs natively on Linux' : 'Windows game: runs through Proton', disabled: true, iconName: 'screen' },
          d.genres.length > 0 && { label: d.genres.join(', '), disabled: true, iconName: 'layers' },
          d.metacritic && { label: `Metacritic ${d.metacritic}`, disabled: true, iconName: 'star' },
        ],
      });
      if (pick == null) break;
      if (pick === 'steam') { await report(api.steam.action('store', appid), 'Opening the store page in Steam'); continue; }
      if (pick === 'play') { await panel.close(); app.launch(mine.id); return; }
    }
    await panel.close();
  }

  return {
    id: 'store',
    label: 'store',
    el,
    render,
    defaultFocus: () => scroller.querySelector('[data-focus]'),
    onAction(action) {
      if (action === 'start') { doSearch(); return true; }
      return false;
    },
    onBack() {
      if (results) { clearSearch(); return true; }
      return false;
    },
    hints: (target) => [{ a: 'accept', label: target?.dataset.app ? 'View' : 'Select' }, { a: 'start', label: 'Search' }],
    context(target) {
      const item = target?.dataset.app && items.get(target.dataset.app);
      if (item) {
        const p = item.price;
        return { title: item.name, meta: [p ? (p.discount ? `${p.text}, ${p.discount}% off` : p.text) : null, item.controller ? PAD[item.controller] : null,
          findGame(`steam:${item.appid}`) ? 'In your library' : null].filter(Boolean) };
      }
      const label = target?.querySelector('.tile__label');
      return label ? { title: label.firstChild?.textContent || '', meta: ['Steam store'] } : { title: 'Steam store', meta: [] };
    },
    backdrop(target) {
      const item = target?.dataset.app && items.get(target.dataset.app);
      return item ? [item.image] : [];
    },
  };
}
