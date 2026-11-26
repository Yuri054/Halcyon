// The Guide over a game: a window of its own that opens when the controller's
// Home button is pressed while Halcyon is in the background. It shows the same
// Guide as the dashboard; picking something that belongs to the dashboard hands
// over to it, and closing the Guide gives the screen straight back to the game.
import { h } from './core/dom.js';
import * as focus from './core/focus.js';
import * as input from './core/input.js';
import { sfx, setEnabled as setSounds, setPack } from './core/sfx.js';
import { api, state } from './core/state.js';
import { app } from './core/bus.js';
import { openGuide, closeGuide, isOpen as guideOpen } from './ui/guide.js';
import { openDownloads } from './ui/downloads.js';

const $ = (id) => document.getElementById(id);
let staysOpen = false;   // something other than the Guide is using this window

function renderHints() {
  const layer = focus.top();
  const hints = layer?.hints ? layer.hints(layer.current) || [] : [];
  $('hints').replaceChildren(...hints.map((hint) => h('div', { class: 'hint' },
    h('span', { class: `glyph glyph--${hint.a}` }, input.glyph(hint.a)),
    hint.b && h('span', { class: `glyph glyph--${hint.b}` }, input.glyph(hint.b)),
    h('span', { class: 'hint__label' }, hint.label))));
}

let openedAt = performance.now();

function onAction(action, repeat) {
  // Home again puts the game back, like closing the console's Guide. (The press that opened
  // this window can still be held when it appears: that one does not count.)
  if (action === 'guide') { if (!repeat && guideOpen() && performance.now() - openedAt > 900) { sfx.back(); closeGuide(); } return; }
  const layer = focus.top();
  if (!layer) return;
  const target = layer.current;
  if (layer.onAction && layer.onAction(action, target, repeat)) return;
  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    if (focus.move(action)) sfx.move(); else if (!repeat) sfx.edge();
  } else if (action === 'accept') {
    if (target && !repeat) { sfx.select(); target.click(); }
  } else if (action === 'back') {
    if (!repeat && layer.onBack) layer.onBack(target);
  }
}

async function run() {
  const lib = await api.library.get();
  state.lib = lib;
  document.body.dataset.accent = lib.settings.accent || 'emerald';
  document.body.dataset.theme = lib.settings.theme || 'halcyon';
  setSounds(lib.settings.sounds !== false);
  if (lib.settings.soundPack) {
    const pack = await api.sounds.load(lib.settings.soundPack).catch(() => null);
    if (pack && pack.ok) await setPack(pack.sounds);
  }
  document.body.classList.add('is-ready');
  // Behind the Guide: the running game's art (the game itself cannot show through).
  const status0 = await api.system.status().catch(() => null);
  const playingNow = (status0?.nowPlaying || []).slice(-1)[0];
  const g = playingNow && lib.games.find((x) => x.id === playingNow.id);
  const art = g && [...g.art.hero, ...g.art.cover][0];
  if (art) $('overlayBg').style.backgroundImage = `url("${art}")`;

  // What the Guide's choices mean from over a game: the dashboard takes over for anything
  // that is "go somewhere"; downloads open right here.
  Object.assign(app, {
    go: (section) => api.dashboard.show({ section }),
    launch: (id) => api.dashboard.show({ launch: id }),
    search: () => api.dashboard.show({ search: true }),
    downloads: async (opts) => { staysOpen = true; await openDownloads(opts); api.game.resume(); },
    refreshChrome: renderHints,
  });

  focus.setOnChange(renderHints);
  input.init({ onAction, onMode: renderHints });

  // A spare window, loaded ahead of time, waits hidden until Home shows it.
  if (new URLSearchParams(location.search).has('wait')) {
    await new Promise((resolve) => api.on('guide:open', resolve));
    openedAt = performance.now();
    state.lib = await api.library.get();
    const st = await api.system.status().catch(() => null);
    const now = (st?.nowPlaying || []).slice(-1)[0];
    const game = now && state.lib.games.find((x) => x.id === now.id);
    const pic = game && [...game.art.hero, ...game.art.cover][0];
    if (pic) $('overlayBg').style.backgroundImage = `url("${pic}")`;
  }
  state.pads = [...navigator.getGamepads()].filter((p) => p && p.connected).map((p) => ({ index: p.index, id: p.id, name: p.id }));

  await openGuide();
  if (!staysOpen) api.game.resume();   // closes this window; focus goes back to the game
}

run().catch((err) => { console.error(err); api.game.resume(); });
