// Home: the dashboard. Featured game, recents, favorites and quick tiles.
import { h } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { state, visibleGames, sortGames, game as findGame, gameContext, fmt, isPlaying } from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile, actionTile } from '../ui/tile.js';
import { gameMenu, editCustomGame, addGame } from '../ui/gamemenu.js';
import { api } from '../core/state.js';
import { toast } from '../ui/toast.js';
import { menu } from '../ui/dialog.js';
import { gamerscore } from '../ui/achievements.js';
import { openYouTube } from '../ui/youtube.js';

/**
 * The tiles the home page's tile section can hold, in a catalog: the person picks which, and
 * their order (Y on a tile moves or removes it; the + tile adds one). Stored as settings.homeTiles.
 */
export const DEFAULT_HOME_TILES = ['games', 'settings', 'power'];
const TILES = {
  games: { label: 'Games', iconName: 'grid', count: (g) => g.length, go: () => app.go('games', { filter: 'all', enter: true }) },
  favorites: { label: 'Favorites', iconName: 'star', count: (g) => g.filter((x) => x.favorite).length, go: () => app.go('games', { filter: 'favorites', enter: true }) },
  recent: { label: 'Recently played', iconName: 'clock', go: () => app.go('games', { filter: 'recent', enter: true }) },
  steam: { label: 'Steam', iconName: 'cloud', count: (g) => g.filter((x) => x.source === 'steam').length, go: () => app.go('games', { filter: 'steam', enter: true }) },
  emulated: { label: 'Emulated', iconName: 'chip', count: (g) => g.filter((x) => x.source === 'emulator').length, go: () => app.go('games', { filter: 'emulated', enter: true }) },
  ports: { label: 'PC ports', iconName: 'pad', count: (g) => g.filter((x) => x.source === 'port').length, go: () => app.go('games', { filter: 'ports', enter: true }) },
  achievements: { label: 'Achievements', iconName: 'star', count: () => gamerscore() || undefined, go: () => app.achievements?.() },
  tv: { label: 'TV & movies', iconName: 'film', go: () => app.go('tv', { enter: true }) },
  music: { label: 'Music', iconName: 'music', go: () => app.go('music', { enter: true }) },
  youtube: { label: 'YouTube', iconName: 'video', go: openYouTube },
  downloads: { label: 'Downloads', iconName: 'download', go: () => app.downloads() },
  storage: { label: 'Storage', iconName: 'folder', go: () => app.storage() },
  search: { label: 'Search', iconName: 'search', go: () => app.search() },
  add: { label: 'Add a game', iconName: 'plus', go: async () => { const id = await addGame(); if (id) app.go('games', { filter: 'all', enter: true, focusKey: `g:${id}` }); } },
  steamui: { label: 'Open Steam', iconName: 'screen', go: async () => { const r = await api.steam.open(); if (r && r.ok === false) toast(r.error, { type: 'error' }); } },
  bigpicture: { label: 'Big Picture', iconName: 'pad', go: async () => { const r = await api.steam.openBigPicture(); if (r && r.ok === false) toast(r.error, { type: 'error' }); } },
  settings: { label: 'Settings', iconName: 'gear', go: () => app.go('settings', { enter: true }) },
  power: { label: 'Power', iconName: 'power', go: () => app.guide({ select: 'power:suspend' }) },
};
const homeTiles = () => (Array.isArray(state.lib.settings.homeTiles) ? state.lib.settings.homeTiles : DEFAULT_HOME_TILES).filter((id) => TILES[id]);

export function createHome() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--home' }, scroller);

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` },
    h('h3', { class: 'block__title' }, title),
    h('div', { class: 'block__tiles' }, tiles));

  /**
   * The 360 home, laid out like the console's: a search tab peeking in from the left; a
   * column with the game to play (a picture) over two green tiles; a big feature in the
   * middle with two pictures under it; a column of three pictures; then the green tiles.
   */
  function renderMetro(games) {
    const recent = sortGames(games, 'recent');
    const favorites = games.filter((g) => g.favorite);
    let i = 0;
    const at = (el, area) => { el.style.gridArea = area; return el; };
    const pic = (g, area, caption) => {
      if (!g) return null;
      const t = at(gameTile(g, 'wide', i++), area);
      if (caption) { const title = t.querySelector('.tile__title'); if (title) title.textContent = caption; }
      return t;
    };
    const used = new Set();
    const take = (list) => { const g = list.find((x) => !used.has(x.id)); if (g) used.add(g.id); return g; };
    // A game still running takes the top-left tile: "Resume <game>" puts it back on screen.
    const running = [...state.playing].reverse().map((p) => findGame(p.id)).find(Boolean);
    if (running) used.add(running.id);
    const play = running || take(recent);
    const feature = take(recent);
    const under = [take(recent), take(recent)];
    const side = [take(favorites) || take(recent), take(favorites) || take(recent), take(recent)];

    const grid = h('div', { class: 'metro' },
      pic(play, 'a1', play ? `${running ? 'Resume' : 'Play'} ${play.name}` : null)
        || at(actionTile({ key: 'm:browse', label: 'Find a game', iconName: 'grid', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'all', enter: true }) }), 'a1'),
      at(actionTile({ key: 'm:pins', label: 'Favorites', iconName: 'star', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'favorites', enter: true }) }), 'a2'),
      at(actionTile({ key: 'm:recent', label: 'Recent', iconName: 'clock', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'recent', enter: true }) }), 'a3'),
      feature ? at(gameTile(feature, 'hero', i++), 'hero')
        : at(actionTile({ key: 'm:browse2', size: 'hero', label: 'Your games', iconName: 'grid', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'all', enter: true }) }), 'hero'),
      pic(under[0], 'b3'), pic(under[1], 'c3'),
      pic(side[0], 'd1'), pic(side[1], 'd2'), pic(side[2], 'd3'));
    const search = actionTile({ key: 'm:search', label: '', iconName: 'search', tone: 'slate', index: i++, onSelect: () => app.search() });
    search.classList.add('tile--peek');

    const quick = h('div', { class: 'metro metro--quick' }, ...quickTiles(games, () => i++, 'accent'));

    scroller.replaceChildren(
      h('div', { class: 'block block--peek' }, search),
      h('div', { class: 'block block--metro', 'data-page': '1' }, grid),
      h('div', { class: 'block block--metro block--page2', 'data-page': '2' }, quick));
  }

  /** The tile section: the chosen tiles in order, then a + tile to add more. */
  function quickTiles(games, next, tone) {
    const tones = { games: 'accent', settings: 'glass', power: 'danger', youtube: 'danger', favorites: 'gold', emulated: 'violet', steam: 'slate' };
    const tiles = homeTiles().map((id) => {
      const t = TILES[id];
      const tile = actionTile({ key: `q:${id}`, label: t.label, count: t.count ? t.count(games) : undefined, iconName: t.iconName, tone: tone || tones[id] || 'glass', index: next(), onSelect: t.go });
      tile.dataset.homeTile = id;
      return tile;
    });
    const plus = actionTile({ key: 'q:+', label: 'Add a tile', iconName: 'plus', tone: 'ghost', index: next(), onSelect: () => addTile() });
    plus.classList.add('tile--addtile');
    return [...tiles, plus];
  }

  const saveTiles = (list) => api.settings.set({ homeTiles: list });
  /** + : pick a tile to add (at the end). */
  async function addTile() {
    const have = homeTiles();
    const free = Object.keys(TILES).filter((id) => !have.includes(id));
    if (!free.length) { toast('Every tile is already on the home page.', { title: 'Home' }); return; }
    const pick = await menu({ title: 'Add a tile', subtitle: 'It goes at the end; Y on it moves it', items: free.map((id) => ({ label: TILES[id].label, value: id, iconName: TILES[id].iconName, verb: 'Add' })) });
    if (!pick) return;
    await saveTiles([...have, pick]);
    setTimeout(() => focusTile(pick), 150);
  }
  function focusTile(id) {
    const t = focus.byKey(el, `q:${id}`);
    if (t) focus.focus(t, { layer: focus.base() });
  }
  /** Y on a home tile: move it, remove it, or add another. */
  async function tileMenu(id) {
    const list = homeTiles();
    const n = list.indexOf(id);
    const pick = await menu({
      title: TILES[id].label, subtitle: 'Home tile',
      items: [
        n > 0 && { label: 'Move left', value: 'left', iconName: 'up' },
        n < list.length - 1 && { label: 'Move right', value: 'right', iconName: 'up' },
        { label: 'Remove from home', value: 'remove', iconName: 'trash', danger: true },
        { label: 'Add a tile', value: 'add', iconName: 'plus' },
        { label: 'Back to the usual tiles', value: 'reset', iconName: 'refresh', sub: 'Games, Settings and Power' },
      ].filter(Boolean),
    });
    if (pick === 'left' || pick === 'right') {
      const j = n + (pick === 'left' ? -1 : 1);
      [list[n], list[j]] = [list[j], list[n]];
      await saveTiles(list);
      setTimeout(() => focusTile(id), 150);
    }
    if (pick === 'remove') { await saveTiles(list.filter((x) => x !== id)); setTimeout(() => focusTile(list[n + 1] || list[n - 1] || '+'), 150); }
    if (pick === 'add') await addTile();
    if (pick === 'reset') await saveTiles([...DEFAULT_HOME_TILES]);
  }

  function render() {
    if (document.body.dataset.theme === 'x360') { renderMetro(visibleGames().filter((g) => g.installed)); return; }
    const all = visibleGames();
    // The dashboard is for what can be played right now; uninstalled games live under Games.
    const games = all.filter((g) => g.installed);
    const recent = sortGames(games, 'recent');
    const running = [...state.playing].reverse().map((p) => findGame(p.id)).find(Boolean);
    const featured = running || recent[0];
    const next = recent.filter((g) => g !== featured).slice(0, 6);
    const favorites = games.filter((g) => g.favorite && g !== featured).slice(0, 6);
    const emulated = games.filter((g) => g.source === 'emulator').length;
    const steam = games.filter((g) => g.source === 'steam').length;
    let i = 0;
    const blocks = [];

    if (featured) {
      blocks.push(block(running ? 'playing now' : featured.lastPlayed ? 'jump back in' : 'start playing', 'block--hero', [gameTile(featured, 'hero', i++)]));
    } else {
      blocks.push(block('welcome', 'block--hero', [actionTile({
        key: 'empty', size: 'hero', iconName: 'pad', label: 'No games found yet',
        sub: 'Install Steam games, point Halcyon at your ROMs under Systems, or add a game by hand.',
        onSelect: () => app.go('systems', { enter: true }),
      })]));
    }
    if (next.length) blocks.push(block('recent', 'block--wide', next.map((g) => gameTile(g, 'wide', i++))));
    if (favorites.length) blocks.push(block('favorites', 'block--covers', favorites.map((g) => gameTile(g, 'cover', i++))));

    blocks.push(block('library', 'block--quick', quickTiles(games, () => i++, null)));

    scroller.replaceChildren(...blocks);
  }

  el.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-game]');
    if (tile) app.launch(tile.dataset.game);
  });

  return {
    id: 'home',
    label: 'home',
    el,
    render,
    // The first real tile (top-left), not the search tab peeking in at the edge.
    defaultFocus: () => scroller.querySelector('.metro [data-focus]') || scroller.querySelector('[data-focus]:not(.tile--peek)') || scroller.querySelector('[data-focus]'),
    onAction(action, target) {
      if (action === 'y' && target?.dataset.homeTile) { tileMenu(target.dataset.homeTile); return true; }
      if (action === 'y' && target?.dataset.key === 'q:+') { addTile(); return true; }
      const id = target?.dataset.game;
      if (!id) return false;
      if (action === 'y' || action === 'start') { gameMenu(id); return true; }
      if (action === 'x') { const g = findGame(id); api.game.patch(id, { favorite: !g.favorite }); return true; }
      return false;
    },
    hints(target) {
      if (target?.dataset.game) {
        const g = findGame(target.dataset.game);
        return [{ a: 'accept', label: isPlaying(g?.id) ? 'Resume' : g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: 'Options' }];
      }
      if (target?.dataset.homeTile) return [{ a: 'accept', label: 'Open' }, { a: 'y', label: 'Move / remove' }];
      return [{ a: 'accept', label: 'Open' }];
    },
    context(target) {
      if (target?.dataset.game) return gameContext(findGame(target.dataset.game));
      if (target?.dataset.key?.startsWith('q:')) {
        return { title: target.querySelector('.tile__label')?.firstChild?.textContent || '', meta: [fmt.count(state.lib.games.length, 'game') + ' in your library'] };
      }
      return null;
    },
    backdrop(target) {
      const g = target?.dataset.game ? findGame(target.dataset.game) : sortGames(visibleGames().filter((x) => x.installed), 'recent')[0];
      return g ? g.art.hero : [];
    },
  };
}
