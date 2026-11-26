// Home: the dashboard. Featured game, recents, favorites and quick tiles.
import { h } from '../core/dom.js';
import { state, visibleGames, sortGames, game as findGame, gameContext, fmt, isPlaying } from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile, actionTile } from '../ui/tile.js';
import { gameMenu, editCustomGame } from '../ui/gamemenu.js';
import { api } from '../core/state.js';
import { toast } from '../ui/toast.js';

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

    const quick = h('div', { class: 'metro metro--quick' },
      actionTile({ key: 'q:all', label: 'All games', count: games.length, iconName: 'grid', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'all', enter: true }) }),
      actionTile({ key: 'q:tv', label: 'TV & movies', iconName: 'film', tone: 'accent', index: i++, onSelect: () => app.go('tv', { enter: true }) }),
      actionTile({ key: 'q:music', label: 'Music', iconName: 'music', tone: 'accent', index: i++, onSelect: () => app.go('music', { enter: true }) }),
      actionTile({ key: 'q:steam', label: 'Steam', count: games.filter((g) => g.source === 'steam').length, iconName: 'download', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'steam', enter: true }) }),
      actionTile({ key: 'q:emu', label: 'Emulated', count: games.filter((g) => g.source === 'emulator').length, iconName: 'chip', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'emulated', enter: true }) }),
      actionTile({ key: 'q:add', label: 'Add a game', iconName: 'plus', tone: 'accent', index: i++, onSelect: async () => { const id = await editCustomGame(); if (id) app.go('games', { filter: 'custom', enter: true, focusKey: `g:${id}` }); } }),
      actionTile({ key: 'q:settings', label: 'Settings', iconName: 'gear', tone: 'accent', index: i++, onSelect: () => app.go('settings', { enter: true }) }),
      actionTile({ key: 'q:power', label: 'Power', iconName: 'power', tone: 'accent', index: i++, onSelect: () => app.guide({ select: 'power:suspend' }) }));

    scroller.replaceChildren(
      h('div', { class: 'block block--peek' }, search),
      h('div', { class: 'block block--metro', 'data-page': '1' }, grid),
      h('div', { class: 'block block--metro block--page2', 'data-page': '2' }, quick));
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

    blocks.push(block('library', 'block--quick', [
      actionTile({ key: 'q:all', label: 'All games', count: games.length, iconName: 'grid', tone: 'accent', index: i++, onSelect: () => app.go('games', { filter: 'all', enter: true }) }),
      actionTile({ key: 'q:steam', label: 'Steam', count: steam, iconName: 'cloud', tone: 'slate', index: i++, onSelect: () => app.go('games', { filter: 'steam', enter: true }) }),
      actionTile({ key: 'q:fav', label: 'Favorites', count: games.filter((g) => g.favorite).length, iconName: 'star', tone: 'gold', index: i++, onSelect: () => app.go('games', { filter: 'favorites', enter: true }) }),
      actionTile({ key: 'q:emu', label: 'Emulated', count: emulated, iconName: 'chip', tone: 'violet', index: i++, onSelect: () => app.go('games', { filter: 'emulated', enter: true }) }),
      actionTile({ key: 'q:add', label: 'Add a game', iconName: 'plus', tone: 'glass', index: i++, onSelect: async () => { const id = await editCustomGame(); if (id) app.go('games', { filter: 'custom', enter: true, focusKey: `g:${id}` }); } }),
      actionTile({ key: 'q:settings', label: 'Settings', iconName: 'gear', tone: 'glass', index: i++, onSelect: () => app.go('settings', { enter: true }) }),
      actionTile({ key: 'q:steamui', label: 'Open Steam', iconName: 'screen', tone: 'glass', index: i++, onSelect: async () => { const r = await api.steam.open(); if (r && r.ok === false) toast(r.error, { type: 'error' }); } }),
      actionTile({ key: 'q:power', label: 'Power', iconName: 'power', tone: 'danger', index: i++, onSelect: () => app.guide({ select: 'power:suspend' }) }),
    ]));

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
    defaultFocus: () => scroller.querySelector('[data-focus]'),
    onAction(action, target) {
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
