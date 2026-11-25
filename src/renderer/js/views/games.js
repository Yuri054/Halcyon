// Games: the full library as a two-row horizontal wall of covers,
// with category chips, sorting and search.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import {
  api, state, SORTS, visibleGames, filterGames, filterLabel, sortGames, search,
  game as findGame, gameContext, fmt,
} from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile } from '../ui/tile.js';
import { gameMenu } from '../ui/gamemenu.js';
import { keyboard } from '../ui/osk.js';
import { menu } from '../ui/dialog.js';

export function createGames() {
  const chips = h('div', { class: 'chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const tools = h('div', { class: 'tools', 'data-focus-group': true });
  const grid = h('div', { class: 'wall', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--games' }, h('div', { class: 'toolbar' }, chips, tools), grid);
  let shown = [];

  function filters() {
    const games = visibleGames();
    const list = ['all', 'favorites', 'recent', 'steam'];
    for (const s of state.lib.systems) if (games.some((g) => g.system === s.id)) list.push(`sys:${s.id}`);
    if (games.some((g) => g.source === 'custom')) list.push('custom');
    if (games.some((g) => g.download)) list.push('downloads');
    if (games.some((g) => !g.installed)) list.push('installed', 'uninstalled');
    for (const c of state.lib.collections) list.push(c.id);
    if (state.lib.games.some((g) => g.hidden)) list.push('hidden');
    if (state.lib.settings.controllerOnly && state.lib.games.some((g) => g.controller === 'none')) list.push('nopad');
    if (!list.includes(state.filter)) list.push(state.filter);
    return list;
  }

  function chip(key, label, { active, iconName, count, onSelect }) {
    const c = h('div', { class: `chip${active ? ' is-active' : ''}`, 'data-focus': true, 'data-key': key },
      iconName && icon(iconName), h('span', null, label), count != null && h('span', { class: 'chip__count' }, String(count)));
    c.addEventListener('click', onSelect);
    return c;
  }

  function render({ resetScroll = false } = {}) {
    const sort = state.lib.settings.sort || 'recent';
    const keepScroll = grid.scrollLeft;

    chips.replaceChildren(...filters().map((f) => chip(`f:${f}`, filterLabel(f), {
      active: f === state.filter,
      count: filterGames(f).length,
      onSelect: () => setFilter(f),
    })));

    tools.replaceChildren(
      chip('t:search', state.query ? `“${state.query}”` : 'Search', { iconName: 'search', active: Boolean(state.query), onSelect: doSearch }),
      chip('t:sort', SORTS.find(([id]) => id === sort)?.[1] || 'Sort', { iconName: 'clock', onSelect: doSort }));

    const base = filterGames(state.filter);
    shown = search(state.filter === 'recent' ? base : sortGames(base, sort), state.query);

    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        icon(state.query ? 'search' : 'grid', 'empty__icon'),
        h('div', { class: 'empty__title' }, state.query ? `Nothing matches “${state.query}”` : `No games in ${filterLabel(state.filter)}`),
        h('div', { class: 'empty__sub' }, state.query ? 'Try a shorter search, or clear it from the Search chip.'
          : state.filter === 'favorites' ? 'Press X on any game to mark it as a favorite.'
            : 'Games appear here automatically once they are installed or added.')));
    } else {
      grid.replaceChildren(...shown.map((g, i) => gameTile(g, 'cover', i)));
    }
    grid.scrollLeft = resetScroll ? 0 : keepScroll;
  }

  function setFilter(f) {
    if (f === state.filter) { focusGrid(); return; }
    state.filter = f;
    api.ui.set({ filter: f });
    render({ resetScroll: true });
    focus.focusKey(`f:${f}`, { layer: focus.base() });
    flash(el, 'is-swapping');
    app.refreshChrome();
  }

  function focusGrid() {
    const first = grid.querySelector('[data-focus]');
    if (first) focus.focus(first);
  }

  async function doSearch() {
    const q = await keyboard({ title: 'Search your library', value: state.query, placeholder: 'Type a game or platform' });
    if (q == null) return;
    state.query = q.trim();
    render({ resetScroll: true });
    if (shown.length) focusGrid(); else focus.focusKey('t:search');
    app.refreshChrome();
  }

  async function doSort() {
    const cur = state.lib.settings.sort || 'recent';
    const pick = await menu({
      title: 'Sort games',
      selected: cur,
      items: SORTS.map(([value, label]) => ({ label, value, checked: value === cur })),
    });
    if (pick && pick !== cur) {
      await api.settings.set({ sort: pick });
      grid.scrollLeft = 0;
      focusGrid();
    }
  }

  function cycleFilter(step) {
    const list = filters();
    const i = list.indexOf(state.filter);
    const next = list[(i + step + list.length) % list.length];
    state.filter = next;
    api.ui.set({ filter: next });
    render({ resetScroll: true });
    if (shown.length) focusGrid(); else focus.focusKey(`f:${next}`);
    const active = focus.byKey(chips, `f:${next}`);
    if (active) chips.scrollTo({ left: active.offsetLeft - chips.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
    app.refreshChrome();
  }

  el.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-game]');
    if (tile) app.launch(tile.dataset.game);
  });

  return {
    id: 'games',
    label: 'games',
    el,
    render,
    setFilter(f) { state.filter = f; state.query = ''; api.ui.set({ filter: f }); render({ resetScroll: true }); },
    defaultFocus: () => grid.querySelector('[data-focus]') || focus.byKey(chips, `f:${state.filter}`),
    onAction(action, target) {
      if (action === 'start') { doSearch(); return true; }
      if (action === 'select') { doSort(); return true; }
      const inGrid = target && grid.contains(target);
      if (action === 'lt' || action === 'rt') {
        if (inGrid) focus.page(action === 'lt' ? 'left' : 'right', 5);
        else cycleFilter(action === 'lt' ? -1 : 1);
        return true;
      }
      const id = target?.dataset.game;
      if (!id) return false;
      if (action === 'y') { gameMenu(id); return true; }
      if (action === 'x') { const g = findGame(id); api.game.patch(id, { favorite: !g.favorite }); return true; }
      return false;
    },
    onBack(target) {
      if (state.query) { state.query = ''; render({ resetScroll: true }); focusGrid(); app.refreshChrome(); return true; }
      if (target && grid.contains(target)) { return focus.focusKey(`f:${state.filter}`); }
      return false;
    },
    hints(target) {
      if (target?.dataset.game) {
        const g = findGame(target.dataset.game);
        return [{ a: 'accept', label: g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: 'Options' },
          { a: 'lt', b: 'rt', label: 'Page' }, { a: 'start', label: 'Search' }];
      }
      return [{ a: 'accept', label: 'Select' }, { a: 'lt', b: 'rt', label: 'Category' }, { a: 'start', label: 'Search' }];
    },
    context(target) {
      if (target?.dataset.game) return gameContext(findGame(target.dataset.game));
      return { title: filterLabel(state.filter), meta: [fmt.count(shown.length, 'game'), state.query && `matching “${state.query}”`].filter(Boolean) };
    },
    backdrop(target) {
      const g = target?.dataset.game ? findGame(target.dataset.game) : shown[0];
      return g ? g.art.hero : [];
    },
  };
}
