'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell, screen } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { JsonStore, DEFAULTS } = require('./store');
const { Library } = require('./library');
const { Launcher } = require('./launcher');
const files = require('./files');
const system = require('./system');
const installer = require('./emulators/install');
const scraper = require('./scraper');
const steam = require('./steam/steam');
const steamStore = require('./steam/store');
const steamClient = require('./steam/client');
const { PadWatch } = require('./padwatch');
const sounds = require('./sounds');
const diary = require('./log');
const monitorAudio = require('./monitorAudio');
const cosmicWindows = require('./cosmicWindows');
const { Jellyfin } = require('./media/jellyfin');
const { Achievements } = require('./steam/achievements');
const { Retro } = require('./retro');
const { IMAGE_EXT, expandHome, isDir } = require('./util');

const windowed = process.argv.includes('--windowed');

// Tests run against a throwaway config folder so they never touch the real one.
if (process.env.HALCYON_CONFIG_DIR) app.setPath('userData', process.env.HALCYON_CONFIG_DIR);

// Interface sounds must play for controller input too, which Chromium does not count as a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  // Jellyfin images and streams, fetched here with the session token (which the page never sees).
  { scheme: 'jf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  console.log('Halcyon is already running — switching to the open window.');
  app.quit();
} else {
  let win = null;
  let store = null;
  let library = null;
  let launcher = null;
  let jellyfin = null;
  let achievements = null;
  let retro = null;
  let ready = Promise.resolve();

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const pushLibrary = () => send('library:changed', library.snapshot());
  const notice = (message, opts = {}) => send('app:notice', { message, ...opts });
  let rescanning = false;
  let autoArt = null;   // set up with the IPC: fetch covers for newly found ports and added games
  const rescan = async () => {
    rescanning = true;
    try { await library.scan(); } finally { rescanning = false; }
    pushLibrary();
    checkControllers();
    if (autoArt) autoArt();
  };

  // ---- Steam downloads: follow the manifests while Steam works on them
  function pollDownloads() {
    if (rescanning || !library) return;
    let verdict = 'none';
    try { verdict = library.applyManifests(steam.manifests(store.data.steam.extraRoots)); } catch { return; }
    if (verdict === 'changed') {
      send('steam:downloads', library.raw.steam.games.filter((g) => g.installed !== false).map((g) => ({ id: g.id, download: g.download })));
    } else if (verdict === 'rescan') {
      const busy = new Map(library.raw.steam.games.filter((g) => g.download).map((g) => [g.id, g.name]));
      rescan().then(() => {
        for (const [id, name] of busy) {
          const g = library.get(id);
          if (g && g.installed !== false && !g.download) notice(`${name} is ready to play`, { title: 'Download complete', iconName: 'download' });
        }
      }).catch(() => {});
    }
  }

  /** Refresh the owned-games list when a key is set and the last answer is old (or on demand). */
  async function refreshOwned({ force = false } = {}) {
    const cfg = store.data;
    if (!cfg.secrets.steamKey) return { ok: false };
    if (!force && Date.now() - (cfg.steamOwned.at || 0) < 6 * 3600 * 1000) return { ok: true, fresh: true };
    const result = await library.refreshOwned();
    if (result.ok) { pushLibrary(); checkControllers(); }
    return result;
  }

  // Controller-support lookups run in the background and only when the filter is in use.
  let checkingControllers = false;
  async function checkControllers({ announce = false } = {}) {
    if (checkingControllers || !store.data.settings.controllerOnly) return;
    if (process.env.HALCYON_DRY_RUN && !process.env.HALCYON_STEAM_STORE_URL) return;
    const pending = library.controllerPending().length;
    if (!pending) {
      if (announce) notice(hiddenSummary(), { title: 'Controller filter on', iconName: 'pad' });
      return;
    }
    checkingControllers = true;
    try {
      if (announce) notice(`Asking Steam about ${pending} game${pending === 1 ? '' : 's'}…`, { title: 'Checking controller support', iconName: 'pad' });
      // Steam allows roughly 200 store lookups per five minutes, so a big library is paced.
      const gapMs = pending > 150 ? 1600 : 220;
      let result = { rateLimited: false };
      while (library.controllerPending().length && store.data.settings.controllerOnly) {
        const before = library.controllerPending().length;
        result = await library.refreshControllerSupport(null, { limit: 40, gapMs });
        pushLibrary();
        if (result.rateLimited || library.controllerPending().length >= before) break;
      }
      if (result.rateLimited) notice('Steam asked us to slow down. The rest will be checked on the next rescan.', { title: 'Controller support', type: 'error' });
      else if (announce) notice(hiddenSummary(), { title: 'Controller filter on', iconName: 'pad' });
    } catch (err) {
      if (announce) notice(`Could not reach Steam: ${err.message}`, { title: 'Controller support', type: 'error' });
    } finally {
      checkingControllers = false;
    }
  }
  function hiddenSummary() {
    const n = library.snapshot().games.filter((g) => g.controller === 'none').length;
    return n ? `${n} game${n === 1 ? '' : 's'} without controller support ${n === 1 ? 'is' : 'are'} now hidden` : 'Every game here supports a controller';
  }

  // ---- in-game menu: Home button while a game has the screen
  // Desktops (Wayland ones especially) do not let a background window push itself in
  // front of a game, but a newly opened window is given focus. So the menu is a small
  // window of its own, opened on demand; closing it returns focus to the game.
  let gameMenu = null;   // the Guide window while it is on screen
  let spare = null;      // a loaded, hidden Guide window, so Home can show one instantly
  let lastSummon = 0;

  // ---- which monitor Halcyon uses (Settings › display › Monitor). Monitors are remembered by
  // the name the desktop gives them ("make - model - port"), which survives reboots and
  // rearranging; a monitor that is unplugged leaves Halcyon wherever the desktop puts it.
  function chosenDisplay() {
    const want = store.data.settings.monitor;
    if (!want) return null;
    const all = screen.getAllDisplays();
    const port = want.split(' - ').pop();
    return all.find((d) => d.label === want) || all.find((d) => d.label && d.label.split(' - ').pop() === port) || null;
  }
  /** Window bounds on the chosen monitor (centred, for a window that is not fullscreen). */
  function boundsOn(d, width = 1600, height = 900) {
    const b = d.workArea || d.bounds;
    const w = Math.min(width, b.width); const h = Math.min(height, b.height);
    return { x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2), width: w, height: h };
  }
  let moving = false;   // while a window is being carried to another monitor
  // The dashboard window's title, which is how the compositor finds it (a test copy can use
  // another one so it never moves the real Halcyon).
  const DASHBOARD_TITLE = process.env.HALCYON_WINDOW_TITLE || 'Halcyon';
  const portOf = (label) => (label || '').split(' - ').pop();
  const displayByPort = (port) => screen.getAllDisplays().find((d) => portOf(d.label) === port) || null;
  /**
   * The monitor the dashboard is really on. Under Wayland an app can't see where its window is
   * (Electron only knows where it asked for it to go), so on COSMIC the compositor is asked.
   */
  async function dashboardDisplay() {
    if (!win || win.isDestroyed()) return null;
    if (cosmicWindows.available()) {
      const outs = await cosmicWindows.windowOutputs(DASHBOARD_TITLE);
      if (outs.length) return displayByPort(outs[0]);
    }
    return screen.getDisplayMatching(win.getBounds());
  }

  /** Should sound go to this monitor's speakers? The setting lists monitors; unset = TVs. */
  async function wantsSound(label) {
    const chosen = store.data.settings.monitorAudio;
    if (Array.isArray(chosen)) return chosen.includes(label);
    const model = (label || '').split(' - ')[1];
    const out = model && (await monitorAudio.outputs()).find((o) => o.monitor.toLowerCase() === model.toLowerCase());
    return Boolean(out && monitorAudio.tvLike(out));
  }
  /** Sound follows the monitor the dashboard is on (and goes back when it leaves). */
  let audioTimer = null;
  function syncAudio(delay = 800) {
    clearTimeout(audioTimer);
    audioTimer = setTimeout(async () => {
      if (!win || win.isDestroyed() || moving) return;
      const d = await dashboardDisplay();
      const label = d?.label || '';
      const model = (await wantsSound(label)) ? label.split(' - ')[1] : null;
      monitorAudio.follow(model).catch((err) => diary.log(`monitor audio: ${err.message}`));
    }, delay);
  }
  /** Move a window to the chosen monitor, coming out of fullscreen and going back in there. */
  async function placeOnMonitor(w) {
    const d = chosenDisplay();
    if (!w || w.isDestroyed()) return;
    if (!d) { syncAudio(); return; }
    // COSMIC: ask the compositor to move the window and fullscreen it on that output.
    if (cosmicWindows.available()) {
      if (moving) return;
      moving = true;
      const full = !windowed && store.data.settings.fullscreen;
      const r = await cosmicWindows.moveWindow(DASHBOARD_TITLE, portOf(d.label), { fullscreen: full });
      diary.log(`monitor: ${d.label} -> ${r.ok ? `on ${r.on.join(', ')}${r.fullscreen ? ', fullscreen' : ''}` : `not moved (${r.error})`}`);
      moving = false;
      if (r.ok) { syncAudio(); return; }
    }
    const on = screen.getDisplayMatching(w.getBounds());
    if (on && on.id === d.id) { syncAudio(); return; }
    diary.log(`monitor: moving the dashboard to ${d.label || d.id}`);
    const wasFull = w.isFullScreen();
    const go = () => {
      w.setBounds(boundsOn(d));
      if (wasFull || (!windowed && store.data.settings.fullscreen)) setTimeout(() => { if (!w.isDestroyed()) w.setFullScreen(true); moving = false; syncAudio(); }, 120);
      else { moving = false; syncAudio(); }
    };
    moving = true;
    if (wasFull) { w.once('leave-full-screen', () => setTimeout(go, 60)); w.setFullScreen(false); } else go();
  }

  function makeGuideWindow(waitForOpen) {
    const there = chosenDisplay();
    const w = new BrowserWindow({
      ...(there ? boundsOn(there) : {}),
      // Mapped at once, already dark: the desktop never shows while the page loads.
      show: !waitForOpen,
      fullscreen: true,
      frame: false,
      // Opaque: a see-through window over a fullscreen game is not composited above it on
      // some desktops (the game is scanned out directly). The page paints the game's own art.
      transparent: false,
      backgroundColor: '#05070a',
      skipTaskbar: true,
      title: 'Halcyon Guide',
      alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.loadFile(path.join(__dirname, '../renderer/gamemenu.html'), waitForOpen ? { query: { wait: '1' } } : undefined);
    w.webContents.once('did-finish-load', () => { w.loaded = true; });
    return w;
  }

  /** Keep a Guide window loaded and hidden while a game runs: shown on Home with no gap. */
  function prewarmGuide() {
    // Disabled: on COSMIC a window shown again later is not brought in front or focused, so
    // the Guide is always a newly opened window (those are). Kept for desktops where it helps.
    if (!process.env.HALCYON_GUIDE_SPARE) return;
    if (spare && !spare.isDestroyed()) return;
    if (store.data.settings.homeButtonGuide === false || !launcher.nowPlaying().length) return;
    spare = makeGuideWindow(true);
    spare.on('closed', function onClosed() { if (spare && spare.isDestroyed()) spare = null; });
    diary.log('guide-over-game: spare ready');
  }
  function dropSpare() {
    if (spare && !spare.isDestroyed()) spare.destroy();
    spare = null;
  }

  let guideClosedAt = 0;
  function closeGameMenu() {
    if (gameMenu) guideClosedAt = Date.now();
    if (gameMenu && !gameMenu.isDestroyed()) gameMenu.destroy();
    gameMenu = null;
    setTimeout(() => prewarmGuide(), 600);
  }

  function summonGameMenu(force = false) {
    if (gameMenu) return { ok: true, open: true };                   // its own Home handler closes it
    if (!force && win && !win.isDestroyed() && win.isFocused()) return { ok: true, alreadyFocused: true }; // the dashboard's guide covers this
    if (Date.now() - lastSummon < 700) return { ok: true };
    lastSummon = Date.now();

    const ready = spare && !spare.isDestroyed() && spare.loaded;
    const menu = ready ? spare : makeGuideWindow(false);
    if (ready) spare = null;
    gameMenu = menu;
    let shownAt = 0;
    const show = () => {
      if (menu.isDestroyed()) return;
      menu.show();
      menu.focus();
      shownAt = Date.now();
      if (ready) menu.webContents.send('guide:open');
      diary.log(`guide-over-game: shown (${ready ? 'ready' : 'fresh'}), focused =`, menu.isFocused());
    };
    if (ready) show(); else { shownAt = Date.now(); menu.focus(); diary.log('guide-over-game: opened (fresh)'); }
    // Never leave an unseen Guide holding Home: if it has not got the screen soon, drop it.
    setTimeout(() => {
      if (!menu.isDestroyed() && gameMenu === menu && !menu.isFocused()) { diary.log('guide-over-game: never got the screen, closing'); closeGameMenu(); }
    }, 1200);
    menu.on('focus', () => diary.log('guide-over-game: focus'));
    // If the game takes the screen back, close the Guide straight away: left open behind a
    // game it would keep the focus, and the game would stop taking input.
    menu.on('blur', () => {
      diary.log('guide-over-game: blur after', Date.now() - shownAt, 'ms');
      setTimeout(() => { if (!menu.isDestroyed() && !menu.isFocused() && gameMenu === menu) { diary.log('guide-over-game: lost the screen, closing'); closeGameMenu(); } }, 400);
    });
    menu.on('closed', () => { diary.log('guide-over-game: closed'); if (gameMenu === menu) { gameMenu = null; guideClosedAt = Date.now(); } });
    if (process.env.HALCYON_DEV_MENU_SCRIPT) require('./devscript').run(menu, process.env.HALCYON_DEV_MENU_SCRIPT);
    return { ok: true, opened: true, ready };
  }
  const padWatch = new PadWatch({
    onPress: () => {
      // The Guide is up: this press is for closing it, which the Guide does itself. Do not
      // open another one a moment later.
      if (gameMenu || Date.now() - guideClosedAt < 900) { diary.log('home button (controller): guide is up, it closes itself'); return; }
      // In a Steam game, Steam's own overlay answers Home too and takes the screen a moment
      // later; opening after it puts Halcyon's Guide on top instead of under it.
      const steamGame = launcher.nowPlaying().some((p) => !p.quittable);
      // Steam acts on Home when it is released; tell it straight away to keep its overlay shut.
      if (steamGame) steamClient.blockOverlayFor(2500).catch(() => {});
      const delay = steamGame ? 350 : 0;
      diary.log('home button (controller):', { steamGame, delay });
      setTimeout(() => { if (Date.now() - guideClosedAt < 900) return; diary.log('summon:', summonGameMenu()); }, delay);
      if (steamGame) setTimeout(() => steamClient.launchHookStatus().then((st) => diary.log('steam overlay watch:', st)).catch(() => {}), 2500);
    },
    onHold: () => {
      if (!launcher.nowPlaying().some((p) => p.quittable)) return;
      launcher.quit().then((result) => {
        if (result.ok) closeGameMenu();
      });
    },
  });
  /**
   * With "Home button opens the Guide" on, the controller's Home button is watched the whole
   * time Halcyon runs, so the Guide comes up over any game (Steam's too) or the desktop.
   * While Halcyon itself is in front, the dashboard reads the button the normal way.
   */
  function syncPadWatch() {
    if (store.data.settings.homeButtonGuide !== false && !process.env.HALCYON_DRY_RUN) padWatch.start(); else padWatch.stop();
  }

  // ---- keep Steam off the Home button while Halcyon runs
  // Steam's "Guide button focuses Steam" pulls Steam to the front on Home. Halcyon turns it
  // off while it runs (through Steam's own settings, so download controls must be on) and
  // turns it back on when it quits.
  // Each change is tracked on its own, so Halcyon only ever hands back what it took.
  async function claimHomeButton() {
    const d = store.data;
    const want = d.settings.homeButtonGuide !== false;
    if (process.env.HALCYON_DRY_RUN && !process.env.HALCYON_STEAM_CEF_PORT) return { ok: true, dryRun: true };
    let result = { ok: true, unchanged: true };
    if (want !== d.steamGuideFocusOff) {
      result = await steamClient.setGuideFocusesSteam(!want);
      if (result.ok) d.steamGuideFocusOff = want;
    }
    // Steam's in-game overlay must stay on: Steam Input delivers the controller to Steam games
    // through it. (An earlier version turned it off; turn it back on if so.)
    if (d.steamOverlayOff) {
      const back = await steamClient.setInGameOverlay(true);
      if (back.ok) d.steamOverlayOff = false;
    }
    store.save();
    return result;
  }
  async function releaseHomeButton() {
    if (!store) return;
    const d = store.data;
    if (d.steamGuideFocusOff && (await steamClient.setGuideFocusesSteam(true)).ok) d.steamGuideFocusOff = false;
    if (d.steamOverlayOff && (await steamClient.setInGameOverlay(true)).ok) d.steamOverlayOff = false;
    store.flush();
  }

  // ---- a starting game opens on Halcyon's screen. COSMIC puts new windows on the screen the
  // pointer is on, which isn't Halcyon's after Halcyon has been moved (until you click there),
  // so for a while after a launch every new window is brought over to Halcyon's screen.
  let following = null;
  function stopFollowing() { if (following) { following.stop(); following = null; } }
  async function followGameToHalcyon(id) {
    stopFollowing();
    if (!cosmicWindows.available() || process.env.HALCYON_DRY_RUN) return;
    const d = await dashboardDisplay().catch(() => null);
    const port = d && portOf(d.label);
    if (!port) return;
    following = await cosmicWindows.followNewWindows(port, {
      ms: 90000,
      skipTitles: [DASHBOARD_TITLE, 'Halcyon game menu', 'Halcyon Guide'],
      onMove: (m) => diary.log(`game window "${m.title}" moved from ${m.from.join(', ') || '?'} to ${m.to}${m.ok ? '' : ' (not confirmed)'}`),
    });
    diary.log(`launch ${id}: new windows follow Halcyon to ${port}`);
  }

  // ---- the Guide (in its own window over a game) asks the dashboard to take over
  let pendingNav = null;
  async function showDashboard(nav) {
    closeGameMenu();
    if (!win || win.isDestroyed()) return { ok: false };
    const how = process.env.HALCYON_DEV_SCRIPT ? 'focused' : await bringToFront({ force: false });
    if (how === 'reopened') pendingNav = nav;      // the new window asks for it once it is up
    else send('dashboard:navigate', nav);
    return { ok: true };
  }

  function registerIpc() {
    const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error(`[ipc] ${channel}:`, err);
        return { ok: false, error: err.message };
      }
    });
    const cfg = () => store.data;

    handle('library:get', async () => { await ready; return library.snapshot(); });
    handle('library:rescan', async () => { await rescan(); refreshOwned({ force: true }).catch(() => {}); return { ok: true }; });

    handle('game:launch', async (id) => {
      diary.log('launch:', id);
      await followGameToHalcyon(id);
      const result = await launcher.launch(id);
      if (!result.ok) stopFollowing();
      diary.log('launch result:', result);
      if (result.ok) {
        pushLibrary();
      }
      return result;
    });
    handle('game:summon', (force) => summonGameMenu(Boolean(force) && Boolean(process.env.HALCYON_DEV_SCRIPT)));
    handle('game:quit', (id) => launcher.quit(id));
    handle('dashboard:show', (nav) => showDashboard(nav || {}));
    handle('app:pendingNav', () => { const nav = pendingNav; pendingNav = null; return nav; });
    handle('home:status', async () => ({ ok: true, enabled: cfg().settings.homeButtonGuide !== false, steamReleased: cfg().steamGuideFocusOff, watching: padWatch.listening, steamConnected: steamClient.enabled(steam.findInstalls(cfg().steam.extraRoots)) && (await steamClient.downloads()).ok }));
    handle('game:resume', () => {
      // From the in-game menu: closing that window hands focus straight back to the game.
      if (gameMenu) { closeGameMenu(); return { ok: true }; }
      // From the dashboard: step aside so the game underneath has the screen again.
      if (win && launcher.nowPlaying().length && !process.env.HALCYON_DRY_RUN) win.minimize();
      return { ok: true };
    });
    handle('game:patch', (id, patch) => { library.patchGame(id, patch); pushLibrary(); return { ok: true }; });

    handle('custom:save', (game) => { const id = library.saveCustom(game); pushLibrary(); return { ok: true, id }; });
    handle('custom:remove', (id) => { library.deleteCustom(id); pushLibrary(); return { ok: true }; });

    handle('collections:create', (name) => { const id = library.createCollection(name); pushLibrary(); return { ok: true, id }; });
    handle('collections:rename', (id, name) => { library.renameCollection(id, name); pushLibrary(); return { ok: true }; });
    handle('collections:remove', (id) => { library.deleteCollection(id); pushLibrary(); return { ok: true }; });

    handle('emulators:configure', async (id, patch) => {
      const next = { ...(cfg().emulators[id] || {}), ...patch };
      if (!next.path && !next.args) delete cfg().emulators[id]; else cfg().emulators[id] = next;
      store.save();
      await rescan();
      return { ok: true };
    });
    handle('systems:configure', async (id, patch) => {
      const cur = cfg().systems[id] || { emulator: '', romDirs: [], core: '' };
      cfg().systems[id] = { ...cur, ...patch };
      store.save();
      await rescan();
      return { ok: true };
    });
    handle('emulators:open', (id) => launcher.openEmulator(id));
    handle('emulators:plan', (id) => installer.plan(id));
    handle('emulators:install', async (id, method) => {
      const result = await installer.install(id, method, cfg().installed[id], (p) => send('install:progress', { id, ...p }));
      if (result.ok) {
        if (result.method === 'github') cfg().installed[id] = { file: result.file, tag: result.tag, repo: result.repo };
        store.save();
        await rescan();
      }
      return result;
    });
    handle('emulators:cancelInstall', (id) => installer.cancel(id));
    handle('emulators:openPage', async (id) => {
      const e = library.raw.emu.emulators.find((x) => x.id === id);
      if (!e || !e.page) return { ok: false, error: 'This emulator has no project page on record.' };
      await shell.openExternal(e.page);
      return { ok: true };
    });

    handle('scraper:setKey', async (key) => {
      const clean = String(key || '').trim();
      if (clean) {
        const check = await scraper.testKey(clean);
        if (!check.ok) return check;
      }
      cfg().secrets.sgdbKey = clean;
      store.save();
      pushLibrary();
      return { ok: true };
    });
    let scraping = false;
    // New PC ports and hand-added games get SteamGridDB art by themselves (once each).
    autoArt = async () => {
      const key = cfg().secrets.sgdbKey;
      if (!key || scraping) return;
      const tried = cfg().artTried || (cfg().artTried = []);
      const want = library.missingArt().filter((g) => (g.source === 'port' || g.source === 'custom') && g.installed !== false && !tried.includes(g.id));
      if (!want.length) return;
      tried.push(...want.map((g) => g.id));
      store.save();
      scraping = true;
      try {
        const overrides = cfg().games;
        await scraper.scrapeMany(key, want.map((g) => ({ id: g.id, source: g.source, appid: null, name: (overrides[g.id] && overrides[g.id].name) || g.gameTitle || g.name })), path.join(app.getPath('userData'), 'art'), {
          onResult: (game, art) => { library.setScraped(game.id, art); pushLibrary(); },
        });
        diary.log('auto art for', want.map((g) => g.name).join(', '));
      } catch (err) { diary.log('auto art failed:', err.message); } finally { scraping = false; }
    };
    // "Add a game": installed apps that call themselves games, not already in the library.
    handle('achievements:game', (appid, opts) => achievements.game(appid, opts || {}));
    handle('achievements:totals', () => ({ ok: true, ...achievements.totals() }));
    handle('retro:status', () => ({ ok: true, ...retro.status() }));
    handle('retro:signIn', (user, key) => retro.signIn(user, key));
    handle('retro:signOut', () => retro.signOut());
    handle('retro:sync', () => retro.sync());
    handle('retro:game', (id, opts) => retro.game(id, opts || {}));
    handle('apps:openQuiver', async () => {
      const home = require('./ports').quiverHomes()[0] || path.join(require('os').homedir(), 'AppImages');
      const fs = require('fs');
      const exe = (() => { try { return fs.readdirSync(home).filter((f) => /^quiver.*\.appimage$/i.test(f)).map((f) => path.join(home, f))[0]; } catch { return null; } })();
      if (!exe) return { ok: false, error: 'Quiver Launcher wasn’t found (looked in ~/AppImages).' };
      if (process.env.HALCYON_DRY_RUN) { console.log('[dry-run] would open', exe); return { ok: true }; }
      require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    });
    handle('apps:games', () => {
      const snap = library.snapshot();
      const known = snap.games.filter((g) => g.source === 'custom').map((g) => g.detail).filter(Boolean);
      const names = (library.raw.ports || []).flatMap((p) => [p.name, (p.platform || '').split(' · ')[0]]);
      return require('./ports').gameApps(known, names);
    });
    // Choosing artwork by hand: what SteamGridDB has for a game, and saving the one picked.
    handle('scraper:candidates', async (id, kind, sgdbId) => {
      const key = cfg().secrets.sgdbKey;
      if (!key) return { ok: false, error: 'Add your SteamGridDB API key under Settings first.' };
      const g = library.get(id);
      if (!g) return { ok: false, error: 'Unknown game.' };
      const o = cfg().games[id] || {};
      try {
        const r = await scraper.candidates(key, { id, source: g.source, appid: g.source === 'steam' ? id.slice(6) : null, name: o.name || g.gameTitle || g.name }, kind, sgdbId || null);
        return { ok: true, ...r };
      } catch (err) { return { ok: false, error: err.message }; }
    });
    handle('scraper:choose', async (id, kind, url) => {
      const g = library.get(id);
      if (!g) return { ok: false, error: 'Unknown game.' };
      try {
        const artDir = path.join(app.getPath('userData'), 'art');
        const file = await scraper.saveChoice(url, { id }, kind, artDir);
        const field = kind === 'cover' ? 'cover' : 'background';
        const old = (cfg().scraped[id] || {})[field];
        library.setScraped(id, { [field]: file });
        // The picture picked here wins over one set by hand before.
        if (cfg().games[id] && cfg().games[id][field]) delete cfg().games[id][field];
        store.save();
        if (old && old !== file && old.startsWith(artDir)) require('fs').promises.rm(old, { force: true }).catch(() => {});
        pushLibrary();
        return { ok: true, file };
      } catch (err) { return { ok: false, error: err.message }; }
    });
    handle('scraper:run', async (ids) => {
      const key = cfg().secrets.sgdbKey;
      if (!key) return { ok: false, error: 'Add your SteamGridDB API key under Settings first.' };
      if (scraping) return { ok: false, error: 'Artwork is already being fetched.' };
      const picked = Array.isArray(ids) ? ids.map((id) => library.get(id)).filter(Boolean) : library.missingArt();
      const overrides = cfg().games;
      const games = picked.map((g) => ({ id: g.id, source: g.source, appid: g.source === 'steam' ? g.id.slice(6) : null, name: (overrides[g.id] && overrides[g.id].name) || g.gameTitle || g.name }));
      if (!games.length) return { ok: true, found: 0, tried: 0 };
      scraping = true;
      try {
        return await scraper.scrapeMany(key, games, path.join(app.getPath('userData'), 'art'), {
          onResult: (game, art) => { library.setScraped(game.id, art); pushLibrary(); },
          onProgress: (done, total) => send('scrape:progress', { done, total }),
        });
      } finally {
        scraping = false;
      }
    });
    handle('roms:addRoot', async (dir) => {
      const root = expandHome(dir);
      if (!isDir(root)) return { ok: false, error: 'That folder does not exist.' };
      if (!cfg().romRoots.includes(root)) cfg().romRoots.push(root);
      store.save();
      await rescan();
      return { ok: true };
    });
    handle('roms:removeRoot', async (dir) => {
      cfg().romRoots = cfg().romRoots.filter((r) => r !== dir);
      store.save();
      await rescan();
      return { ok: true };
    });

    handle('steam:open', () => launcher.openSteam());
    handle('steam:action', (action, appid) => launcher.steamAction(action, appid));
    handle('steam:leaveBigPicture', () => launcher.leaveBigPicture());
    // Installing from Halcyon: Steam's library folders, then the install itself (no Steam dialog).
    handle('steam:installFolders', async () => {
      if (!steamClient.enabled(steam.findInstalls(cfg().steam.extraRoots))) return { ok: false, error: 'Download controls are off.' };
      return steamClient.installFolders();
    });
    handle('steam:install', async (appid, folderIndex) => {
      if (process.env.HALCYON_DRY_RUN && !process.env.HALCYON_REAL_STEAM) { console.log('[dry-run] would install', appid, 'to folder', folderIndex); return { ok: true, started: true, dryRun: true }; }
      const r = await steamClient.installApp(appid, folderIndex, { cancel: Boolean(process.env.HALCYON_INSTALL_CHECK_ONLY) });
      diary.log('install', appid, 'folder', folderIndex, '->', JSON.stringify(r));
      if (r.ok && r.started) setTimeout(() => rescan().catch(() => {}), 5000);
      return r;
    });
    handle('steam:uninstall', async (appid) => {
      const r = await launcher.uninstallSteamGame(appid);
      // Steam removes the files and the manifest; pick that up when it's done.
      if (r.ok) for (const ms of [4000, 12000, 30000]) setTimeout(() => rescan().catch(() => {}), ms);
      return r;
    });
    // The storage manager: each drive with its free space, and the games on it, largest first.
    handle('storage:info', () => {
      const fs = require('fs');
      const mounts = (() => {
        try {
          return fs.readFileSync('/proc/self/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p[1] && p[0].startsWith('/'))
            .map((p) => p[1].replace(/\\040/g, ' ')).sort((a, b) => b.length - a.length);
        } catch { return ['/']; }
      })();
      const mountOf = (p) => mounts.find((m) => p === m || p.startsWith(m.endsWith('/') ? m : `${m}/`)) || '/';
      const drives = new Map();
      const driveFor = (dir) => {
        const mount = mountOf(dir);
        if (!drives.has(mount)) {
          let total = 0; let free = 0;
          try { const st = fs.statfsSync(mount); total = st.blocks * st.bsize; free = st.bavail * st.bsize; } catch { /* unreadable */ }
          drives.set(mount, { mount, total, free, folders: new Set(), games: [] });
        }
        return drives.get(mount);
      };
      const snap = library.snapshot();
      for (const inst of library.raw.steam.installs || []) {
        for (const lib of inst.libraries || []) driveFor(lib).folders.add(lib);
      }
      for (const g of snap.games) {
        if (!g.installed || !g.detail || !g.detail.startsWith('/')) continue;
        const folder = g.source === 'steam' ? g.detail.split('/steamapps/common')[0] : path.dirname(g.detail);
        const d = driveFor(folder);
        d.folders.add(folder);
        d.games.push({ id: g.id, name: g.name, source: g.source, platform: g.platform, size: g.sizeBytes || 0, folder, lastPlayed: g.lastPlayed || 0 });
      }
      return [...drives.values()].map((d) => ({ ...d, folders: [...d.folders], games: d.games.sort((a, b) => b.size - a.size) }))
        .sort((a, b) => b.games.reduce((n, g) => n + g.size, 0) - a.games.reduce((n, g) => n + g.size, 0));
    });
    // Settings and the Guide: open Steam Big Picture on request (it closes again from the Guide).
    handle('steam:openBigPicture', async () => {
      const done = await launcher.bigPicture(null, { force: true });
      return done ? { ok: true } : { ok: false, error: 'Steam is not installed.' };
    });
    handle('steam:skipShaders', (actionId) => steamClient.skipShaders(actionId));
    handle('steam:hookStatus', () => steamClient.launchHookStatus());
    // ---- download manager (Steam's own download controls; see steam/client.js)
    const installs = () => steam.findInstalls(cfg().steam.extraRoots);
    handle('downloads:status', async () => {
      const on = steamClient.enabled(installs());
      const live = on ? await steamClient.downloads() : { ok: false, offline: true };
      return { ok: true, enabled: on, connected: Boolean(live.ok), error: live.ok ? null : live.error || null, ...(live.ok ? live : {}) };
    });
    handle('downloads:enable', (on) => steamClient.setEnabled(installs(), Boolean(on)));
    handle('downloads:control', async (action, appid, index) => {
      const result = await steamClient.control(action, appid, index);
      if (result.ok) setTimeout(pollDownloads, 800);   // show the change without waiting for the next tick
      return result;
    });
    handle('steam:setKey', async (key) => {
      const clean = String(key || '').trim();
      if (!clean) {
        cfg().secrets.steamKey = '';
        cfg().steamOwned = { at: 0, games: [] };
        store.save();
        library.addUninstalled();
        pushLibrary();
        return { ok: true, count: 0 };
      }
      // The key is only kept if Steam accepts it.
      const result = await library.refreshOwned(clean);
      if (!result.ok) return result;
      cfg().secrets.steamKey = clean;
      store.save();
      pushLibrary();
      checkControllers();
      return result;
    });
    const storeCall = (fn) => async (...args) => {
      try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
    };
    handle('store:featured', storeCall(() => steamStore.featured()));
    handle('store:search', storeCall((term) => steamStore.search(term)));
    handle('store:details', storeCall((appid) => steamStore.details(String(appid))));
    handle('steam:addRoot', async (dir) => {
      const root = expandHome(dir);
      if (!isDir(path.join(root, 'steamapps'))) return { ok: false, error: 'That folder has no "steamapps" directory, so it is not a Steam library.' };
      if (!cfg().steam.extraRoots.includes(root)) cfg().steam.extraRoots.push(root);
      store.save();
      await rescan();
      return { ok: true };
    });
    handle('steam:removeRoot', async (dir) => {
      cfg().steam.extraRoots = cfg().steam.extraRoots.filter((r) => r !== dir);
      store.save();
      await rescan();
      return { ok: true };
    });

    handle('settings:set', async (patch) => {
      const before = { ...cfg().settings };
      Object.assign(cfg().settings, patch);
      store.save();
      if ('monitor' in patch && patch.monitor !== before.monitor && win) placeOnMonitor(win);
      if ('monitorAudio' in patch) syncAudio(0);
      if ('fullscreen' in patch && win) win.setFullScreen(Boolean(patch.fullscreen));
      if ('remoteArt' in patch && patch.remoteArt !== before.remoteArt) await rescan(); else pushLibrary();
      if (patch.controllerOnly && !before.controllerOnly) checkControllers({ announce: true });
      if ('steamSkipShaders' in patch) steamClient.installLaunchHooks({ skipShaders: patch.steamSkipShaders !== false }).catch(() => {});
      if ('homeButtonGuide' in patch) { syncPadWatch(); const r = await claimHomeButton(); if (!r.ok && patch.homeButtonGuide) notice('Turn on Steam download controls so Halcyon can stop Steam taking the Home button.', { title: 'Home button', type: 'error' }); }
      if ('showUninstalled' in patch && patch.showUninstalled !== before.showUninstalled) { library.addUninstalled(); pushLibrary(); checkControllers(); }
      return { ok: true };
    });
    handle('ui:set', (patch) => {
      cfg().ui = { ...cfg().ui, ...patch, focus: { ...cfg().ui.focus, ...(patch.focus || {}) } };
      store.save();
      return { ok: true };
    });

    handle('system:status', async () => ({
      volume: await system.getVolume(),
      batteries: system.batteries(),
      autostart: system.autostartEnabled(),
      nowPlaying: launcher.nowPlaying(),
      bigPictureOpen: launcher.bigPictureOpen,
      gameMenuOpen: Boolean(gameMenu),
      homeButton: padWatch.active ? (padWatch.listening ? 'listening' : 'unavailable') : 'idle',
    }));
    // Monitors with their own speakers (HDMI / DP sound), for Settings › display › Sound.
    handle('system:monitorAudio', async () => {
      const outs = await monitorAudio.outputs();
      const displays = screen.getAllDisplays();
      return Promise.all(outs.map(async (o) => {
        const d = displays.find((x) => (x.label || '').split(' - ')[1]?.toLowerCase() === o.monitor.toLowerCase());
        const label = d?.label || o.monitor;
        return { monitor: o.monitor, label, tv: monitorAudio.tvLike(o), on: await wantsSound(label) };
      }));
    });
    // The monitors, for Settings › display › Monitor.
    handle('system:displays', async () => {
      const here = await dashboardDisplay();
      const primary = screen.getPrimaryDisplay();
      return screen.getAllDisplays().map((d) => {
        const parts = (d.label || '').split(' - ');
        return {
          label: d.label || String(d.id),
          name: parts.length >= 2 ? parts[1] : d.label || `Display ${d.id}`,
          maker: parts.length >= 3 ? parts[0] : '',
          port: parts.length >= 2 ? parts[parts.length - 1] : '',
          width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor),
          primary: d.id === primary.id, current: Boolean(here && here.id === d.id),
        };
      });
    });
    handle('system:setVolume', (patch) => system.setVolume(patch || {}));
    handle('system:power', async (action) => {
      store.flush();
      return system.power(action);
    });
    handle('system:setAutostart', (on) => system.setAutostart(Boolean(on), app.getAppPath()));

    const soundsDir = () => path.join(app.getPath('userData'), 'sounds');
    handle('sounds:list', () => ({ ok: true, packs: sounds.list(soundsDir()), dir: soundsDir() }));
    handle('sounds:load', (id) => sounds.load(soundsDir(), id));
    handle('sounds:import', (dir) => sounds.importPack(soundsDir(), expandHome(String(dir || ''))));

    // ---- Jellyfin
    const jf = (fn) => async (...args) => {
      try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, auth: Boolean(err.auth), error: err.message }; }
    };
    handle('jellyfin:status', () => ({ ok: true, ...jellyfin.status() }));
    handle('jellyfin:connect', (server, user, password) => jellyfin.connect(server, user, password));
    handle('jellyfin:disconnect', () => jellyfin.disconnect());
    handle('jellyfin:home', jf((kind) => jellyfin.home(kind)));
    handle('jellyfin:library', jf((id, start, genre, sort, unwatched) => jellyfin.library(id, start, genre, sort, unwatched)));
    handle('jellyfin:genres', jf((id) => jellyfin.genres(id)));
    handle('jellyfin:markPlayed', jf((id, played) => jellyfin.markPlayed(id, played)));
    handle('jellyfin:hideFromResume', jf((id) => jellyfin.hideFromResume(id)));
    handle('jellyfin:details', jf((id) => jellyfin.details(id)));
    handle('jellyfin:seasons', jf((id) => jellyfin.seasons(id)));
    handle('jellyfin:episodes', jf((series, season) => jellyfin.episodes(series, season)));
    handle('jellyfin:tracks', jf((id) => jellyfin.tracks(id)));
    handle('jellyfin:artists', jf((id) => jellyfin.artists(id)));
    handle('jellyfin:playlists', jf((kind) => jellyfin.playlists(kind)));
    handle('jellyfin:artistAlbums', jf((id) => jellyfin.artistAlbums(id)));
    handle('jellyfin:artistTracks', jf((id) => jellyfin.artistTracks(id)));
    handle('jellyfin:playlistTracks', jf((id) => jellyfin.playlistTracks(id)));
    handle('jellyfin:search', jf((term) => jellyfin.search(term)));
    handle('jellyfin:playback', jf((id, opts) => jellyfin.playback(id, opts || {})));
    handle('jellyfin:report', (event, p) => jellyfin.report(event, p || {}));

    handle('files:list', (dir, mode) => files.list(dir, mode));

    handle('app:quit', () => { app.quit(); });
    handle('app:setFullscreen', (on) => { if (win) win.setFullScreen(Boolean(on)); });
    handle('app:info', () => ({
      version: app.getVersion(),
      configFile: store.file,
      electron: process.versions.electron,
      skipBoot: (Boolean(process.env.HALCYON_DEV_SCRIPT) && !process.env.HALCYON_BOOT) || reopened,
    }));
  }

  function createWindow() {
    const fullscreen = !windowed && store.data.settings.fullscreen;
    const there = chosenDisplay();
    const w = new BrowserWindow({
      width: 1600,
      height: 900,
      ...(there ? boundsOn(there) : {}),
      minWidth: 960,
      minHeight: 540,
      fullscreen,
      show: false,
      backgroundColor: '#05070a',
      autoHideMenuBar: true,
      title: DASHBOARD_TITLE,
      icon: path.join(__dirname, '../renderer/icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win = w;
    for (const ev of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'enter-full-screen', 'leave-full-screen']) w.on(ev, () => diary.log(`dashboard window: ${ev}`));
    // Every handler checks it still belongs to the current window: a window that has been
    // replaced (see bringToFront) must not touch settings or state on its way out.
    const current = () => win === w;
    w.on('page-title-updated', (e) => { e.preventDefault(); w.setTitle(DASHBOARD_TITLE); });
    // Once the page has its title (that's how the compositor finds the window), go to the chosen monitor.
    w.once('ready-to-show', () => { if (!w.isDestroyed()) { w.show(); setTimeout(() => { if (current()) placeOnMonitor(w); }, 400); } });
    w.on('focus', () => { if (current()) send('window:focus', true); });
    w.on('blur', () => { if (current()) send('window:focus', false); });
    // The fullscreen setting changes only when you change it (F11 or Settings). The window can
    // drop out of fullscreen on its own (a game going fullscreen over it, the desktop
    // rearranging); it goes back in as soon as Halcyon is in front again.
    w.on('focus', () => { if (current() && !windowed && store.data.settings.fullscreen && !w.isFullScreen()) w.setFullScreen(true); });
    // Pushed out of fullscreen by something else (not F11 or Settings, which change the setting
    // first): go straight back, so the desktop never shows around the dashboard.
    w.on('leave-full-screen', () => { if (current() && !moving && !windowed && store.data.settings.fullscreen) setTimeout(() => { if (!w.isDestroyed() && !w.isMinimized() && store.data.settings.fullscreen && !w.isFullScreen()) w.setFullScreen(true); }, 150); });
    w.on('closed', () => { if (current()) { win = null; closeGameMenu(); dropSpare(); } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') {
        const on = !w.isFullScreen();
        w.setFullScreen(on);
        store.data.settings.fullscreen = on; store.save(); pushLibrary();
        e.preventDefault();
      }
      if (input.key === 'F12' && process.env.HALCYON_DEV) w.webContents.toggleDevTools();
    });
    w.loadFile(path.join(__dirname, '../renderer/index.html'));
    return w;
  }

  /**
   * Put the dashboard in front of whatever is on screen. Desktops (Wayland ones especially)
   * ignore a background window asking for focus, but they do focus a newly opened window.
   * So when asking is not enough, the dashboard is re-opened; it comes back where it was,
   * because the section and focused tile are saved as you move.
   */
  let reopened = false;
  async function bringToFront({ force = false } = {}) {
    if (!win || win.isDestroyed()) return 'none';
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    await new Promise((r) => setTimeout(r, 500));
    if (!win || win.isDestroyed()) return 'none';
    if (win.isFocused() && !force) return 'focused';
    const old = win;
    store.flush();
    reopened = true;                 // the new window skips the start-up animation
    const next = createWindow();
    next.once('ready-to-show', () => { if (!old.isDestroyed()) old.destroy(); });
    return 'reopened';
  }

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // The chosen monitor plugged back in (or turned on): go back to it.
    const replace = () => setTimeout(() => { if (win) placeOnMonitor(win); }, 1500);
    screen.on('display-added', replace);
    screen.on('display-removed', replace);

    // media://local/<encoded absolute path> — serves local artwork, images only.
    // jf://image/<itemId>/<Primary|Backdrop|Thumb>?w=<px>  and  jf://stream/<server path>
    protocol.handle('jf', async (request) => {
      try {
        const u = new URL(request.url);
        let target = null;
        if (u.host === 'image') {
          const [, id, type] = u.pathname.split('/');
          if (!/^[0-9a-f-]{32,36}$/i.test(id || '') || !['Primary', 'Backdrop', 'Thumb', 'Logo'].includes(type)) return new Response('Bad request', { status: 400 });
          const w = Math.min(1920, Math.max(64, Number(u.searchParams.get('w')) || 400));
          target = jellyfin.resolve(`/Items/${id}/Images/${type}?fillWidth=${w}&quality=88`);
        } else if (u.host === 'stream') {
          target = jellyfin.resolve(`${u.pathname}${u.search}`);
        }
        if (!target) return new Response('Not connected', { status: 404 });
        const headers = {};
        const range = request.headers.get('range');
        if (range) headers.Range = range;
        return net.fetch(target, { headers });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });

    protocol.handle('media', (request) => {
      try {
        const file = decodeURIComponent(new URL(request.url).pathname.slice(1));
        if (!path.isAbsolute(file) || !IMAGE_EXT.has(path.extname(file).toLowerCase())) {
          return new Response('Forbidden', { status: 403 });
        }
        return net.fetch(pathToFileURL(file).toString());
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });

    diary.init(app.getPath('userData'));
    store = new JsonStore(path.join(app.getPath('userData'), 'config.json'), DEFAULTS);
    // Earlier versions saved "not fullscreen" whenever the window merely dropped out of
    // fullscreen; put the setting back on once.
    // Shader processing is skipped automatically unless you turn that off (it used to ask).
    if (!store.data.shaderSkipDefaulted) { store.data.settings.steamSkipShaders = true; store.data.shaderSkipDefaulted = true; store.save(); }
    if (!store.data.fullscreenRepaired) { store.data.settings.fullscreen = true; store.data.fullscreenRepaired = true; store.save(); }
    library = new Library(store);
    jellyfin = new Jellyfin(store);
    achievements = new Achievements(store, library, { dir: path.join(app.getPath('userData'), 'achievements'), onChange: () => pushLibrary() });
    retro = new Retro(store, { dir: path.join(app.getPath('userData'), 'retroachievements'), onChange: () => pushLibrary() });
    launcher = new Launcher(library, (event) => {
      diary.log('launch event:', event);
      if (event.type === 'exited' || event.type === 'failed') stopFollowing();
      // New unlocks from the session just ended.
      if (event.type === 'exited' && /^steam:\d+$/.test(event.id || '')) setTimeout(() => achievements && achievements.game(event.id.slice(6), { refresh: true }).catch(() => {}), 8000);
      // After an emulated game, new RetroAchievements unlocks.
      if (event.type === 'exited' && /^emu:/.test(event.id || '')) setTimeout(() => retro && retro.sync().catch(() => {}), 8000);
      send('launch:event', event);
      syncPadWatch();
      if (event.type === 'exited' && !launcher.nowPlaying().some((p) => p.quittable)) closeGameMenu();
      if (event.type === 'started') setTimeout(() => prewarmGuide(), 1500);
      if (event.type === 'exited' && !launcher.nowPlaying().length) setTimeout(dropSpare, 700);
      if (event.type !== 'exited') return;
      // The game is over: put the dashboard back in front, like a console returning home.
      // (Automated runs keep their one window: the test script is attached to it.)
      if (!process.env.HALCYON_DEV_SCRIPT) setTimeout(() => bringToFront().catch(() => {}), 400);
      if (event.source === 'steam') rescan().catch(() => {}); else pushLibrary();
    });
    registerIpc();

    // Scan while the window is being created so the first paint already has games.
    ready = library.scan();
    createWindow();
    await ready;
    checkControllers();
    if (autoArt) setTimeout(() => autoArt(), 3000);
    // Achievement summaries fill in slowly in the background, and again once a day.
    if (!process.env.HALCYON_DRY_RUN) {
      setTimeout(() => achievements.sync().catch(() => {}), 20000);
      setInterval(() => achievements.sync().catch(() => {}), 6 * 3600 * 1000).unref();
      setTimeout(() => retro.sync().catch(() => {}), 30000);
      setInterval(() => retro.sync().catch(() => {}), 3 * 3600 * 1000).unref();
    }
    refreshOwned().catch(() => {});
    syncPadWatch();
    claimHomeButton().catch(() => {});
    const hooks = () => { if (!process.env.HALCYON_DRY_RUN || process.env.HALCYON_STEAM_CEF_PORT) steamClient.installLaunchHooks({ skipShaders: store.data.settings.steamSkipShaders !== false }).catch(() => {}); };
    hooks();
    setInterval(hooks, 20000).unref();   // Steam may start (or restart) after Halcyon
    // Steam may start after Halcyon: try again until it answers.
    setInterval(() => { if ((store.data.settings.homeButtonGuide !== false && !store.data.steamGuideFocusOff) || store.data.steamOverlayOff) claimHomeButton().catch(() => {}); }, 30000).unref();
    setInterval(pollDownloads, Number(process.env.HALCYON_POLL_MS) || 4000).unref();

    let lastBatteries = '';
    const pollBatteries = () => {
      const list = system.batteries();
      const sig = JSON.stringify(list);
      if (sig !== lastBatteries) { lastBatteries = sig; send('system:batteries', list); }
    };
    setInterval(pollBatteries, 30000).unref();

    // Development aid: exercise the re-open path without a game (HALCYON_TEST_REOPEN=<ms>).
    if (process.env.HALCYON_TEST_REOPEN) {
      setTimeout(async () => {
        const before = win.id;
        const how = await bringToFront({ force: true });
        setTimeout(() => {
          console.log(`[reopen] ${how}; window ${before} -> ${win && win.id}; windows open: ${BrowserWindow.getAllWindows().length}; focused: ${win && win.isFocused()}; fullscreen: ${win && win.isFullScreen()}; fullscreen setting: ${store.data.settings.fullscreen}`);
          app.quit();
        }, 2500);
      }, Number(process.env.HALCYON_TEST_REOPEN));
    }

    if (process.env.HALCYON_DEV_SCRIPT) require('./devscript').run(win, process.env.HALCYON_DEV_SCRIPT);
  });

  // Hand Steam its Home button back before going.
  let released = false;
  app.on('before-quit', (e) => {
    padWatch.stop();
    monitorAudio.restoreSync();   // sound back to where it was before Halcyon
    if (store) store.flush();
    if (released || !store || !(store.data.steamGuideFocusOff || store.data.steamOverlayOff)) return;
    e.preventDefault();
    released = true;
    Promise.race([releaseHomeButton(), new Promise((r) => setTimeout(r, 2500))]).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
