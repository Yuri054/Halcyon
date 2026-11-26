// Application shell: sections, input routing, chrome (hints, context, clock),
// launching, and persistence of the navigation position.
import { h, icon, flash } from './core/dom.js';
import * as focus from './core/focus.js';
import * as input from './core/input.js';
import { sfx, setEnabled as setSounds, setPack } from './core/sfx.js';
import { api, state, game as findGame, isPlaying, fmt, X360_OPTIONS, x360Option } from './core/state.js';
import { menu } from './ui/dialog.js';
import { app, wait } from './core/bus.js';
import { setBackdrop, artImg, fallbackArt } from './ui/art.js';
import { toast } from './ui/toast.js';
import { patchProgress } from './ui/tile.js';
import { createStore } from './views/store.js';
import { createMedia } from './views/media.js';
import { nowPlaying, onNowPlaying, stopBackground } from './media/player.js';
import { openDownloads } from './ui/downloads.js';
import { openStorage } from './ui/storage.js';
import { openAchievements, achievementTotal } from './ui/achievements.js';
import { createIntro } from './ui/intro.js';
import { openGuide, closeGuide, isOpen as guideOpen } from './ui/guide.js';
import { createHome } from './views/home.js';
import { createGames } from './views/games.js';
import { createCollections } from './views/collections.js';
import { createSystems } from './views/systems.js';
import { createSettings } from './views/settings.js';

const $ = (id) => document.getElementById(id);
// The tabs along the top. Store and collections are switched off (their pages still exist,
// nothing links to them); systems lives under settings as its second sub-tab.
const ORDER = ['home', 'games', 'tv', 'music', 'settings'];
const SUBTABS = { settings: [['settings', 'general'], ['systems', 'systems']] };
const TAB_OF = { systems: 'settings' };
const tabOf = (section) => TAB_OF[section] || section;
const subGroup = (section) => SUBTABS[tabOf(section)] || null;
const views = {};
// Switching sections faster than this is ignored, so the transition (and its sound) can land.
const SECTION_COOLDOWN_MS = 500;
let lastSectionAt = 0;
const sectionCoolingDown = () => performance.now() - lastSectionAt < SECTION_COOLDOWN_MS;
const lastKey = {};
let saveTimer = null;

// ------------------------------------------------------------------ chrome

function renderHints() {
  const layer = focus.top();
  const target = layer.current;
  let hints = [];
  if (layer.hints) hints = layer.hints(target) || [];
  if (layer === focus.base()) {
    const inTabs = target && $('tabs').contains(target);
    hints = inTabs ? [{ a: 'accept', label: 'Enter' }] : (views[state.section].hints(target) || []);
    hints = [...hints, subGroup(state.section) && !hints.some((x) => x.a === 'lt') && { a: 'lt', b: 'rt', label: subGroup(state.section).map((x) => x[1]).join(' / ') }, { a: 'lb', b: 'rb', label: 'Section' }, state.section === 'home' ? { a: 'back', label: 'Guide' } : { a: 'back', label: 'Back' }].filter(Boolean);
  }
  $('hints').replaceChildren(...hints.map((hint) => h('div', { class: 'hint' },
    h('span', { class: `glyph glyph--${hint.a}` }, input.glyph(hint.a)),
    hint.b && h('span', { class: `glyph glyph--${hint.b}` }, input.glyph(hint.b)),
    h('span', { class: 'hint__label' }, hint.label))));
  $('lbGlyph').textContent = input.glyph('lb');
  $('rbGlyph').textContent = input.glyph('rb');
}

function renderContext() {
  const baseLayer = focus.base();
  const target = baseLayer.current;
  const inTabs = target && $('tabs').contains(target);
  const view = views[state.section];
  const ctx = inTabs ? null : view.context(target);
  const box = $('context');
  if (!ctx) { box.replaceChildren(); }
  else {
    box.replaceChildren(
      h('div', { class: 'context__title' }, ctx.favorite && icon('starFill', 'context__fav'), ctx.title),
      h('div', { class: 'context__meta' }, ctx.meta.filter(Boolean).map((m) => (typeof m === 'string'
        ? h('span', null, m)
        : h('span', { class: 'context__warn' }, icon('warn'), m.warn)))));
  }
  setBackdrop(view.backdrop(inTabs ? null : target));
}

function refreshChrome() {
  renderHints();
  renderContext();
}

function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('saverClock').textContent = $('clock').textContent;
  $('saverDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

let batteries = [];

function renderPads() {
  const box = $('pads');
  box.replaceChildren(...(state.pads.length
    ? state.pads.slice(0, 4).map((p, i) => h('span', { class: 'pad', title: p.name }, icon('pad'), h('b', null, String(i + 1))))
    : [h('span', { class: 'pad pad--none', title: 'No controller connected' }, icon('pad'))]),
  // Wireless pads that report a charge to the kernel.
  ...batteries.slice(0, 4).map((b) => h('span', { class: `battery${b.percent <= 15 && !b.charging ? ' battery--low' : ''}`, title: b.name },
    h('span', { class: 'battery__cell' }, h('i', { style: { width: `${Math.max(8, b.percent)}%` } })),
    `${b.percent}%`)));
}

function onBatteries(list) {
  for (const b of list) {
    const was = batteries.find((o) => o.id === b.id);
    if (b.percent <= 15 && !b.charging && (!was || was.percent > 15)) toast(`${b.name} is at ${b.percent}%`, { type: 'pad', title: 'Controller battery low' });
  }
  batteries = list;
  renderPads();
}

let loadedPack = null;
/** Load (or drop) the chosen sound pack; returns once its sounds are ready. */
async function applySoundPack() {
  const id = state.lib.settings.soundPack || '';
  if (id === loadedPack) return;
  loadedPack = id;
  if (!id) { await setPack(null); return; }
  const res = await api.sounds.load(id).catch(() => null);
  if (loadedPack !== id) return;
  if (res && res.ok) await setPack(res.sounds);
  else { await setPack(null); toast(res?.error || 'The sound pack could not be loaded.', { type: 'error', title: 'Sound pack' }); }
}

function applySettings() {
  const s = state.lib.settings;
  applySoundPack();
  document.body.dataset.accent = s.accent || 'emerald';
  document.body.dataset.theme = s.theme || 'halcyon';
  // The 360 theme's options are classes on <body> (x360-glow, x360-names, ...).
  for (const [key] of X360_OPTIONS) document.body.classList.toggle(`x360-${key}`, x360Option(key));
  setSounds(s.sounds !== false);
  renderProfile();
}

/** The 360's profile corner: Steam picture, name, and a "score" of games and hours. */
function renderProfile() {
  let el = document.getElementById('profile');
  const p = state.lib.steamProfile;
  if (!el) {
    el = h('div', { id: 'profile', class: 'profile' });
    document.querySelector('#top .status')?.prepend(el);
  }
  if (!p) { el.hidden = true; return; }
  el.hidden = false;
  const games = state.lib.games.filter((g) => g.installed && !g.shadowedBy).length;
  const hours = Math.round(state.lib.games.reduce((n, g) => n + (g.playtimeMin || 0), 0) / 60);
  // The score: achievements unlocked (like a Gamerscore), else hours played.
  const unlocked = achievementTotal();
  el.replaceChildren(
    h('div', { class: 'profile__pic' }, p.avatar ? h('img', { src: p.avatar, alt: '' }) : icon('user')),
    h('div', { class: 'profile__text' }, h('div', { class: 'profile__name' }, p.name || 'Player'),
      h('div', { class: 'profile__score' }, h('b', null, 'G'), unlocked ? ` ${unlocked.toLocaleString()} · ${hours.toLocaleString()} h` : ` ${hours.toLocaleString()} h · ${games} games`)));
}

// ---------------------------------------------------------------- sections

function go(section, { filter, enter = false, focusKey = null, quiet = false } = {}) {
  const changed = section !== state.section;
  if (filter && views.games.setFilter) views.games.setFilter(filter);

  if (changed) {
    const subs = subGroup(section);
    const dir = tabOf(section) === tabOf(state.section) && subs
      ? (subs.findIndex((x) => x[0] === section) > subs.findIndex((x) => x[0] === state.section) ? 'right' : 'left')
      : ORDER.indexOf(tabOf(section)) > ORDER.indexOf(tabOf(state.section)) ? 'right' : 'left';
    for (const v of Object.values(views)) {
      v.el.hidden = v.id !== section;
    }
    if (!filter && !focusKey && views[section].reset) views[section].reset();
    state.section = section;
    lastSectionAt = performance.now();
    views[section].render();
    flash(views[section].el, `view--from-${dir}`);
    for (const tab of $('tabs').children) tab.classList.toggle('is-active', tab.dataset.section === tabOf(section));
    api.ui.set({ section });
    if (!quiet) sfx.section(dir);
  } else if (filter) {
    views[section].render();
  }

  const baseLayer = focus.base();
  if (enter || focusKey) {
    const view = views[section];
    const target = focus.byKey(view.el, focusKey || lastKey[section]) || view.defaultFocus();
    if (!focus.focus(target, { layer: baseLayer, scroll: 'instant' })) {
      focus.focus($('tabs').querySelector('.is-active'), { layer: baseLayer });
    }
  }
  refreshChrome();
}

function buildTabs() {
  const tabs = $('tabs');
  tabs.replaceChildren(...ORDER.map((id) => {
    const tab = h('div', { class: 'tab', 'data-focus': true, 'data-key': `tab:${id}`, 'data-section': id }, views[id].label);
    tab.addEventListener('click', () => go(id, { enter: true }));
    return tab;
  }));
  tabs.addEventListener('nav-focus', (e) => {
    const section = e.target.dataset.section;
    if (section && section !== tabOf(state.section)) go(section);
  });
}

// --------------------------------------------------------------- launching

let launchUi = null;

function closeLaunchUi() {
  if (!launchUi) return;
  const ui = launchUi;
  launchUi = null;
  clearTimeout(ui.timer);
  focus.popLayer(ui.layer);
  ui.el.classList.add('is-closing');
  if (ui.dispose) setTimeout(ui.dispose, 500);
  setTimeout(() => ui.el.remove(), 400);
}

/** Not installed yet: hand the request to Steam, which asks where to put the game. */
/**
 * Not installed yet: Halcyon asks where to put it (Steam's library folders, with their free
 * space) and has Steam start the download, without Steam's own install dialog. Without
 * Download controls, Steam is asked the old way and shows its dialog.
 */
async function installGame(g) {
  sfx.open();
  const appid = g.id.startsWith('steam:') ? g.id.slice(6) : null;
  const res = appid ? await api.steam.installFolders().catch(() => null) : null;
  const folders = res?.ok ? res.folders.filter((f) => f.mounted && f.capacity > 0) : [];
  if (folders.length) {
    const size = (n) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : fmt.size(n) || '0 MB');
    const roomiest = [...folders].sort((a, b) => b.free - a.free)[0];
    const pick = await menu({
      title: `Install ${g.name}`,
      subtitle: 'Where should it go?',
      selected: String((folders.find((f) => f.isDefault && f.free > 0) || roomiest).index),
      items: folders.map((f) => ({
        label: f.label || f.path.replace(/^\/home\/[^/]+/, '~').replace(/\/\.var\/app\/com\.valvesoftware\.Steam\/\.local\/share\/Steam$/, ' (Steam’s own folder)'),
        value: String(f.index), iconName: 'folder', disabled: f.free <= 0,
        sub: `${size(f.free)} free of ${size(f.capacity)}`, hint: f.isDefault ? 'Default' : '',
        meter: f.capacity ? Math.round(((f.capacity - f.free) / f.capacity) * 100) : null,
      })),
    });
    if (pick == null) return;
    toast('Asking Steam…', { title: `Installing ${g.name}`, iconName: 'download', ms: 2500 });
    const r = await api.steam.install(appid, Number(pick));
    if (!r || !r.ok) {
      toast(r?.full ? `It needs ${size(r.required)}, and that folder has ${size(r.available)}. Pick another one or free some space (Settings › system › Storage).` : r?.error || 'Steam could not start the install.',
        { type: 'error', title: `Couldn’t install ${g.name}` });
      return;
    }
    if (r.steamAsks) toast(r.steamAsks === 'eula' ? 'This game has a licence agreement: accept it in Steam to start the download.' : 'Steam needs something from you to install this game: answer in Steam.', { title: `Installing ${g.name}`, iconName: 'download', ms: 8000 });
    else toast(r.required ? `Downloading ${size(r.required)}` : 'Downloading', { title: `Installing ${g.name}`, iconName: 'download', ms: 4000 });
    // Straight to the download viewer, on this game (Steam takes a moment to queue it).
    setTimeout(() => openDownloads({ focusApp: appid }), r.steamAsks ? 6000 : 1200);
    return;
  }
  const result = await api.game.launch(g.id);
  if (!result.ok) toast(result.error || 'Steam could not be asked to install this game.', { type: 'error', title: `Couldn’t install ${g.name}` });
  else {
    toast('Confirm the install in Steam, then the download shows here.', { title: `Installing ${g.name}`, iconName: 'download', ms: 6000 });
    if (appid) setTimeout(() => openDownloads({ focusApp: appid }), 8000);
  }
}

/** Back to a game that is still running: Halcyon steps aside and the game has the screen. */
async function resumeGame(id) {
  const p = state.playing.find((x) => x.id === id) || state.playing[state.playing.length - 1];
  if (!p) return;
  sfx.select();
  toast(`Back to ${p.name}`, { iconName: 'play', ms: 1500 });
  await api.game.resume();
}

/** What is running now; the home screen offers to resume it. */
async function refreshPlaying() {
  const st = await api.system.status().catch(() => null);
  const list = (st?.nowPlaying || []).map(({ id, name, quittable }) => ({ id, name, quittable }));
  const changed = JSON.stringify(list) !== JSON.stringify(state.playing);
  state.playing = list;
  if (changed && state.section === 'home' && views.home) {
    const key = focus.base().current?.dataset.key;
    views.home.render();
    const again = focus.byKey(views.home.el, key);
    if (again) focus.focus(again, { layer: focus.base(), scroll: false });
    if (focus.top() === focus.base()) refreshChrome();
  }
}

async function launch(id) {
  const g = findGame(id);
  if (!g || launchUi) return;
  if (isPlaying(id)) { resumeGame(id); return; }
  if (!g.installed) { installGame(g); return; }
  stopBackground();   // music playing in the background stops when a game starts

  // The launch scene (an intro card, like the ones games open with), or the plain card.
  const intro = state.lib.settings.launchScene !== false ? createIntro(g) : null;
  const status = intro ? intro.status : h('div', { class: 'launch__status' }, 'Starting');
  const el = intro ? intro.el : h('div', { class: 'layer layer--launch' },
    h('div', { class: 'launch__cover' }, fallbackArt(g), artImg(g.art.cover, 'launch__img', { lazy: false })),
    h('div', { class: 'launch__text' },
      status,
      h('div', { class: 'launch__title' }, g.name),
      h('div', { class: 'launch__sub' }, g.platform),
      h('div', { class: 'launch__bar' }, h('i'))));
  $('layers').append(el);
  const layer = focus.pushLayer({
    root: el,
    current: null,
    // Swallow everything while a game is coming up; A skips Steam's shader processing,
    // B returns once the game has been handed over.
    onAction: (action, _target, repeat) => {
      if (action === 'accept' && !repeat && launchUi?.shaderAction) { sfx.select(); skipShaders(); return true; }
      if (action === 'back' && !repeat && launchUi?.dismissable) { sfx.back(); closeLaunchUi(); }
      return true;
    },
    hints: () => [
      launchUi?.shaderAction && { a: 'accept', label: 'Skip shader processing' },
      launchUi?.dismissable && { a: 'back', label: 'Return to dashboard' },
    ].filter(Boolean),
  });
  const bar = el.querySelector('.launch__bar');
  launchUi = { el, layer, status, bar, id, dispose: intro ? intro.dispose : null, dismissable: false, blurred: false, timer: null, shaderAction: 0, task: null };
  sfx.launch();
  refreshChrome();

  const [result] = await Promise.all([api.game.launch(id), wait(700)]);
  if (!launchUi) return;
  if (!result.ok) {
    closeLaunchUi();
    toast(result.error || 'The game could not be started.', { type: 'error', title: `Couldn’t start ${g.name}` });
    return;
  }
  input.rumble(160, 0.6);
  // A Steam game is not running yet: Steam still has steps to go (cloud saves, shaders...).
  // Its card says what Steam is doing until the game itself appears.
  if (!launchUi.task) status.textContent = result.followsSteam && !launchUi.started ? 'Starting in Steam' : 'Now playing';
  launchUi.dismissable = true;
  // A game we can follow keeps its card up until it exits; otherwise the card bows out by itself.
  if (!result.tracked) launchUi.timer = setTimeout(closeLaunchUi, 25000);
  renderHints();
}

/** Steam's launch steps, in words, on the launch card. */
const STEAM_TASKS = {
  ProcessingShaderCache: 'Processing Vulkan shaders',
  SynchronizingCloud: 'Syncing cloud saves', SynchronizingControllerConfig: 'Loading controller settings',
  UpdatingDRM: 'Checking the game', CreatingProcess: 'Starting', WaitingGameWindow: 'Waiting for the game window',
  ShowInterstitials: 'Starting', SiteLicenseSeatCheckout: 'Starting', DelayLaunch: 'Starting', Completed: 'Starting',
  ShowEula: 'Accept the agreement in Steam', ShowCDKey: 'Steam is showing a key', ShowLaunchOption: 'Choose a launch option in Steam',
  RunningInstallScript: 'Running first-time setup', VerifyingInstalledFiles: 'Checking files',
  ShadersSkipped: 'Skipped shader processing',
};

function setSteamTask(event) {
  if (!launchUi) return;
  const shaders = event && event.task === 'ProcessingShaderCache';
  launchUi.shaderAction = shaders ? event.actionId : 0;
  launchUi.task = event && event.task ? event.task : null;
  launchUi.el.classList.toggle('is-shaders', Boolean(shaders));
  if (event && !event.task && launchUi.task === null && launchUi.status.textContent.startsWith('Processing')) launchUi.status.textContent = 'Starting in Steam';
  if (event && event.task) {
    launchUi.status.textContent = `${STEAM_TASKS[event.task] || 'Starting in Steam'}${shaders && event.percent != null ? `  ${event.percent}%` : ''}`;
  }
  const fill = launchUi.bar.querySelector('i');
  // While shaders process, the bar shows real progress instead of the sweep.
  launchUi.bar.classList.toggle('is-determinate', Boolean(shaders && event.percent != null));
  fill.style.width = shaders && event.percent != null ? `${event.percent}%` : '';
  renderHints();
}

async function skipShaders() {
  if (!launchUi?.shaderAction) return;
  const res = await api.steam.skipShaders(launchUi.shaderAction);
  if (res && res.ok === false) toast(res.error, { type: 'error', title: 'Couldn’t skip' });
  else if (launchUi) { launchUi.status.textContent = 'Skipping shader processing'; launchUi.shaderAction = 0; renderHints(); }
}

// ------------------------------------------------------------------- guide

function guide(opts) {
  if (guideOpen()) { sfx.back(); closeGuide(); return; }
  if (launchUi && !launchUi.dismissable) return;
  openGuide(opts);
}

function searchGames() {
  go('games', { filter: 'all', enter: true });
  views.games.onAction('start', focus.base().current);
}

// ---------------------------------------------------------- idle dimming

let lastActivity = performance.now();
let dimmed = false;

function setDimmed(on) {
  if (dimmed === on) return;
  dimmed = on;
  document.body.classList.toggle('is-idle', on);
  if (on) tickClock(); else sfx.wake();
}

/** Note that someone is here. Returns true when this input only woke the screen. */
function touch() {
  lastActivity = performance.now();
  if (!dimmed) return false;
  setDimmed(false);
  return true;
}

function checkIdle() {
  if (dimmed || state.lib.settings.dimWhenIdle === false || !input.isLive()) return;
  if (performance.now() - lastActivity >= app.idleMs) setDimmed(true);
}

// -------------------------------------------------------------- start-up

/** Console-style power-on: the mark draws itself, the chime plays, the dashboard opens. */
async function bootSequence(skip) {
  const el = $('boot');
  if (skip) { el.remove(); return; }
  let finish;
  const done = new Promise((r) => { finish = r; });
  const layer = focus.pushLayer({
    root: el,
    current: null,
    onAction: (action, _t, repeat) => { if (!repeat && (action === 'accept' || action === 'back' || action === 'start')) finish(); return true; },
    hints: () => [],
  });
  document.body.classList.add('is-booting');
  sfx.boot();
  await Promise.race([done, wait(2500)]);
  focus.popLayer(layer);
  el.classList.add('is-out');
  flash(views[state.section].el, 'view--from-right');
  setTimeout(() => { el.remove(); document.body.classList.remove('is-booting'); }, 900);
}

// ------------------------------------------------------------------- input

function onAction(action, repeat) {
  if (touch()) return;
  if (action === 'guide') { if (!repeat) guide(); return; }
  const layer = focus.top();
  const target = layer.current;
  if (layer.onAction && layer.onAction(action, target, repeat)) return;

  switch (action) {
    case 'up': case 'down': case 'left': case 'right':
      // Sideways along the section names changes section too: same pace as the bumpers.
      if ((action === 'left' || action === 'right') && target && $('tabs').contains(target) && sectionCoolingDown()) break;
      if (focus.move(action)) { if (!$('tabs').contains(focus.top().current)) sfx.move(); }   // a section change plays its own sound
      else if (!repeat) { sfx.edge(); bump(target, action); }
      break;
    case 'accept':
      if (target && !repeat) { if (target.classList.contains('key')) sfx.typing(); else sfx.select(); target.click(); }
      break;
    case 'back':
      if (!repeat && layer.onBack) layer.onBack(target);
      break;
    default:
  }
}

function bump(el, dir) {
  const body = el?.querySelector('.tile__body') || el;
  if (!body) return;
  body.classList.remove('bump-left', 'bump-right', 'bump-up', 'bump-down');
  void body.offsetWidth;
  body.classList.add(`bump-${dir}`);
}

function baseAction(action, target, repeat) {
  if (action === 'lb' || action === 'rb') {
    if (repeat || sectionCoolingDown()) return true;
    // Past either end the tabs wrap round: settings to home, home to settings.
    const i = (ORDER.indexOf(tabOf(state.section)) + (action === 'rb' ? 1 : -1) + ORDER.length) % ORDER.length;
    go(ORDER[i], { enter: true });
    return true;
  }
  if (target && $('tabs').contains(target)) {
    // Left of the first tab is the last one, and right of the last is the first.
    const tabs = [...$('tabs').children];
    const at = tabs.indexOf(target);
    if ((action === 'left' && at === 0) || (action === 'right' && at === tabs.length - 1)) {
      if (repeat) return true;
      const next = tabs[action === 'left' ? tabs.length - 1 : 0];
      focus.focus(next, { layer: focus.base() });
      sfx.move();
      return true;
    }
    return false;
  }
  if (views[state.section].onAction(action, target, repeat)) return true;
  // LT / RT step through a tab's sub-tabs (settings: general, systems).
  const subs = subGroup(state.section);
  if (subs && (action === 'lt' || action === 'rt')) {
    if (repeat || sectionCoolingDown()) return true;
    const i = subs.findIndex((x) => x[0] === state.section) + (action === 'rt' ? 1 : -1);
    if (i < 0 || i >= subs.length) { sfx.edge(); return true; }
    go(subs[i][0], { enter: true });
    return true;
  }
  return false;
}

function baseBack(target) {
  const view = views[state.section];
  if (view.onBack && view.onBack(target)) { sfx.back(); return; }
  sfx.back();
  if (state.section !== 'home') go('home', { enter: true, quiet: true });
  else guide();
}

// -------------------------------------------------------------------- boot

async function boot() {
  Object.assign(app, { go, launch, resume: resumeGame, refreshChrome, guide, search: searchGames, downloads: openDownloads, storage: openStorage, achievements: openAchievements });
  state.lib = await api.library.get();
  applySettings();

  const media = { tv: createMedia({ id: 'tv', label: 'tv & movies', kind: 'video' }), music: createMedia({ id: 'music', label: 'music', kind: 'music' }) };
  for (const v of [createHome(), createGames(), media.tv, media.music, createStore(), createCollections(), createSystems(), createSettings()]) {
    views[v.id] = v;
    v.el.hidden = true;
    $('stage').append(v.el);
    // A tab with sub-tabs gets a row of them at the top of each of its pages.
    const subs = subGroup(v.id);
    if (subs) {
      const bar = h('div', { class: 'subtabs chips', 'data-focus-group': true }, ...subs.map(([id, label]) => {
        const c = h('div', { class: `chip subtab${id === v.id ? ' is-active' : ''}`, 'data-focus': true, 'data-key': `sub:${id}` }, label);
        c.addEventListener('click', () => { if (id !== state.section) go(id, { enter: true }); });
        return c;
      }));
      v.el.prepend(bar);
      v.el.classList.add('view--subtabs');
    }
  }
  buildTabs();

  // Music playing in the background: a note by the clock with the song.
  const np = h('div', { class: 'nowplaying', hidden: true });
  document.querySelector('#top .status').prepend(np);
  onNowPlaying((bg) => {
    np.hidden = !bg;
    if (bg) np.replaceChildren(icon(bg.paused() ? 'pause' : 'music'), h('span', null, bg.title), bg.artist && h('small', null, bg.artist));
  });
  setInterval(() => { const bg = nowPlaying(); if (bg && np.firstChild) np.firstChild.replaceWith(icon(bg.paused() ? 'pause' : 'music')); }, 1500);

  const baseLayer = focus.pushLayer({
    root: $('app'),
    current: null,
    onAction: baseAction,
    onBack: baseBack,
    fallback: () => views[state.section].defaultFocus(),
  });

  focus.setOnChange((el, layer) => {
    if (layer === baseLayer && el && el.dataset.key && !$('tabs').contains(el)) {
      lastKey[state.section] = el.dataset.key;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => api.ui.set({ focus: { [state.section]: el.dataset.key } }), 600);
    }
    refreshChrome();
  });

  Object.assign(lastKey, state.lib.ui.focus || {});
  state.filter = 'all';   // games always start on the whole library
  const saved = state.lib.ui.section === 'media' ? 'tv' : state.lib.ui.section;
  const start = ORDER.includes(tabOf(saved)) && views[saved] ? saved : 'home';
  state.section = null;
  go(start, { enter: true, quiet: true });

  api.on('library:changed', (lib) => {
    state.lib = lib;
    applySettings();
    const key = baseLayer.current?.dataset.key;
    const inTabs = baseLayer.current && $('tabs').contains(baseLayer.current);
    views[state.section].render();
    if (!inTabs) {
      const again = focus.byKey(views[state.section].el, key) || views[state.section].defaultFocus();
      baseLayer.current = null;
      focus.focus(again, { layer: baseLayer, scroll: false });
    }
    if (focus.top() === baseLayer) refreshChrome(); else renderContext();
  });

  refreshPlaying();
  api.on('launch:event', (event) => {
    if (['started', 'exited', 'detached', 'failed'].includes(event.type)) setTimeout(refreshPlaying, 300);
    if (event.type === 'failed') {
      closeLaunchUi();
      toast(event.error, { type: 'error', title: 'Launch failed' });
    } else if (event.type === 'started') {
      if (launchUi?.id === event.id) {
        clearTimeout(launchUi.timer);
        launchUi.started = true;
        setSteamTask(null);
        launchUi.status.textContent = 'Now playing';
      }
    } else if (event.type === 'steamTask') {
      if (launchUi?.id === event.id && !launchUi.started) setSteamTask(event);
    } else if (event.type === 'detached') {
      if (launchUi?.id === event.id) { clearTimeout(launchUi.timer); launchUi.timer = setTimeout(closeLaunchUi, 25000); }
    } else if (event.type === 'exited') {
      closeLaunchUi();
      if (guideOpen()) closeGuide();
      touch();
      if (event.minutes > 0) toast(`${event.name} · ${event.minutes} min this session`, { title: 'Welcome back', iconName: 'home' });
    }
  });

  // When a game takes focus and later gives it back, drop the "now playing" card.
  api.on('window:focus', (focused) => {
    if (focused) refreshPlaying();
    // Ambient animation rests while a game has the screen.
    document.body.classList.toggle('is-away', !focused);
    if (focused) lastActivity = performance.now();
    if (!launchUi) return;
    if (!focused) launchUi.blurred = true;
    else if (launchUi.blurred && launchUi.dismissable) closeLaunchUi();
  });

  api.on('system:batteries', onBatteries);
  // The Guide over a game handed something to the dashboard.
  const navigate = (nav) => {
    if (!nav) return;
    closeLaunchUi();
    if (guideOpen()) closeGuide();
    if (nav.launch) launch(nav.launch);
    else if (nav.search) searchGames();
    else if (nav.section && views[nav.section]) go(nav.section, { enter: true });
  };
  api.on('dashboard:navigate', navigate);
  api.app.pendingNav().then(navigate).catch(() => {});
  api.on('app:notice', (n) => toast(n.message, { ...n, sound: n.title === 'Download complete' ? 'download' : undefined }));
  // Download ticks arrive every few seconds: patch the tiles in place instead of re-rendering.
  api.on('steam:downloads', (list) => {
    for (const { id, download } of list) {
      const g = findGame(id);
      if (!g || JSON.stringify(g.download) === JSON.stringify(download)) continue;
      g.download = download;
      patchProgress(id, download);
    }
    if (focus.top() === focus.base()) renderContext();
  });
  api.system.status().then((st) => onBatteries(st.batteries || [])).catch(() => {});
  $('orb').addEventListener('click', () => guide());

  input.init({
    onAction,
    onActivity: touch,
    onBackgroundGuide: () => api.game.summon(),
    onMode: renderHints,
    onPads(pads, announce) {
      const before = state.pads;
      state.pads = pads;
      renderPads();
      if (announce) {
        const added = pads.find((p) => !before.some((b) => b.index === p.index));
        const removed = before.find((b) => !pads.some((p) => p.index === b.index));
        if (added) toast(added.name, { type: 'pad', title: 'Controller connected' });
        else if (removed) toast(removed.name, { type: 'pad', title: 'Controller disconnected' });
      }
      if (state.section === 'settings') views.settings.render();
    },
  });

  // Mouse support: hover focuses, wheel scrolls horizontal rails.
  document.addEventListener('mouseover', (e) => {
    if (input.getMode() !== 'mouse') return;
    const el = e.target.closest?.('[data-focus]');
    const layer = focus.top();
    if (el && el !== layer.current && layer.root.contains(el) && !$('tabs').contains(el)) focus.focus(el, { scroll: false });
  });
  document.addEventListener('wheel', (e) => {
    const sc = e.target.closest?.('[data-scroller="x"]');
    if (sc && Math.abs(e.deltaY) > Math.abs(e.deltaX)) sc.scrollLeft += e.deltaY;
  }, { passive: true });

  tickClock();
  setInterval(tickClock, 10000);
  setInterval(checkIdle, 2000);
  renderPads();
  const info = await api.app.info().catch(() => ({}));
  await applySoundPack();   // so the start-up sound comes from the pack too
  document.body.classList.add('is-ready');
  await bootSequence(info.skipBoot || state.lib.settings.bootAnimation === false);
}

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('is-ready');
  document.getElementById('boot')?.remove();
  document.getElementById('stage').append(h('div', { class: 'empty' },
    h('div', { class: 'empty__title' }, 'Halcyon could not start'),
    h('div', { class: 'empty__sub' }, String(err.message || err))));
});
