// Home: the dashboard. Featured game, recents, favorites and quick tiles.
import { h } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { state, visibleGames, sortGames, game as findGame, gameContext, fmt, isPlaying } from '../core/state.js';
import { app } from '../core/bus.js';
import { gameTile, actionTile, brandTile } from '../ui/tile.js';
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
  youtube: { label: 'YouTube', iconName: 'video', logo: 'img/youtube-2011.svg', go: openYouTube },
  downloads: { label: 'Downloads', iconName: 'download', go: () => app.downloads() },
  storage: { label: 'Storage', iconName: 'folder', go: () => app.storage() },
  search: { label: 'Search', iconName: 'search', go: () => app.search() },
  add: { label: 'Add a game', iconName: 'plus', go: async () => { const id = await addGame(); if (id) app.go('games', { filter: 'all', enter: true, focusKey: `g:${id}` }); } },
  steamui: { label: 'Open Steam', iconName: 'screen', go: async () => { const r = await api.steam.open(); if (r && r.ok === false) toast(r.error, { type: 'error' }); } },
  bigpicture: { label: 'Big Picture', iconName: 'pad', go: async () => { const r = await api.steam.openBigPicture(); if (r && r.ok === false) toast(r.error, { type: 'error' }); } },
  settings: { label: 'Settings', iconName: 'gear', go: () => app.go('settings', { enter: true }) },
  power: { label: 'Power', iconName: 'power', go: () => app.guide({ select: 'power:suspend' }) },
};
// Games picked for you from what you play. A recent or favorite slot has a rank ("g:recent:2"
// is the second most recent after your last game), so it shows the same game wherever it sits:
// moving the tile moves its game with it.
const GAME_KINDS = {
  'g:play': { label: 'Your last game', sub: 'Play it, or resume it while it runs', iconName: 'play' },
  'g:recent': { label: 'A recently played game', iconName: 'clock' },
  'g:favorite': { label: 'A favorite game', iconName: 'star' },
};
// The first section's places, in the order the console's layout reads: the column at the left
// (a picture over two small tiles), the big feature, two pictures under it, a column of three.
const SLOTS = ['a1', 'a2', 'a3', 'hero', 'b3', 'c3', 'd1', 'd2', 'd3'];
export const DEFAULT_METRO = ['g:play', 'favorites', 'recent', 'g:recent:1', 'g:recent:2', 'g:recent:3', 'g:favorite:1', 'g:favorite:2', 'g:recent:4'];

// Catalog tiles not offered when choosing a tile (they stay working where already placed).
const HIDDEN_CHOICES = new Set(['steam', 'emulated', 'ports']);

const kindOf = (id) => (/^g:(recent|favorite):\d+$/.test(id) ? id.replace(/:\d+$/, '') : id);
const rankOf = (id) => Number((/:(\d+)$/.exec(id) || [])[1] || 0);
const known = (id) => Boolean(TILES[id] || GAME_KINDS[kindOf(id)] || id === 'empty' || /^game:/.test(id));
const isGameSlot = (id) => Boolean(GAME_KINDS[kindOf(id)]) || /^game:/.test(id);
function blockName(id) {
  if (TILES[id]) return TILES[id].label;
  if (GAME_KINDS[kindOf(id)]) return GAME_KINDS[kindOf(id)].label;
  if (/^game:/.test(id)) return findGame(id.slice(5))?.name || 'A game';
  return 'Empty space';
}

/**
 * Give unranked recent / favorite slots (saved before ranks existed) a rank, in the order
 * they used to fill (the feature first), keeping ranks unique. Works on copies.
 */
function withRanks(metro, quick) {
  const all = [...metro.map((id, n) => ({ list: 'm', n, id })), ...quick.map((id, n) => ({ list: 'q', n, id }))];
  const order = [3, 4, 5, 6, 7, 8, 0, 1, 2];
  all.sort((a, b) => (a.list === b.list ? (a.list === 'm' ? order.indexOf(a.n) - order.indexOf(b.n) : a.n - b.n) : a.list === 'm' ? -1 : 1));
  const used = { 'g:recent': new Set(), 'g:favorite': new Set() };
  for (const x of all) if (used[kindOf(x.id)] && rankOf(x.id)) used[kindOf(x.id)].add(rankOf(x.id));
  const m = [...metro];
  const q = [...quick];
  for (const x of all) {
    if (!used[x.id]) continue;     // only bare "g:recent" / "g:favorite"
    let r = 1;
    while (used[x.id].has(r)) r++;
    used[x.id].add(r);
    (x.list === 'm' ? m : q)[x.n] = `${x.id}:${r}`;
  }
  return { metro: m, quick: q };
}

export function createHome() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--home' }, scroller);

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` },
    h('h3', { class: 'block__title' }, title),
    h('div', { class: 'block__tiles' }, tiles));

  // ---- the layout: as saved, or the working copy while arranging
  let draft = null;        // { metro: [...9], quick: [...] } while arranging
  let carrying = null;     // { slot, before } while a tile is in hand
  let arrangeLayer = null;
  const savedLayout = () => {
    const m = state.lib.settings.homeMetro;
    const metro = Array.isArray(m) && m.length === SLOTS.length ? m.map((id) => (known(id) ? id : 'empty')) : [...DEFAULT_METRO];
    const quick = (Array.isArray(state.lib.settings.homeTiles) ? state.lib.settings.homeTiles : DEFAULT_HOME_TILES).filter((id) => known(id) && id !== 'empty');
    return withRanks(metro, quick);
  };
  const layout = () => draft || savedLayout();
  const copy = (l) => ({ metro: [...l.metro], quick: [...l.quick] });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const save = (l) => api.settings.set({ homeMetro: l.metro, homeTiles: l.quick });

  /** Hands out games: your last game first, then recent and favorite slots by rank. */
  function gamePicker(games, ids) {
    const recent = sortGames(games, 'recent');
    const favorites = games.filter((g) => g.favorite);
    const installed = new Set(games.map((g) => g.id));
    const used = new Set(ids.filter((id) => /^game:/.test(id)).map((id) => id.slice(5)));
    const out = new Map();
    const take = (list) => { const g = list.find((x) => !used.has(x.id)); if (g) used.add(g.id); return g || null; };
    if (ids.includes('g:play')) {
      // A game still running is "your last game": "Resume <game>" puts it back on screen.
      const running = [...state.playing].reverse().map((p) => findGame(p.id)).find(Boolean);
      const g = running || take(recent);
      if (g) { used.add(g.id); out.set('g:play', { game: g, caption: `${running ? 'Resume' : 'Play'} ${g.name}` }); }
    }
    const ranked = (kind) => ids.filter((id) => kindOf(id) === kind).sort((a, b) => rankOf(a) - rankOf(b));
    for (const id of ranked('g:recent')) { const g = take(recent); if (g) out.set(id, { game: g }); }
    for (const id of ranked('g:favorite')) { const g = take(favorites) || take(recent); if (g) out.set(id, { game: g }); }
    return (id) => {
      if (/^game:/.test(id)) { const g = installed.has(id.slice(5)) ? findGame(id.slice(5)) : null; return g && { game: g }; }
      return out.get(id) || null;
    };
  }

  /** One slot's tile. size: 'hero', 'wide' or 'square'. */
  function slotTile(slot, id, picked, size, index, tone) {
    let t;
    const big = size === 'hero' ? 'hero' : 'square';
    if (picked) {
      t = gameTile(picked.game, size === 'hero' ? 'hero' : 'wide', index);
      if (picked.caption) { const title = t.querySelector('.tile__title'); if (title) title.textContent = picked.caption; }
    } else if (TILES[id]?.logo) {
      // An app tile: its logo on a plain face, as the console showed YouTube.
      t = brandTile({ key: `s:${slot}`, label: TILES[id].label, logo: TILES[id].logo, size: big, index, onSelect: TILES[id].go });
    } else if (TILES[id]) {
      const c = TILES[id];
      t = actionTile({ key: `s:${slot}`, label: c.label, count: c.count ? c.count(visibleGames().filter((g) => g.installed)) : undefined, iconName: c.iconName, tone, size: big, index, onSelect: c.go });
    } else if (isGameSlot(id)) {
      // No game for it yet: it still says what it is for, and opens the games.
      const play = id === 'g:play';
      t = actionTile({ key: `s:${slot}`, label: play ? 'Find a game' : blockName(id), sub: play ? null : 'No game yet', iconName: play ? 'grid' : GAME_KINDS[kindOf(id)]?.iconName || 'pad', tone: play ? 'accent' : 'ghost', size: big, index, onSelect: () => app.go('games', { filter: 'all', enter: true }) });
    } else {
      t = actionTile({ key: `s:${slot}`, label: 'Empty', sub: draft ? 'A to add a tile here' : 'Y to arrange', iconName: 'plus', tone: 'ghost', size: big, index });
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
    const { metro, quick } = layout();
    const pick = gamePicker(games, [...metro, ...quick]);
    let i = 0;
    const grid = h('div', { class: 'metro' }, ...SLOTS.map((area, n) => {
      const picked = pick(metro[n]);
      const t = slotTile(`m:${n}`, metro[n], picked, area === 'hero' ? 'hero' : (picked ? 'wide' : 'square'), i++, 'accent');
      t.style.gridArea = area;
      return t;
    }));
    const search = actionTile({ key: 'm:search', label: '', iconName: 'search', tone: 'slate', index: i++, onSelect: () => app.search() });
    search.classList.add('tile--peek');
    const quickEl = h('div', { class: 'metro metro--quick' }, ...quickTiles(quick, quick.map((id) => pick(id)), () => i++, 'accent'));
    scroller.replaceChildren(
      h('div', { class: 'block block--peek' }, search),
      h('div', { class: 'block block--metro', 'data-page': '1' }, grid),
      h('div', { class: 'block block--metro block--page2', 'data-page': '2' }, quickEl));
  }

  /** The tile section: the chosen tiles in order, then a + tile to add more. */
  function quickTiles(quick, picks, next, tone) {
    const tiles = quick.map((id, n) => slotTile(`q:${n}`, id, picks[n], 'square', next(), tone || TONES[id] || 'glass'));
    const plus = actionTile({ key: 'q:+', label: 'Add a tile', iconName: 'plus', tone: 'ghost', index: next(), onSelect: () => { if (!draft) arrange('q:+'); } });
    plus.classList.add('tile--addtile');
    return [...tiles, plus];
  }

  const slotEl = (slot) => scroller.querySelector(`[data-slot="${CSS.escape(slot)}"]`) || (slot === 'q:+' ? focus.byKey(scroller, 'q:+') : null);
  const where = (slot) => [slot.startsWith('m:') ? 'metro' : 'quick', Number(slot.slice(2))];

  /**
   * Re-draw, with every tile gliding from where it was to where it is now (and changing size
   * on the way), so arranging looks like the tiles themselves moving.
   */
  function redraw() {
    const ident = (t) => (t.dataset.block === 'empty' ? `empty@${t.dataset.slot}` : t.dataset.block);
    const before = new Map([...scroller.querySelectorAll('[data-slot]')].map((t) => [ident(t), t.getBoundingClientRect()]));
    render();
    for (const t of scroller.querySelectorAll('[data-slot]')) {
      const was = before.get(ident(t));
      if (!was) continue;
      const now = t.getBoundingClientRect();
      if (!now.width || (Math.abs(was.left - now.left) < 1 && Math.abs(was.top - now.top) < 1 && Math.abs(was.width - now.width) < 1)) continue;
      t.animate([
        { transform: `translate(${was.left - now.left}px, ${was.top - now.top}px) scale(${was.width / now.width}, ${was.height / now.height})`, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' },
      ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }

  // ---- arranging: the home shown as it will be, changed in a working copy until saved
  function arrange(startAt) {
    if (draft) return;
    draft = copy(savedLayout());
    document.body.classList.add('is-arranging');
    render();
    arrangeLayer = focus.pushLayer({
      root: scroller,
      current: null,
      onAction: arrangeAction,
      hints: arrangeHints,
    });
    focusIn(startAt || 'm:0');
    sfx.open();
    app.refreshChrome();
    if (startAt === 'q:+') addTile();
  }
  function focusIn(slot) {
    const t = slotEl(slot) || slotEl('m:0');
    if (t) focus.focus(t, { layer: arrangeLayer || focus.base() });
    if (carrying) slotEl(carrying.slot)?.classList.add('is-moving');
  }
  const here = () => arrangeLayer?.current;
  const hereSlot = () => here()?.dataset.slot || (here()?.dataset.key === 'q:+' ? 'q:+' : null);

  function arrangeAction(action, _t, repeat) {
    const dir = ['up', 'down', 'left', 'right'].includes(action) ? action : null;
    if (carrying) {
      if (dir) { carry(dir); return true; }
      if (action === 'accept' && !repeat) { putDown(true); return true; }
      if (action === 'back' && !repeat) { putDown(false); return true; }
      return true;
    }
    if (dir) {
      if (focus.move(dir)) sfx.move(); else if (!repeat) sfx.edge();
      // Only the tiles are part of arranging (not the search tab at the edge).
      if (!hereSlot()) { const back = scroller.querySelector('[data-slot]'); if (back) focus.focus(back, { layer: arrangeLayer }); }
      return true;
    }
    if (repeat) return true;
    const slot = hereSlot();
    if (action === 'accept') {
      if (slot === 'q:+') addTile();
      else if (here()?.dataset.block === 'empty') changeSlot(slot);
      else if (slot) pickUp(slot);
      return true;
    }
    if (action === 'y' && slot && slot !== 'q:+') { tileOptions(slot); return true; }
    if (action === 'back' || action === 'start') { finish(); return true; }
    return true;
  }
  function arrangeHints() {
    if (carrying) return [{ a: 'left', b: 'right', label: 'Move it' }, { a: 'accept', label: 'Put it here' }, { a: 'back', label: 'Put it back' }];
    const t = here();
    if (t?.dataset.key === 'q:+') return [{ a: 'accept', label: 'Add a tile' }, { a: 'start', label: 'Done' }];
    if (t?.dataset.block === 'empty') return [{ a: 'accept', label: 'Add a tile here' }, { a: 'start', label: 'Done' }];
    return [{ a: 'accept', label: 'Pick up' }, { a: 'y', label: 'Change / remove' }, { a: 'start', label: 'Done' }];
  }

  function pickUp(slot) {
    carrying = { slot, before: copy(draft) };
    pickedFrom = slot;
    slotEl(slot)?.classList.add('is-moving');
    sfx.select();
    app.refreshChrome();
  }
  /** Carry the tile one step: it swaps places with the tile in that direction. */
  function carry(dir) {
    const from = here();
    if (!focus.move(dir)) { sfx.edge(); return; }
    const to = here();
    const target = to?.dataset.slot;
    if (!target) { focus.focus(from, { layer: arrangeLayer, scroll: false }); sfx.edge(); return; }
    const [la, a] = where(carrying.slot);
    const [lb, b] = where(target);
    [draft[la][a], draft[lb][b]] = [draft[lb][b], draft[la][a]];
    carrying.slot = target;
    redraw();
    focusIn(target);
    sfx.move();
  }
  function putDown(keep) {
    const slot = carrying.slot;
    if (!keep) draft = carrying.before;
    const home = keep ? slot : null;
    const origin = !keep ? findOrigin() : null;
    carrying = null;
    redraw();
    focusIn(home || origin || slot);
    if (keep) sfx.select(); else sfx.back();
    app.refreshChrome();
  }
  // Where the tile in hand started (for "put it back"): the slot that holds it again.
  let pickedFrom = null;
  function findOrigin() { return pickedFrom; }

  /** Choose what a slot holds: a game picked for you, one game, or a tile. Resolves an id. */
  async function chooseBlock(title, current) {
    const all = [...draft.metro, ...draft.quick];
    const inUse = new Set(all.filter((id) => TILES[id]));
    const nextRank = (kind) => Math.max(0, ...all.filter((id) => kindOf(id) === kind).map(rankOf)) + 1;
    const pick = await menu({
      title, subtitle: 'Games',
      items: [
        !all.includes('g:play') && { label: GAME_KINDS['g:play'].label, sub: GAME_KINDS['g:play'].sub, value: 'g:play', iconName: 'play' },
        { label: GAME_KINDS['g:recent'].label, sub: 'The next one not already on home', value: 'g:recent', iconName: 'clock' },
        { label: GAME_KINDS['g:favorite'].label, sub: 'The next one not already on home', value: 'g:favorite', iconName: 'star' },
        { label: 'A game you choose…', value: 'pick', iconName: 'pad' },
        // Every tile, including ones already on home (picking one of those moves it here).
        ...Object.keys(TILES).filter((id) => !HIDDEN_CHOICES.has(id) || id === current).map((id) => ({
          label: TILES[id].label, value: id, iconName: TILES[id].iconName, checked: id === current,
          sub: inUse.has(id) && id !== current ? 'On home already: moves here' : null,
        })),
      ].filter(Boolean),
    });
    if (pick === 'g:recent' || pick === 'g:favorite') return `${pick}:${nextRank(pick)}`;
    if (pick !== 'pick') return pick || null;
    const games = sortGames(visibleGames().filter((g) => g.installed), 'recent');
    if (!games.length) { toast('Install a game first.', { title: 'Home' }); return null; }
    const g = await menu({ title: 'Which game?', subtitle: 'It stays in this place', items: games.map((x) => ({ label: x.name, value: x.id, iconName: 'pad' })) });
    return g ? `game:${g}` : null;
  }

  /** Where a catalog tile already is on home, if anywhere: [list, index]. */
  function findTile(id) {
    if (!TILES[id]) return null;
    for (const list of ['metro', 'quick']) { const n = draft[list].indexOf(id); if (n >= 0) return [list, n]; }
    return null;
  }

  async function changeSlot(slot) {
    const [list, n] = where(slot);
    const before = draft[list][n];
    const id = await chooseBlock(before === 'empty' ? 'Add a tile here' : `Change ${blockName(before)}`, before);
    if (!id || !draft || id === before) return;
    // Already somewhere else on home: it moves here, and that place gets what was here.
    // (Only a first-section place can be empty; the tile list has no empty places.)
    const other = findTile(id);
    if (other) {
      const [ol, on] = other;
      if (ol === 'quick' && before === 'empty') draft.quick.splice(on, 1);
      else draft[ol][on] = before;
    }
    draft[list][n] = id;
    redraw();
    focusIn(slot);
  }
  async function addTile() {
    const id = await chooseBlock('Add a tile', null);
    if (!id || !draft) return;
    // Already on home: it moves to the end of the tiles (a first-section place it leaves stays empty).
    const other = findTile(id);
    if (other) { if (other[0] === 'quick') draft.quick.splice(other[1], 1); else draft.metro[other[1]] = 'empty'; }
    draft.quick.push(id);
    redraw();
    focusIn(`q:${draft.quick.length - 1}`);
  }
  async function tileOptions(slot) {
    const [list, n] = where(slot);
    const id = draft[list][n];
    const pick = await menu({
      title: blockName(id), subtitle: 'Arranging home',
      items: [
        { label: 'Change it', value: 'change', iconName: 'refresh' },
        { label: 'Remove from home', sub: list === 'metro' ? 'Its place stays, empty' : null, value: 'remove', iconName: 'trash', danger: true },
        { label: 'Add a tile', sub: 'At the end of the tiles', value: 'add', iconName: 'plus' },
        { label: 'Back to the usual layout', value: 'reset', iconName: 'refresh' },
      ],
    });
    if (!draft) return;
    if (pick === 'change') changeSlot(slot);
    if (pick === 'add') addTile();
    if (pick === 'remove') {
      // A place in the first section stays, empty; a tile in the list goes.
      if (list === 'metro') draft.metro[n] = 'empty'; else draft.quick.splice(n, 1);
      redraw();
      focusIn(list === 'metro' ? slot : (draft.quick.length ? `q:${Math.min(n, draft.quick.length - 1)}` : 'q:+'));
    }
    if (pick === 'reset') { draft = withRanks([...DEFAULT_METRO], [...DEFAULT_HOME_TILES]); redraw(); focusIn('m:0'); }
  }

  /** Done arranging: save the changes, throw them away, or keep going. */
  async function finish() {
    const changed = !same(draft, savedLayout());
    let pick = 'discard';
    if (changed) {
      pick = await menu({
        title: 'Save your home?', subtitle: 'Your home as shown',
        items: [
          { label: 'Save changes', value: 'save', iconName: 'check' },
          { label: 'Discard changes', sub: 'Home goes back to how it was', value: 'discard', iconName: 'trash', danger: true },
          { label: 'Keep arranging', value: 'keep', iconName: 'up' },
        ],
      });
      if (pick == null || pick === 'keep') { focusIn(hereSlot() || 'm:0'); return; }
    }
    const slot = hereSlot();
    const kept = draft;
    focus.popLayer(arrangeLayer);
    arrangeLayer = null;
    draft = null;
    carrying = null;
    document.body.classList.remove('is-arranging');
    if (pick === 'save') { await save(kept); sfx.select(); } else { redraw(); sfx.back(); }
    setTimeout(() => { const t = slotEl(slot) || slotEl('m:0'); if (t) focus.focus(t, { layer: focus.base() }); app.refreshChrome(); }, 150);
  }

  function render() {
    keepPictures(() => {
      if (document.body.dataset.theme === 'x360') renderMetro(visibleGames().filter((g) => g.installed));
      else renderBlocks();
    });
  }

  /**
   * Re-draw without the pictures blinking: a new tile's picture is invisible until it has
   * loaded, so the ones already on screen are carried over into the new tiles instead.
   */
  function keepPictures(draw) {
    const key = (img) => `${img.classList[0]}|${img.dataset.first}`;
    const loaded = new Map();
    for (const img of scroller.querySelectorAll('img.is-loaded')) if (!loaded.has(key(img))) loaded.set(key(img), img);
    draw();
    for (const img of scroller.querySelectorAll('img:not(.is-loaded)')) {
      const old = loaded.get(key(img));
      if (!old) continue;
      loaded.delete(key(img));
      old.style.cssText = img.style.cssText;   // its crop, as the new tile set it
      img.replaceWith(old);
      // A game's wordmark replaces its written title once loaded.
      if (old.classList.contains('tile__logo')) { const title = old.parentElement?.querySelector('.tile__title'); if (title) title.hidden = true; }
    }
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

    const { quick } = layout();
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
      // Y anywhere on the home's tiles: arrange the home, starting at this tile.
      if (action === 'y' && (target?.dataset.slot || target?.dataset.key === 'q:+')) { arrange(target.dataset.slot || 'q:+'); return true; }
      const id = target?.dataset.game;
      if (!id) return false;
      if (action === 'start' || (action === 'y' && !target.dataset.slot)) { gameMenu(id); return true; }
      if (action === 'x') { const g = findGame(id); api.game.patch(id, { favorite: !g.favorite }); return true; }
      return false;
    },
    hints(target) {
      const arrangeHint = (target?.dataset.slot || target?.dataset.key === 'q:+') ? [{ a: 'y', label: 'Arrange home' }] : [];
      if (target?.dataset.game) {
        const g = findGame(target.dataset.game);
        return [{ a: 'accept', label: isPlaying(g?.id) ? 'Resume' : g && !g.installed ? 'Install' : 'Play' }, { a: 'x', label: g?.favorite ? 'Unfavorite' : 'Favorite' },
          ...(target.dataset.slot ? [...arrangeHint, { a: 'start', label: 'Options' }] : [{ a: 'y', label: 'Options' }])];
      }
      if (target?.dataset.block === 'empty') return arrangeHint;
      return [{ a: 'accept', label: target?.dataset.key === 'q:+' ? 'Add a tile' : 'Open' }, ...arrangeHint];
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
