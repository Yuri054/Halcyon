// Games: the full library as a two-row horizontal wall of covers,
// with category chips, sorting and search. In the 360 theme the section opens on a
// dashboard page first, like the console's games tab: My Games, Browse Games and
// Search Games down the left, the last four games played beside them, and a game
// you haven't tried yet on the right.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import {
  api, state, SORTS, visibleGames, filterGames, filterLabel, sortGames, search,
  game as findGame, gameContext, fmt,
} from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile, actionTile } from '../ui/tile.js';
import { gameMenu } from '../ui/gamemenu.js';
import { keyboard } from '../ui/osk.js';
import { menu } from '../ui/dialog.js';

export function createGames() {
  const chips = h('div', { class: 'chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const tools = h('div', { class: 'tools', 'data-focus-group': true });
  const grid = h('div', { class: 'wall', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const toolbar = h('div', { class: 'toolbar' }, chips, tools);
  const front = h('div', { class: 'blocks games__front', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true, hidden: true });
  const el = h('section', { class: 'view view--games' }, front, toolbar, grid);
  let shown = [];
  let atFront = true;    // 360 theme: showing the front page rather than the wall
  const frontOn = () => document.body.dataset.theme === 'x360' && atFront;

  function renderFront() {
    const installed = visibleGames().filter((g) => g.installed);
    const recent = sortGames(installed, 'recent').slice(0, 4);
    const untried = installed.filter((g) => !g.lastPlayed && !recent.includes(g));
    // A different untried game each day, so the tile changes now and then.
    const day = Math.floor(Date.now() / 86400000);
    const pick = untried.length ? untried[day % untried.length] : null;
    let i = 0;
    const at = (node, area) => { node.style.gridArea = area; return node; };
    const tile = (key, label, iconName, area, onSelect, extra = {}) => at(actionTile({ key, label, iconName, tone: 'accent', index: i++, onSelect, ...extra }), area);
    const uninstalled = visibleGames().filter((g) => !g.installed).length;
    const rec = pick && at(gameTile(pick, 'cover', i++), 'rc');
    if (rec) {
      rec.classList.add('games__rec');
      rec.querySelector('.tile__body')?.append(h('div', { class: 'games__rec-text' }, h('b', null, pick.name), h('span', null, 'Installed and not played yet. Give it a try?')));
    }
    const page1 = h('div', { class: 'metro games__metro' },
      tile('gf:mine', 'My Games', 'pad', 'mg', () => openWall('installed'), { count: installed.length }),
      tile('gf:browse', 'Browse Games', 'download', 'br', () => openWall('uninstalled'), { count: uninstalled || null }),
      tile('gf:search', 'Search Games', 'search', 'se', () => app.search()),
      ...recent.map((g, n) => at(gameTile(g, 'wide', i++), `g${n + 1}`)),
      rec || tile('gf:fav', 'Favorites', 'star', 'rc', () => openWall('favorites')),
      tile('gf:all', 'All games', 'grid', 'ra', () => openWall('all'), { count: visibleGames().length }));
    const systems = state.lib.systems.filter((x) => installed.some((g) => g.system === x.id));
    const page2 = h('div', { class: 'metro metro--quick' },
      actionTile({ key: 'gf:steam', label: 'Steam', iconName: 'cloud', tone: 'accent', count: installed.filter((g) => g.source === 'steam').length, index: i++, onSelect: () => openWall('steam') }),
      actionTile({ key: 'gf:favs', label: 'Favorites', iconName: 'star', tone: 'accent', count: installed.filter((g) => g.favorite).length, index: i++, onSelect: () => openWall('favorites') }),
      ...systems.map((x) => actionTile({ key: `gf:sys:${x.id}`, label: x.name, iconName: 'chip', tone: 'accent', count: installed.filter((g) => g.system === x.id).length, index: i++, onSelect: () => openWall(`sys:${x.id}`) })),
      state.lib.games.some((g) => g.download) && actionTile({ key: 'gf:dl', label: 'Downloading', iconName: 'download', tone: 'accent', index: i++, onSelect: () => openWall('downloads') }));
    front.replaceChildren(
      h('div', { class: 'block block--metro', 'data-page': '1' }, page1),
      h('div', { class: 'block block--metro block--page2', 'data-page': '2' }, page2));
  }

  function openWall(filter) {
    atFront = false;
    state.filter = filter;
    state.query = '';
    api.ui.set({ filter });
    render({ resetScroll: true });
    flash(el, 'is-swapping');
    if (shown.length) focusGrid(); else focus.focusKey(`f:${filter}`, { layer: focus.base() });
    app.refreshChrome();
  }

  function showFront() {
    atFront = true;
    render();
    flash(el, 'is-swapping');
    focus.focus(focus.byKey(front, 'gf:mine') || front.querySelector('[data-focus]'), { layer: focus.base(), scroll: 'instant' });
    app.refreshChrome();
  }

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
    const onFront = frontOn();
    front.hidden = !onFront;
    toolbar.hidden = onFront;
    grid.hidden = onFront;
    if (onFront) { renderFront(); return; }
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
    setFilter(f) { atFront = false; state.filter = f; state.query = ''; api.ui.set({ filter: f }); render({ resetScroll: true }); },
    // Coming to the tab (not to a particular filter) opens the front page again.
    reset() { atFront = true; },
    defaultFocus: () => (frontOn() ? focus.byKey(front, 'gf:mine') || front.querySelector('[data-focus]') : grid.querySelector('[data-focus]') || focus.byKey(chips, `f:${state.filter}`)),
    onAction(action, target) {
      if (action === 'start') { if (frontOn()) app.search(); else doSearch(); return true; }
      if (action === 'select') { doSort(); return true; }
      const inGrid = target && grid.contains(target);
      if ((action === 'lt' || action === 'rt') && frontOn()) return false;
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
      if (document.body.dataset.theme === 'x360' && !atFront) { showFront(); return true; }
      return false;
    },
    hints(target) {
      if (target?.dataset.game) {
        const g = findGame(target.dataset.game);
        return [{ a: 'accept', label: g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: 'Options' },
          { a: 'lt', b: 'rt', label: 'Page' }, { a: 'start', label: 'Search' }];
      }
      if (frontOn()) return [{ a: 'accept', label: 'Select' }, { a: 'start', label: 'Search' }];
      return [{ a: 'accept', label: 'Select' }, { a: 'lt', b: 'rt', label: 'Category' }, { a: 'start', label: 'Search' }];
    },
    context(target) {
      if (target?.dataset.game) return gameContext(findGame(target.dataset.game));
      return { title: filterLabel(state.filter), meta: [fmt.count(shown.length, 'game'), state.query && `matching “${state.query}”`].filter(Boolean) };
    },
    backdrop(target) {
      const g = target?.dataset.game ? findGame(target.dataset.game) : frontOn() ? sortGames(visibleGames().filter((x) => x.installed), 'recent')[0] : shown[0];
      return g ? g.art.hero : [];
    },
  };
}
