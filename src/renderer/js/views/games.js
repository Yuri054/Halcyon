// Games: the full library as a two-row horizontal wall of covers,
// with category chips, sorting and search. The 360 theme shows it like the console's
// "My Games": a title, then Show / Sort / Search buttons instead of the chip row.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import {
  api, state, SORTS, visibleGames, filterGames, filterLabel, sortGames, search,
  game as findGame, gameContext, fmt, padSupport, isPlaying,
} from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile } from '../ui/tile.js';
import { gameMenu } from '../ui/gamemenu.js';
import { keyboard } from '../ui/osk.js';
import { menu } from '../ui/dialog.js';
import { artImg } from '../ui/art.js';
import { toast } from '../ui/toast.js';

export function createGames() {
  const chips = h('div', { class: 'chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const tools = h('div', { class: 'tools', 'data-focus-group': true });
  const grid = h('div', { class: 'wall', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const title = h('div', { class: 'games__title' }, h('span', null, 'my games'), h('small', null, ''));
  // Where you are in the list ("12 / 236"), for the 360 theme's position option.
  const pos = h('div', { class: 'games__pos' });
  // The shelf view's details: the selected game's name and facts under the row of covers.
  const detail = h('div', { class: 'games__detail', hidden: true });
  grid.addEventListener('nav-focus', (e) => {
    const tiles = [...grid.children];
    const tile = e.target.closest('.tile');
    const i = tiles.indexOf(tile);
    pos.textContent = view() === 'classic' ? `${csel + 1} / ${shown.length}` : i >= 0 ? `${i + 1} / ${tiles.length}` : '';
    if (view() === 'shelf') showDetail(tile?.dataset.game);
  });
  function showDetail(id) {
    const g = id && findGame(id);
    if (!g) { detail.replaceChildren(); return; }
    detail.replaceChildren(
      h('div', { class: 'games__detail-name' }, g.name),
      h('div', { class: 'games__detail-meta' }, [g.platform, g.installed ? fmt.ago(g.lastPlayed) : 'Not installed', fmt.playtime(g.playtimeMin), g.installed && fmt.size(g.sizeBytes)].filter(Boolean).join('  ·  ')));
  }

  // How the games are shown: two rows of covers, a shelf of big covers with details, wide
  // tiles, or a list. Remembered; Select (or the View button) switches.
  const VIEWS = [['covers', 'Covers', 'grid'], ['shelf', 'Shelf', 'image'], ['classic', 'Classic', 'layers'], ['list', 'List', 'file']];

  // ---- Classic: the 360's game library. The selected cover big on the left, the next ones
  // receding to the right; the categories stacked above (up / down to change); "1 of 8 | name |
  // platform game" underneath. Only a window of covers around the selection is on the page.
  const CW = 17;     // cover width, rem (height 1.5 x)
  const CGAP = 0.9;
  let csel = 0;
  const cTiles = new Map();   // index -> element
  function classicRender(keepKey) {
    cTiles.clear();
    const at = keepKey ? shown.findIndex((g) => `g:${g.id}` === keepKey) : -1;
    csel = at >= 0 ? at : Math.min(csel, Math.max(0, shown.length - 1));
    const list = filters();
    const i = list.indexOf(state.filter);
    const cats = h('div', { class: 'nxe__cats' },
      ...list.slice(Math.max(0, i - 3), i).map((f) => h('div', { class: 'nxe__cat' }, filterLabel(f))),
      h('div', { class: 'nxe__cat is-on' }, state.query ? `“${state.query}”` : filterLabel(state.filter)));
    grid.replaceChildren(h('div', { class: 'nxe' }, cats, h('div', { class: 'nxe__row' }), h('div', { class: 'nxe__info' })));
    classicLayout(false);
  }
  function classicLayout(doFocus = true) {
    const row = grid.querySelector('.nxe__row');
    if (!row || !shown.length) return;
    const from = Math.max(0, csel - 1);
    const to = Math.min(shown.length - 1, csel + 10);
    for (const [n, t] of cTiles) if (n < from || n > to) { t.remove(); cTiles.delete(n); }
    let x = 0;
    for (let n = from; n <= to; n++) {
      let t = cTiles.get(n);
      if (!t) {
        t = gameTile(shown[n], 'cover', 0);
        t.removeAttribute('data-focus');
        t.classList.add('nxe__cover');
        t.dataset.idx = String(n);
        t.style.transform = `translateX(${n < csel ? -CW * 1.3 : 120}rem) scale(0.4)`;
        cTiles.set(n, t);
        row.append(t);
      }
      const k = n - csel;
      if (k === 0) t.setAttribute('data-focus', 'true'); else t.removeAttribute('data-focus');
      if (k < 0) { t.style.transform = `translateX(${-CW * 1.3}rem) scale(1)`; t.style.opacity = '0'; t.style.zIndex = '1'; continue; }
      const sc = k === 0 ? 1 : Math.max(0.34, 0.76 * Math.pow(0.88, k - 1));
      t.style.transform = `translateX(${x}rem) scale(${sc})`;
      t.style.opacity = k > 8 ? '0' : '1';
      t.style.zIndex = String(30 - k);
      x += CW * sc + CGAP * (k === 0 ? 1.4 : 1);
    }
    const g = shown[csel];
    grid.querySelector('.nxe__info').textContent = `${csel + 1} of ${shown.length}   |   ${g.name}   |   ${g.platform || 'PC'} game${g.installed ? '' : ' · not installed'}`;
    if (doFocus) focus.focus(cTiles.get(csel), { layer: focus.base(), scroll: false });
  }
  function classicMove(step) {
    const next = Math.max(0, Math.min(shown.length - 1, csel + step));
    if (next === csel) return false;
    csel = next;
    classicLayout();
    return true;
  }
  const view = () => (VIEWS.some(([v]) => v === state.lib.settings.gamesView) ? state.lib.settings.gamesView : 'covers');
  function listRow(g, i) {
    return h('div', { class: `tile glist__row${g.installed ? '' : ' tile--uninstalled'}`, 'data-focus': true, 'data-key': `g:${g.id}`, 'data-game': g.id, style: { '--i': Math.min(i, 22) } },
      h('div', { class: 'glist__art' }, artImg(g.art.cover, 'glist__img', { lazy: true }) || ''),
      h('div', { class: 'glist__text' }, h('div', { class: 'glist__name' }, g.name),
        h('div', { class: 'glist__meta' }, [g.platform, g.installed ? fmt.ago(g.lastPlayed) : null, fmt.playtime(g.playtimeMin)].filter(Boolean).join('  ·  '))),
      h('div', { class: 'glist__side' }, g.installed ? (fmt.size(g.sizeBytes) || '') : [icon('download'), 'Not installed']));
  }
  function tileFor(g, i) {
    const v = view();
    if (v === 'list') return listRow(g, i);
    return gameTile(g, 'cover', i);
  }
  async function pickView(step = null) {
    let next;
    if (step != null) {
      const i = VIEWS.findIndex(([v]) => v === view());
      next = VIEWS[(i + step + VIEWS.length) % VIEWS.length][0];
    } else {
      next = await menu({ title: 'View', subtitle: 'How the games are shown', selected: view(), items: VIEWS.map(([v, label, iconName]) => ({ label, value: v, iconName, checked: v === view() })) });
      if (!next || next === view()) return;
    }
    const key = focus.base().current?.dataset.key;
    await api.settings.set({ gamesView: next });
    setTimeout(() => {
      const again = focus.byKey(grid, key) || grid.querySelector('[data-focus]');
      if (again) focus.focus(again, { layer: focus.base(), scroll: 'instant' });
    }, 120);
  }
  const el = h('section', { class: 'view view--games' }, h('div', { class: 'toolbar' }, title, chips, pos, tools), grid, detail);
  let shown = [];

  // The filters, grouped: the everyday ones first (also the chip row and LT/RT), then where a
  // game is from, how it does with a controller, and the rest.
  const MAIN = ['all', 'installed', 'uninstalled', 'favorites', 'recent'];
  function groups() {
    const games = visibleGames();
    const has = (fn) => games.some(fn);
    const from = [
      has((g) => g.source === 'steam') && 'steam',
      has((g) => g.source === 'port') && 'ports',
      has((g) => g.source === 'emulator') && 'emulated',
      ...state.lib.systems.filter((x) => has((g) => g.system === x.id)).map((x) => `sys:${x.id}`),
      has((g) => g.source === 'custom') && 'custom',
    ].filter(Boolean);
    const pad = ['full', 'partial', 'unknown'].filter((p) => has((g) => padSupport(g) === p)).map((p) => `pad:${p}`);
    const more = [
      has((g) => g.download) && 'downloads',
      ...state.lib.collections.map((c) => c.id),
      state.lib.settings.controllerOnly && state.lib.games.some((g) => g.controller === 'none') && 'nopad',
      state.lib.games.some((g) => g.hidden) && 'hidden',
    ].filter(Boolean);
    return [
      { id: '@from', label: 'Where it’s from', iconName: 'layers', list: from },
      { id: '@pad', label: 'Controller support', iconName: 'pad', list: pad },
      { id: '@more', label: 'More', iconName: 'grid', list: more },
    ].filter((gr) => gr.list.length);
  }
  /** The short list: chips and LT / RT. A filter picked from a group joins it while it's on. */
  function filters() {
    const hasUninstalled = visibleGames().some((g) => !g.installed);
    const list = MAIN.filter((f) => hasUninstalled || (f !== 'installed' && f !== 'uninstalled'));
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
    const v = view();
    const keepScroll = v === 'list' ? grid.scrollTop : grid.scrollLeft;
    grid.className = `wall wall--${v}`;
    if (v === 'classic') grid.removeAttribute('data-scroller'); else grid.dataset.scroller = v === 'list' ? 'y' : 'x';
    detail.hidden = v !== 'shelf';

    chips.replaceChildren(...filters().map((f) => chip(`f:${f}`, filterLabel(f), {
      active: f === state.filter,
      count: filterGames(f).length,
      onSelect: () => setFilter(f),
    })), chip('f:@groups', 'More filters', { iconName: 'layers', onSelect: doFilter }));

    title.lastChild.textContent = fmt.count(filterGames(state.filter).length, 'game');
    tools.replaceChildren(
      // 360: what's shown is picked from a menu (the chip row is hidden there).
      Object.assign(chip('t:filter', `Show: ${filterLabel(state.filter)}`, { iconName: 'layers', active: state.filter !== 'all', onSelect: doFilter }), { className: `chip games__filter${state.filter !== 'all' ? ' is-active' : ''}` }),
      chip('t:search', state.query ? `“${state.query}”` : 'Search', { iconName: 'search', active: Boolean(state.query), onSelect: doSearch }),
      chip('t:view', `${document.body.dataset.theme === 'x360' ? 'View: ' : ''}${VIEWS.find(([x]) => x === v)[1]}`, { iconName: VIEWS.find(([x]) => x === v)[2], onSelect: () => pickView() }),
      chip('t:sort', `${document.body.dataset.theme === 'x360' ? 'Sort: ' : ''}${SORTS.find(([id]) => id === sort)?.[1] || 'Sort'}`, { iconName: 'clock', onSelect: doSort }));

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
      if (v === 'classic') classicRender(focus.base().current?.dataset.key || null);
      else grid.replaceChildren(...shown.map((g, i) => tileFor(g, i)));
    }
    if (v === 'list') grid.scrollTop = resetScroll ? 0 : keepScroll; else if (v !== 'classic') grid.scrollLeft = resetScroll ? 0 : keepScroll;
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

  async function doFilter() {
    const row = (f) => ({ label: filterLabel(f), value: f, checked: f === state.filter, hint: String(filterGames(f).length) });
    const gs = groups();
    let pick = await menu({
      title: 'Show',
      subtitle: 'Which games the list shows',
      selected: gs.find((g) => g.list.includes(state.filter))?.id || state.filter,
      items: [
        ...filters().filter((f) => MAIN.includes(f)).map(row),
        gs.length > 0 && { heading: ' ' },
        ...gs.map((g) => ({ label: g.label, value: g.id, iconName: g.iconName, verb: 'Open', checked: g.list.includes(state.filter),
          hint: g.list.includes(state.filter) ? filterLabel(state.filter) : String(g.list.length) })),
      ].filter(Boolean),
    });
    const group = gs.find((g) => g.id === pick);
    if (group) pick = await menu({ title: group.label, subtitle: 'Show', selected: state.filter, items: group.list.map(row) });
    if (pick == null) return;
    if (pick === state.filter) { focusGrid(); return; }
    state.filter = pick;
    api.ui.set({ filter: pick });
    render({ resetScroll: true });
    flash(el, 'is-swapping');
    if (shown.length) focusGrid(); else focus.focusKey('t:filter');
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
    // Classic: a cover further along is brought forward first.
    if (tile && view() === 'classic' && tile.dataset.idx && Number(tile.dataset.idx) !== csel) { csel = Number(tile.dataset.idx); classicLayout(); return; }
    if (tile) app.launch(tile.dataset.game);
  });

  return {
    id: 'games',
    label: 'games',
    el,
    render,
    setFilter(f) { state.filter = f; state.query = ''; api.ui.set({ filter: f }); render({ resetScroll: true }); },
    defaultFocus: () => grid.querySelector('[data-focus]') || focus.byKey(chips, `f:${state.filter}`) || focus.byKey(tools, 't:filter'),
    onAction(action, target) {
      if (action === 'start') { doSearch(); return true; }
      if (action === 'select') { pickView(1); return true; }
      const inGrid = target && grid.contains(target);
      // Classic: left / right along the covers, up / down through the categories, LT / RT jump.
      if (view() === 'classic' && inGrid) {
        if (action === 'left' || action === 'right') { if (!classicMove(action === 'left' ? -1 : 1)) sfx.edge(); else sfx.move(); return true; }
        if (action === 'lt' || action === 'rt') { if (classicMove(action === 'lt' ? -5 : 5)) sfx.move(); else sfx.edge(); return true; }
        if (action === 'down' || (action === 'up' && filters().indexOf(state.filter) > 0)) { csel = 0; cycleFilter(action === 'up' ? -1 : 1); sfx.move(); return true; }
      }
      if (action === 'lt' || action === 'rt') {
        if (inGrid) focus.page(view() === 'list' ? (action === 'lt' ? 'up' : 'down') : (action === 'lt' ? 'left' : 'right'), view() === 'list' ? 6 : 5);
        else cycleFilter(action === 'lt' ? -1 : 1);
        return true;
      }
      // Up from the top row of games goes to the Show / Search / View / Sort buttons (or the
      // chips), not past them to the section tabs.
      if (action === 'up' && inGrid) {
        const top = target.getBoundingClientRect().top;
        const above = [...grid.querySelectorAll('[data-focus]')].some((t) => t !== target && t.getBoundingClientRect().bottom <= top + 2);
        if (!above) {
          const bar = focus.byKey(tools, 't:filter')?.offsetParent ? [...tools.querySelectorAll('[data-focus]')] : [...chips.querySelectorAll('[data-focus]'), ...tools.querySelectorAll('[data-focus]')];
          const usable = bar.filter((b) => b.offsetParent);
          const x = target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
          const near = usable.sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - x) - Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - x))[0];
          const pick = focus.byKey(tools, 't:filter')?.offsetParent ? focus.byKey(tools, 't:filter') : near;
          if (pick) { focus.focus(pick, { layer: focus.base() }); sfx.move(); return true; }
        }
      }
      const id = target?.dataset.game;
      if (!id) return false;
      if (action === 'y') { gameMenu(id); return true; }
      if (action === 'x') { const g = findGame(id); api.game.patch(id, { favorite: !g.favorite }); return true; }
      return false;
    },
    onBack(target) {
      if (state.query) { state.query = ''; render({ resetScroll: true }); focusGrid(); app.refreshChrome(); return true; }
      if (target && grid.contains(target)) { return focus.focusKey(`f:${state.filter}`) || focus.focusKey('t:filter'); }
      return false;
    },
    hints(target) {
      if (target?.dataset.game) {
        const g = findGame(target.dataset.game);
        return [{ a: 'accept', label: isPlaying(g?.id) ? 'Resume' : g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: 'Options' },
          ...(view() === 'classic' ? [{ a: 'up', b: 'down', label: 'Category' }, { a: 'lt', b: 'rt', label: 'Jump' }] : [{ a: 'lt', b: 'rt', label: 'Page' }]), { a: 'start', label: 'Search' }];
      }
      return [{ a: 'accept', label: 'Select' }, { a: 'lt', b: 'rt', label: 'Show' }, { a: 'start', label: 'Search' }];
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
