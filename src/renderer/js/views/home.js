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
import { sfx } from '../core/sfx.js';

/**
 * Every tile on the home page is a slot the person arranges: Y on one moves it (anywhere,
 * the first section included), changes what it holds, or removes it; + adds one.
 * A slot holds a catalog tile (TILES), a game picked for you (GAME_KINDS), or one particular
 * game ("game:<id>"). The 360 home's first section has nine fixed places (settings.homeMetro;
 * a removed one stays as an empty space to fill); the tile section after it is a list
 * (settings.homeTiles).
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
// Games picked for you, filled in order from what you play.
const GAME_KINDS = {
  'g:play': { label: 'Your last game', sub: 'Play it, or resume it while it runs', iconName: 'play' },
  'g:recent': { label: 'A recently played game', iconName: 'clock' },
  'g:favorite': { label: 'A favorite game', iconName: 'star' },
};
// The first section's places, in the order the console's layout reads: the column at the left
// (a picture over two small tiles), the big feature, two pictures under it, a column of three.
const SLOTS = ['a1', 'a2', 'a3', 'hero', 'b3', 'c3', 'd1', 'd2', 'd3'];
export const DEFAULT_METRO = ['g:play', 'favorites', 'recent', 'g:recent', 'g:recent', 'g:recent', 'g:favorite', 'g:favorite', 'g:recent'];
// Which places pick their games first (so the feature gets the next game after the one to play).
const FILL_ORDER = [0, 3, 4, 5, 6, 7, 8, 1, 2];

const known = (id) => Boolean(TILES[id] || GAME_KINDS[id] || id === 'empty' || /^game:/.test(id));
const isGameSlot = (id) => Boolean(GAME_KINDS[id]) || /^game:/.test(id);
function blockName(id) {
  if (TILES[id]) return TILES[id].label;
  if (GAME_KINDS[id]) return GAME_KINDS[id].label;
  if (/^game:/.test(id)) return findGame(id.slice(5))?.name || 'A game';
  return 'Empty space';
}

export function createHome() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--home' }, scroller);

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` },
    h('h3', { class: 'block__title' }, title),
    h('div', { class: 'block__tiles' }, tiles));

  // ---- the layout: saved, or a draft while a tile is being moved
  let draft = null;        // { metro: [...9], quick: [...] } while moving
  let moving = null;       // the slot ("m:3" / "q:2") being moved
  let moveLayer = null;
  let moveFrom = null;     // where it was picked up (Cancel puts it back)
  const savedMetro = () => {
    const m = state.lib.settings.homeMetro;
    return Array.isArray(m) && m.length === SLOTS.length ? m.map((id) => (known(id) ? id : 'empty')) : [...DEFAULT_METRO];
  };
  const savedQuick = () => (Array.isArray(state.lib.settings.homeTiles) ? state.lib.settings.homeTiles : DEFAULT_HOME_TILES).filter((id) => known(id) && id !== 'empty');
  const metroList = () => (draft ? draft.metro : savedMetro());
  const quickList = () => (draft ? draft.quick : savedQuick());
  const save = (metro, quick) => api.settings.set({ homeMetro: metro, homeTiles: quick });

  /** Hands out games to the game slots: the one to play, recent ones, favorites, picked ones. */
  function gamePicker(games, ids) {
    const recent = sortGames(games, 'recent');
    const favorites = games.filter((g) => g.favorite);
    const installed = new Set(games.map((g) => g.id));
    const used = new Set(ids.filter((id) => /^game:/.test(id)).map((id) => id.slice(5)));
    // A game still running goes to "your last game": "Resume <game>" puts it back on screen.
    const running = ids.includes('g:play') ? [...state.playing].reverse().map((p) => findGame(p.id)).find(Boolean) : null;
    if (running) used.add(running.id);
    const take = (list) => { const g = list.find((x) => !used.has(x.id)); if (g) used.add(g.id); return g || null; };
    return (id) => {
      if (id === 'g:play') { const g = running || take(recent); return g && { game: g, caption: `${running ? 'Resume' : 'Play'} ${g.name}` }; }
      if (id === 'g:recent') { const g = take(recent); return g && { game: g }; }
      if (id === 'g:favorite') { const g = take(favorites) || take(recent); return g && { game: g }; }
      if (/^game:/.test(id)) { const g = installed.has(id.slice(5)) ? findGame(id.slice(5)) : null; return g && { game: g }; }
      return null;
    };
  }

  /** One slot's tile. size: 'hero', 'wide' or 'square'. */
  function slotTile(slot, id, picked, size, index, tone) {
    let t;
    if (picked) {
      t = gameTile(picked.game, size === 'hero' ? 'hero' : 'wide', index);
      if (picked.caption) { const title = t.querySelector('.tile__title'); if (title) title.textContent = picked.caption; }
    } else if (TILES[id]) {
      const c = TILES[id];
      t = actionTile({ key: `s:${slot}`, label: c.label, count: c.count ? c.count(visibleGames().filter((g) => g.installed)) : undefined, iconName: c.iconName, tone, size: size === 'hero' ? 'hero' : 'square', index, onSelect: c.go });
    } else if (isGameSlot(id)) {
      // No game for it yet: it still shows what it is for, and opens the games.
      t = actionTile({ key: `s:${slot}`, label: id === 'g:play' ? 'Find a game' : blockName(id), sub: id === 'g:play' ? null : 'No game yet', iconName: id === 'g:play' ? 'grid' : GAME_KINDS[id]?.iconName || 'pad', tone: id === 'g:play' ? 'accent' : 'ghost', size: size === 'hero' ? 'hero' : 'square', index, onSelect: () => app.go('games', { filter: 'all', enter: true }) });
    } else {
      t = actionTile({ key: `s:${slot}`, label: 'Empty', sub: 'A or Y to add a tile here', iconName: 'plus', tone: 'ghost', size: size === 'hero' ? 'hero' : 'square', index, onSelect: () => changeSlot(slot) });
      t.classList.add('tile--emptyslot');
    }
    t.dataset.slot = slot;
    t.dataset.block = id;
    return t;
  }

  const TONES = { games: 'accent', settings: 'glass', power: 'danger', youtube: 'danger', favorites: 'gold', emulated: 'violet', steam: 'slate' };

  /**
   * The 360 home, laid out like the console's: a search tab peeking in from the left; a
   * column with a picture over two small tiles; a big feature in the middle with two pictures
   * under it; a column of three pictures; then the tile section. Every place is the person's.
   */
  function renderMetro(games) {
    const metro = metroList();
    const quick = quickList();
    const pick = gamePicker(games, [...metro, ...quick]);
    let i = 0;
    const picks = [];
    for (const n of FILL_ORDER) picks[n] = pick(metro[n]);
    const quickPicks = quick.map((id) => pick(id));
    const grid = h('div', { class: 'metro' }, ...SLOTS.map((area, n) => {
      const t = slotTile(`m:${n}`, metro[n], picks[n], area === 'hero' ? 'hero' : (picks[n] ? 'wide' : 'square'), i++, 'accent');
      t.style.gridArea = area;
      return t;
    }));
    const search = actionTile({ key: 'm:search', label: '', iconName: 'search', tone: 'slate', index: i++, onSelect: () => app.search() });
    search.classList.add('tile--peek');
    const quickEl = h('div', { class: 'metro metro--quick' }, ...quickTiles(quick, quickPicks, () => i++, 'accent'));
    scroller.replaceChildren(
      h('div', { class: 'block block--peek' }, search),
      h('div', { class: 'block block--metro', 'data-page': '1' }, grid),
      h('div', { class: 'block block--metro block--page2', 'data-page': '2' }, quickEl));
  }

  /** The tile section: the chosen tiles in order, then a + tile to add more. */
  function quickTiles(quick, picks, next, tone) {
    const tiles = quick.map((id, n) => slotTile(`q:${n}`, id, picks[n], 'square', next(), tone || TONES[id] || 'glass'));
    const plus = actionTile({ key: 'q:+', label: 'Add a tile', iconName: 'plus', tone: 'ghost', index: next(), onSelect: () => addTile() });
    plus.classList.add('tile--addtile');
    return [...tiles, plus];
  }

  const slotEl = (slot) => scroller.querySelector(`[data-slot="${CSS.escape(slot)}"]`);
  function focusSlot(slot) {
    const t = slotEl(slot) || focus.byKey(el, 'q:+');
    if (t) focus.focus(t, { layer: focus.base() });
  }
  const where = (slot) => (slot.startsWith('m:') ? ['metro', Number(slot.slice(2))] : ['quick', Number(slot.slice(2))]);

  /** Choose what a slot holds: a game picked for you, one game, or a tile. Resolves an id. */
  async function chooseBlock(title, current) {
    const inUse = new Set([...metroList(), ...quickList()].filter((id) => TILES[id]));
    const pick = await menu({
      title, subtitle: 'Games',
      items: [
        ...Object.entries(GAME_KINDS).map(([id, k]) => ({ label: k.label, sub: k.sub, value: id, iconName: k.iconName, checked: id === current })),
        { label: 'A game you choose…', value: 'pick', iconName: 'pad' },
        ...Object.keys(TILES).filter((id) => !inUse.has(id) || id === current).map((id) => ({ label: TILES[id].label, value: id, iconName: TILES[id].iconName, checked: id === current })),
      ],
    });
    if (pick !== 'pick') return pick || null;
    const games = sortGames(visibleGames().filter((g) => g.installed), 'recent');
    if (!games.length) { toast('Install a game first.', { title: 'Home' }); return null; }
    const g = await menu({ title: 'Which game?', subtitle: 'It stays in this place', items: games.map((x) => ({ label: x.name, value: x.id, iconName: 'pad' })) });
    return g ? `game:${g}` : null;
  }

  async function changeSlot(slot) {
    const [list, n] = where(slot);
    const metro = metroList();
    const quick = quickList();
    const arr = list === 'metro' ? metro : quick;
    const id = await chooseBlock(arr[n] === 'empty' ? 'Add a tile here' : `Change ${blockName(arr[n])}`, arr[n]);
    if (!id) return;
    arr[n] = id;
    await save(metro, quick);
    setTimeout(() => focusSlot(slot), 150);
  }

  /** + : add a tile at the end of the tile section. */
  async function addTile() {
    const id = await chooseBlock('Add a tile', null);
    if (!id) return;
    const quick = [...quickList(), id];
    await save(metroList(), quick);
    setTimeout(() => focusSlot(`q:${quick.length - 1}`), 150);
  }

  /** Y on a home tile: move it, change it, remove it, or add another. */
  async function slotMenu(target) {
    const slot = target.dataset.slot;
    const id = target.dataset.block;
    const [list, n] = where(slot);
    const empty = id === 'empty';
    const pick = await menu({
      title: empty ? 'Empty space' : blockName(id), subtitle: list === 'metro' ? 'Home · first section' : 'Home · tiles',
      items: [
        target.dataset.game && { label: 'Game options', value: 'game', iconName: 'gear' },
        { label: 'Move', sub: 'Then the d-pad moves it; A puts it down', value: 'move', iconName: 'up' },
        { label: empty ? 'Add a tile here' : 'Change it', value: 'change', iconName: empty ? 'plus' : 'refresh' },
        !empty && { label: 'Remove from home', value: 'remove', iconName: 'trash', danger: true },
        { label: 'Add a tile', sub: 'At the end of the tiles', value: 'add', iconName: 'plus' },
        { label: 'Back to the usual layout', value: 'reset', iconName: 'refresh' },
      ].filter(Boolean),
    });
    if (pick === 'game') gameMenu(target.dataset.game);
    if (pick === 'move') startMove(slot);
    if (pick === 'change') changeSlot(slot);
    if (pick === 'add') addTile();
    if (pick === 'remove') {
      const metro = metroList();
      const quick = quickList();
      // A place in the first section stays, empty; a tile in the list goes.
      if (list === 'metro') metro[n] = 'empty'; else quick.splice(n, 1);
      await save(metro, quick);
      setTimeout(() => focusSlot(list === 'metro' ? slot : `q:${Math.min(n, quick.length - 1)}`), 150);
    }
    if (pick === 'reset') {
      const sure = await menu({ title: 'Back to the usual layout?', subtitle: 'Your tiles and their places are forgotten', items: [{ label: 'Use the usual layout', value: 'yes', iconName: 'refresh', danger: true }, { label: 'Cancel', value: 'no', iconName: 'up' }] });
      if (sure === 'yes') { await save([...DEFAULT_METRO], [...DEFAULT_HOME_TILES]); setTimeout(() => focusSlot('m:0'), 150); }
    }
  }

  // ---- moving a tile: it swaps places with the tile in the direction pressed
  function startMove(slot) {
    draft = { metro: metroList(), quick: quickList() };
    moving = slot;
    moveFrom = slot;
    render();
    const t = slotEl(slot);
    if (!t) { draft = null; moving = null; return; }
    moveLayer = focus.pushLayer({
      root: scroller,
      current: null,
      onAction(action, _t, repeat) {
        if (['up', 'down', 'left', 'right'].includes(action)) { step(action); return true; }
        if (action === 'accept' && !repeat) { finishMove(true); return true; }
        if ((action === 'back' || action === 'y') && !repeat) { finishMove(false); return true; }
        return true;   // nothing else while a tile is in hand
      },
      hints: () => [{ a: 'left', b: 'right', label: 'Move' }, { a: 'accept', label: 'Put it here' }, { a: 'back', label: 'Cancel' }],
    });
    markMoving();
    sfx.select();
    app.refreshChrome();
  }
  function markMoving() {
    const t = moving && slotEl(moving);
    if (!t) return;
    t.classList.add('is-moving');
    if (moveLayer) focus.focus(t, { layer: moveLayer });
  }
  function step(dir) {
    const from = moveLayer.current;
    if (!focus.move(dir)) { sfx.edge(); return; }
    const to = moveLayer.current;
    if (!to?.dataset.slot) { focus.focus(from, { layer: moveLayer, scroll: false }); sfx.edge(); return; }
    const [la, a] = where(moving);
    const [lb, b] = where(to.dataset.slot);
    const A = draft[la];
    const B = draft[lb];
    [A[a], B[b]] = [B[b], A[a]];
    moving = to.dataset.slot;
    render();
    sfx.move();
  }
  async function finishMove(keep) {
    const d = draft;
    const slot = moving;
    focus.popLayer(moveLayer);
    moveLayer = null;
    draft = null;
    moving = null;
    if (keep) { await save(d.metro, d.quick); sfx.select(); } else { render(); sfx.back(); }
    setTimeout(() => focusSlot(keep ? slot : moveFrom), 150);
    app.refreshChrome();
  }

  function render() {
    if (document.body.dataset.theme === 'x360') renderMetro(visibleGames().filter((g) => g.installed));
    else renderBlocks();
    markMoving();
  }

  function renderBlocks() {
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

    const quick = quickList();
    const pickQuick = gamePicker(games, quick);
    blocks.push(block('library', 'block--quick', quickTiles(quick, quick.map((id) => pickQuick(id)), () => i++, null)));

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
      if (action === 'y' && target?.dataset.slot) { slotMenu(target); return true; }
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
        return [{ a: 'accept', label: isPlaying(g?.id) ? 'Resume' : g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' }, { a: 'y', label: target.dataset.slot ? 'Move / change' : 'Options' }];
      }
      if (target?.dataset.block === 'empty') return [{ a: 'accept', label: 'Add a tile' }, { a: 'y', label: 'Move / add' }];
      if (target?.dataset.slot) return [{ a: 'accept', label: 'Open' }, { a: 'y', label: 'Move / change' }];
      return [{ a: 'accept', label: 'Open' }];
    },
    context(target) {
      if (target?.dataset.game) return gameContext(findGame(target.dataset.game));
      if (target?.dataset.slot && !target.dataset.game) {
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
