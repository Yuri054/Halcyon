// Home: the dashboard. Featured game, recents, favorites and quick tiles.
import { h } from '../core/dom.js';
import { state, visibleGames, sortGames, game as findGame, gameContext, fmt } from '../core/state.js';
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

  function render() {
    const all = visibleGames();
    // The dashboard is for what can be played right now; uninstalled games live under Games.
    const games = all.filter((g) => g.installed);
    const recent = sortGames(games, 'recent');
    const featured = recent[0];
    const next = recent.slice(1, 7);
    const favorites = games.filter((g) => g.favorite && g !== featured).slice(0, 6);
    const emulated = games.filter((g) => g.source === 'emulator').length;
    const steam = games.filter((g) => g.source === 'steam').length;
    let i = 0;
    const blocks = [];

    if (featured) {
      blocks.push(block(featured.lastPlayed ? 'jump back in' : 'start playing', 'block--hero', [gameTile(featured, 'hero', i++)]));
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
        return [{ a: 'accept', label: g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: 'Options' }];
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
