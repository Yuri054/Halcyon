// Settings: display, library, Steam and system options as Metro-style cards.
import { h, icon } from '../core/dom.js';
import { api, state, ACCENTS, THEMES, fmt, noPadGames } from '../core/state.js';
import { app } from '../core/bus.js';
import { browse } from '../ui/browser.js';
import { menu } from '../ui/dialog.js';
import { keyboard } from '../ui/osk.js';
import { toast } from '../ui/toast.js';
import { editCustomGame, addGame, report } from '../ui/gamemenu.js';
import { enableControls, disableControls } from '../ui/downloads.js';

const KIND = { native: 'Native install', flatpak: 'Flatpak', snap: 'Snap', custom: 'Added folder' };

export function createSettings() {
  const scroller = h('div', { class: 'blocks blocks--cards', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--settings' }, scroller);
  let info = null;
  let autostart = false;
  let scrapeStatus = '';
  const help = new Map();

  function row({ key, label, sub, iconName, value, toggle, swatch, danger, onSelect, tip }) {
    if (tip) help.set(key, tip);
    const r = h('div', { class: `row${danger ? ' row--danger' : ''}`, 'data-focus': Boolean(onSelect), 'data-key': key },
      iconName && icon(iconName, 'row__icon'),
      h('div', { class: 'row__text' }, h('div', { class: 'row__label' }, label), sub && h('div', { class: 'row__sub' }, sub)),
      value != null && h('div', { class: 'row__hint' }, value),
      swatch && h('div', { class: 'row__swatch', 'data-accent': swatch }),
      toggle != null && h('div', { class: `switch${toggle ? ' is-on' : ''}` }, h('i')));
    if (onSelect) r.addEventListener('click', onSelect);
    return r;
  }

  const card = (title, rows) => h('div', { class: 'block block--card' },
    h('h3', { class: 'block__title' }, title), h('div', { class: 'card' }, rows.filter(Boolean)));

  const set = (patch) => api.settings.set(patch);

  /** Which monitors' speakers Halcyon switches the sound to while it is on them. */
  async function pickSound() {
    let selected = null;
    for (;;) {
      const list = await api.system.monitorAudio().catch(() => []);
      if (!list.length) { toast('None of your monitors has HDMI or DisplayPort sound.', { title: 'Sound follows the monitor' }); return; }
      const pick = await menu({
        title: 'Sound follows the monitor',
        subtitle: 'While Halcyon is on a ticked screen, the sound plays there; it goes back when Halcyon moves or closes',
        selected,
        items: list.map((o) => ({ label: o.monitor, value: o.label, iconName: 'sound', checked: o.on, sub: o.tv ? 'TV or receiver' : 'Monitor speakers', verb: o.on ? 'Turn off' : 'Turn on' })),
      });
      if (pick == null) return;
      selected = pick;
      const on = list.filter((o) => o.on).map((o) => o.label);
      await set({ monitorAudio: on.includes(pick) ? on.filter((x) => x !== pick) : [...on, pick] });
    }
  }

  async function pickMonitor() {
    const list = await api.system.displays().catch(() => []);
    const cur = state.lib.settings.monitor || '';
    const pick = await menu({
      title: 'Monitor',
      subtitle: 'The screen Halcyon (and its Guide over games) fills',
      selected: cur || '@auto',
      items: [
        { label: 'Automatic', value: '@auto', iconName: 'screen', checked: !cur, sub: 'Wherever the desktop opens it' },
        { heading: 'Monitors' },
        ...list.map((d) => ({
          label: d.name, value: d.label, iconName: 'screen', checked: cur === d.label,
          sub: [d.maker, d.port, `${d.width} × ${d.height}`, d.primary && 'primary', d.current && 'Halcyon is here now'].filter(Boolean).join(' · '),
        })),
        cur && !list.some((d) => d.label === cur) && { label: cur.split(' - ')[1] || cur, value: cur, iconName: 'screen', checked: true, sub: 'Not connected right now' },
      ],
    });
    if (pick == null) return;
    await set({ monitor: pick === '@auto' ? '' : pick });
  }

  function render() {
    const s = state.lib.settings;
    const installs = state.lib.steam.installs;
    const hasKey = Boolean(state.lib.scraper?.hasKey);
    const account = state.lib.steamAccount || {};
    const theme = THEMES.find((t) => t[0] === s.theme) || THEMES[0];
    help.clear();

    scroller.replaceChildren(
      card('display', [
        row({ key: 'fullscreen', label: 'Fullscreen', iconName: 'screen', toggle: s.fullscreen, onSelect: () => set({ fullscreen: !s.fullscreen }), tip: 'F11 also toggles fullscreen' }),
        row({ key: 'launchScene', label: 'Game start animation', iconName: 'spark', toggle: s.launchScene !== false, onSelect: () => set({ launchScene: s.launchScene === false }), sub: s.launchScene !== false ? 'The Halcyon intro plays while a game starts' : 'Off: a simple loading card', tip: 'Dawn over the sea, a kingfisher, the Halcyon card, then the game’s title until it opens. Off shows the simple loading card.' }),
        row({ key: 'monitor', label: 'Monitor', iconName: 'screen', value: s.monitor ? (s.monitor.split(' - ')[1] || s.monitor) : 'Automatic', onSelect: pickMonitor, tip: 'Which screen Halcyon fills' }),
        row({ key: 'monitorAudio', label: 'Sound follows the monitor', iconName: 'sound', value: Array.isArray(s.monitorAudio) ? (s.monitorAudio.length ? s.monitorAudio.map((x) => x.split(' - ')[1] || x).join(', ') : 'Off') : 'TVs', onSelect: pickSound, tip: 'Switches the sound to a TV’s HDMI while Halcyon is on it' }),
        row({ key: 'theme', label: 'Theme', iconName: 'layers', value: theme[1],
          onSelect: () => set({ theme: THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length][0] }), tip: `${theme[2]}. Select to switch; the accent color applies to every theme.` }),
        row({ key: 'accent', label: 'Accent color', iconName: 'palette', value: s.accent[0].toUpperCase() + s.accent.slice(1), swatch: s.accent,
          onSelect: () => set({ accent: ACCENTS[(ACCENTS.indexOf(s.accent) + 1) % ACCENTS.length] }), tip: 'Cycles through the available accent colors' }),
        row({ key: 'sounds', label: 'Interface sounds', iconName: 'sound', toggle: s.sounds, onSelect: () => set({ sounds: !s.sounds }) }),
        row({ key: 'soundPack', label: 'Sound pack', iconName: 'sound', value: packName(s.soundPack), onSelect: pickSoundPack, tip: 'Steam Deck sound loader packs work as they are. Packs live in your Halcyon config folder under “sounds”.' }),
        row({ key: 'dim', label: 'Dim the screen when idle', iconName: 'moon', toggle: s.dimWhenIdle !== false, onSelect: () => set({ dimWhenIdle: s.dimWhenIdle === false }), tip: 'After five minutes without input. Any button wakes it.' }),
      ]),
      card('library', [
        row({ key: 'rescan', label: 'Rescan library', iconName: 'refresh', sub: `${fmt.count(state.lib.games.length, 'game')} found`, onSelect: () => report(api.library.rescan(), 'Library rescanned') }),
        row({ key: 'add', label: 'Add a game', iconName: 'plus', sub: 'Any program or command', onSelect: async () => { const id = await addGame(); if (id) app.go('games', { filter: 'all', enter: true, focusKey: `g:${id}` }); } }),
        row({ key: 'controllerOnly', label: 'Hide games without controller support', iconName: 'pad', toggle: s.controllerOnly,
          sub: s.controllerOnly ? `${fmt.count(noPadGames().length, 'game')} hidden` : null,
          onSelect: () => set({ controllerOnly: !s.controllerOnly }),
          tip: 'Uses Steam’s store listing. Change a single game from its options menu; hidden ones are under Collections › No controller.' }),
        row({ key: 'showHidden', label: 'Show hidden games', iconName: 'eyeOff', toggle: s.showHidden, onSelect: () => set({ showHidden: !s.showHidden }) }),
        row({ key: 'systems', label: 'Emulators and ROM folders', iconName: 'chip', onSelect: () => app.go('systems', { enter: true }) }),
      ]),
      card('artwork', [
        row({ key: 'remoteArt', label: 'Use Steam’s artwork server', iconName: 'image', toggle: s.remoteArt, onSelect: () => set({ remoteArt: !s.remoteArt }), tip: 'Fetches Steam covers from Steam’s CDN when they are not cached locally' }),
        row({ key: 'sgdbKey', label: 'SteamGridDB API key', iconName: 'key', value: hasKey ? 'Saved' : 'Not set', onSelect: editKey, tip: 'Free from steamgriddb.com › Preferences › API. Ctrl+V pastes into the keyboard.' }),
        row({ key: 'scrape', label: 'Fetch missing artwork', iconName: 'download', sub: scrapeStatus || (hasKey ? 'Covers and backgrounds from SteamGridDB' : 'Add an API key first'), onSelect: hasKey ? fetchArt : editKey }),
      ]),
      card('steam', [
        ...installs.map((inst, i) => row({
          key: `steam:${i}`, label: KIND[inst.kind] || 'Steam', iconName: 'cloud',
          sub: `${fmt.count(inst.gameCount, 'game')} · ${fmt.count(inst.libraries.length, 'library folder')}`,
          onSelect: inst.kind === 'custom' ? () => removeRoot(inst.root) : () => showLibraries(inst),
          tip: inst.root,
        })),
        !installs.length && row({ key: 'steam:none', label: 'Steam not detected', iconName: 'warn', sub: 'Add your Steam folder below if it lives somewhere unusual' }),
        row({ key: 'steam:add', label: 'Add Steam folder', iconName: 'plus', sub: 'A folder that contains “steamapps”', onSelect: addRoot }),
        installs.length > 0 && row({ key: 'steam:key', label: 'Steam Web API key', iconName: 'key', value: account.hasKey ? `${account.owned} owned` : 'Not set', onSelect: editSteamKey,
          tip: 'Lets Halcyon list games you own but have not installed. Free from steamcommunity.com/dev/apikey; keep it private.' }),
        account.hasKey && row({ key: 'steam:uninstalled', label: 'Show games that are not installed', iconName: 'download', toggle: s.showUninstalled !== false, onSelect: () => set({ showUninstalled: s.showUninstalled === false }) }),
        installs.length > 0 && row({ key: 'steam:downloads', label: 'Download controls', iconName: 'download', toggle: dl.enabled,
          sub: dl.enabled ? (dl.connected ? 'Connected to Steam' : 'Restart Steam to finish') : 'Pause, resume, reorder and update from Halcyon',
          onSelect: toggleDownloads, tip: 'Uses Steam’s debugging port (the Decky Loader method). While on, any program on this computer can control Steam.' }),
        installs.length > 0 && row({ key: 'steam:queue', label: 'Downloads', iconName: 'download', onSelect: () => app.downloads() }),
        installs.length > 0 && row({ key: 'steam:shaders', label: 'Skip shader processing', iconName: 'spark', toggle: Boolean(s.steamSkipShaders), onSelect: () => set({ steamSkipShaders: !s.steamSkipShaders }),
          sub: s.steamSkipShaders ? 'Skipped automatically' : 'Press A on the launch screen to skip',
          tip: 'Steam’s “Processing Vulkan shaders” before a game. Skipping starts the game sooner; it may stutter a little at first. Needs download controls.' }),
        installs.length > 0 && row({ key: 'steam:bigpicture', label: 'Big Picture for store and installs', iconName: 'pad', toggle: Boolean(s.steamBigPicture), onSelect: () => set({ steamBigPicture: !s.steamBigPicture }),
          tip: 'Switches Steam to Big Picture when you buy or install a game, so Steam’s own screens work with the controller. Games themselves start without it.' }),
        installs.length > 0 && row({ key: 'steam:bpm', label: 'Open Big Picture', iconName: 'pad', sub: 'Steam’s controller mode; close it again from the Guide', onSelect: () => report(api.steam.openBigPicture(), 'Opening Big Picture') }),
        installs.length > 0 && row({ key: 'steam:open', label: 'Open Steam', iconName: 'screen', onSelect: () => report(api.steam.open(), 'Opening Steam') }),
      ]),
      card('system', [
        row({ key: 'pads', label: 'Controllers', iconName: 'pad', sub: state.pads.length ? state.pads.map((p) => p.name).join(', ') : 'None connected — plug one in at any time' }),
        row({ key: 'homeButton', label: 'Home button opens the Guide', iconName: 'pad', toggle: s.homeButtonGuide !== false,
          sub: s.homeButtonGuide === false ? 'Steam keeps the Home button' : home.steamReleased ? 'Over any game · Steam told to leave it alone' : home.steamConnected === false ? 'Over any game · turn on Steam download controls too' : 'Over any game',
          onSelect: () => set({ homeButtonGuide: s.homeButtonGuide === false }),
          tip: 'Opens Halcyon’s Guide over any game or the desktop. While Halcyon runs it turns off Steam’s “Guide button focuses Steam”, and turns it back on when Halcyon closes.' }),
        row({ key: 'autostart', label: 'Start Halcyon on login', iconName: 'login', toggle: autostart, onSelect: toggleAutostart, tip: 'Boots straight into the dashboard when you sign in to your desktop' }),
        row({ key: 'bootAnimation', label: 'Start-up animation', iconName: 'spark', toggle: s.bootAnimation !== false, onSelect: () => set({ bootAnimation: s.bootAnimation === false }) }),
        row({ key: 'storage', label: 'Storage', iconName: 'folder', sub: 'What your games take up on each drive; uninstall from here', onSelect: () => app.storage() }),
        row({ key: 'about', label: `Halcyon ${info?.version || ''}`, iconName: 'info', sub: info ? info.configFile : '' }),
        row({ key: 'power', label: 'Power', iconName: 'power', sub: 'Sleep, restart, shut down or exit', danger: true, onSelect: () => app.guide({ select: 'power:suspend' }) }),
      ]));
  }

  async function editKey() {
    if (state.lib.scraper?.hasKey) {
      const pick = await menu({ title: 'SteamGridDB API key', subtitle: 'A key is saved on this computer.', items: [
        { label: 'Replace key', value: 'replace', iconName: 'key' },
        { label: 'Remove key', value: 'remove', iconName: 'trash', danger: true },
      ] });
      if (pick === 'remove') await report(api.scraper.setKey(''), 'API key removed');
      if (pick !== 'replace') return;
    }
    const key = await keyboard({ title: 'SteamGridDB API key — steamgriddb.com › Preferences › API', placeholder: 'Paste with Ctrl+V or type it in' });
    if (!key || !key.trim()) return;
    await report(api.scraper.setKey(key), 'API key checked and saved');
  }

  async function editSteamKey() {
    if (state.lib.steamAccount?.hasKey) {
      const pick = await menu({ title: 'Steam Web API key', subtitle: `A key is saved on this computer. Steam lists ${state.lib.steamAccount.owned} games on your account.`, items: [
        { label: 'Refresh owned games', value: 'refresh', iconName: 'refresh' },
        { label: 'Replace key', value: 'replace', iconName: 'key' },
        { label: 'Remove key', value: 'remove', iconName: 'trash', danger: true, sub: 'Uninstalled games disappear from the library' },
      ] });
      if (pick === 'refresh') await report(api.library.rescan(), 'Library and owned games refreshed');
      if (pick === 'remove') await report(api.steam.setKey(''), 'Steam key removed');
      if (pick !== 'replace') return;
    }
    const key = await keyboard({ title: 'Steam Web API key — steamcommunity.com/dev/apikey', placeholder: 'Paste with Ctrl+V or type it in' });
    if (!key || !key.trim()) return;
    const res = await report(api.steam.setKey(key));
    if (res && res.ok) toast(res.count ? `Steam lists ${res.count} games on your account` : 'Steam accepted the key but listed no games. Is your game details privacy set to public?', { title: 'Steam key saved', iconName: 'key', ms: res.count ? 3600 : 9000 });
  }

  async function fetchArt() {
    if (scrapeStatus) return;
    scrapeStatus = 'Looking…';
    render();
    const res = await report(api.scraper.run());
    scrapeStatus = '';
    render();
    app.refreshChrome();
    if (res && res.ok) {
      toast(res.tried ? `Artwork found for ${res.found} of ${fmt.count(res.tried, 'game')}` : 'Every game already has artwork', { title: 'SteamGridDB', iconName: 'image' });
    }
  }

  let dl = { enabled: false, connected: false };
  let home = {};
  const refreshHome = () => api.home.status().then((st) => { home = st; if (!el.hidden) render(); }).catch(() => {});
  const refreshDl = () => api.downloads.status().then((st) => { dl = st; if (!el.hidden) render(); }).catch(() => {});
  async function toggleDownloads() {
    if (dl.enabled) await disableControls(); else await enableControls();
    await refreshDl();
    app.refreshChrome();
  }

  let packs = [];
  const packName = (id) => (id ? (packs.find((p) => p.id === id)?.name || id) : 'Built-in');
  const refreshPacks = () => api.sounds.list().then((r) => { packs = r.packs || []; if (!el.hidden) render(); }).catch(() => {});

  async function pickSoundPack() {
    await refreshPacks();
    const cur = state.lib.settings.soundPack || '';
    const pick = await menu({
      title: 'Sound pack',
      subtitle: 'Interface sounds for moving, selecting, menus and notifications',
      selected: cur,
      items: [
        { label: 'Built-in', value: '', iconName: 'sound', sub: 'Halcyon’s own soft tones', checked: !cur },
        ...packs.map((p) => ({ label: p.name, value: p.id, iconName: 'sound', sub: [p.author && `by ${p.author}`, `${p.events} sounds`].filter(Boolean).join(' · '), checked: cur === p.id })),
        { label: 'Add a sound pack…', value: '+add', iconName: 'plus', sub: 'A folder of sounds, such as a Steam Deck sound pack' },
      ],
    });
    if (pick == null) return;
    if (pick === '+add') {
      const dir = await browse({ mode: 'dir', title: 'Choose a sound pack folder', start: '~/Downloads' });
      if (!dir) return;
      const res = await report(api.sounds.import(dir));
      if (res && res.ok) { await refreshPacks(); await set({ soundPack: res.id }); toast(`${res.events} sounds ready`, { title: res.name, iconName: 'sound' }); }
      return;
    }
    if (pick !== cur) await set({ soundPack: pick });
  }

  async function toggleAutostart() {
    const want = !autostart;
    const result = await report(api.system.setAutostart(want), want ? 'Halcyon will start when you log in' : 'Halcyon will no longer start on login');
    if (!result || result.ok !== false) autostart = want;
    render();
    app.refreshChrome();
  }

  async function addRoot() {
    const dir = await browse({ mode: 'dir', title: 'Choose a Steam folder', start: '~' });
    if (dir) await report(api.steam.addRoot(dir), 'Steam folder added');
  }

  async function removeRoot(root) {
    const pick = await menu({ title: 'Added Steam folder', subtitle: root, items: [{ label: 'Remove this folder', value: 'rm', iconName: 'trash', danger: true }] });
    if (pick === 'rm') await report(api.steam.removeRoot(root), 'Steam folder removed');
  }

  function showLibraries(inst) {
    return menu({
      title: KIND[inst.kind] || 'Steam',
      subtitle: inst.root,
      items: [{ heading: 'Library folders' }, ...inst.libraries.map((l) => ({ label: l, value: 'noop', iconName: 'folder', disabled: true })),
        { label: 'Open the games view', value: 'ok', iconName: 'grid' }],
    }).then((v) => { if (v === 'ok') app.go('games', { filter: 'steam', enter: true }); });
  }

  api.on('scrape:progress', ({ done, total }) => {
    if (!scrapeStatus) return;
    scrapeStatus = `Checked ${done} of ${total}…`;
    const sub = el.querySelector('[data-key="scrape"] .row__sub');
    if (sub) sub.textContent = scrapeStatus;
  });
  refreshPacks();
  refreshDl();
  refreshHome();
  api.on('library:changed', () => { if (!el.hidden) refreshHome(); });
  api.app.info().then((i) => { info = i; if (!el.hidden) render(); });
  api.system.status().then((st) => { autostart = Boolean(st.autostart); if (!el.hidden) render(); }).catch(() => {});

  return {
    id: 'settings',
    label: 'settings',
    el,
    render,
    defaultFocus: () => scroller.querySelector('[data-focus]'),
    onAction: () => false,
    hints: (target) => [{ a: 'accept', label: target?.querySelector('.switch') ? 'Toggle' : 'Select' }],
    context(target) {
      const label = target?.querySelector('.row__label')?.textContent;
      return label ? { title: label, meta: [help.get(target.dataset.key) || target.querySelector('.row__sub')?.textContent].filter(Boolean) } : null;
    },
    backdrop: () => [],
  };
}
