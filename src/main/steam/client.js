'use strict';
// Download controls through the Steam client's own interface.
//
// Steam's UI is a web app that manages downloads with SteamClient.Downloads.*
// (pause, resume, queue an update, reorder, remove). Those functions are only
// reachable through Steam's local debugging port, which Steam opens when a
// ".cef-enable-remote-debugging" file exists in its folder (the same mechanism
// Decky Loader uses). The port only listens on this computer. Everything here is
// undocumented Steam internals, so every call fails soft: if Steam changes,
// Halcyon falls back to read-only progress from the app manifests.
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.HALCYON_STEAM_CEF_PORT) || 8080;
const HOST = '127.0.0.1';
const MARKER = '.cef-enable-remote-debugging';

// ------------------------------------------------------------- the switch

// Automated tests point this at a scratch folder so they never touch a real Steam install.
const markerFiles = (installs) => (process.env.HALCYON_STEAM_MARKER_DIR
  ? [path.join(process.env.HALCYON_STEAM_MARKER_DIR, MARKER)]
  : installs.map((i) => path.join(i.root, MARKER)));

function enabled(installs) {
  return (installs.length > 0 || Boolean(process.env.HALCYON_STEAM_MARKER_DIR)) && markerFiles(installs).some((f) => fs.existsSync(f));
}

/** Turn Steam's debugging port on or off for every Steam install. Takes effect when Steam restarts. */
function setEnabled(installs, on) {
  if (!installs.length && !process.env.HALCYON_STEAM_MARKER_DIR) return { ok: false, error: 'Steam is not installed.' };
  try {
    for (const file of markerFiles(installs)) {
      if (on) fs.writeFileSync(file, '');
      else fs.rmSync(file, { force: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not change Steam's settings: ${err.message}` };
  }
}

// -------------------------------------------------------- talking to Steam

/** title: which Steam page to talk to; the shared context by default. */
async function target(title = null) {
  let list;
  try {
    const res = await fetch(`http://${HOST}:${PORT}/json`, { signal: AbortSignal.timeout(1500) });
    list = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  // The shared context is where SteamClient lives; its title has changed over the years.
  const shared = title ? list.find((t) => t.title === title) : list.find((t) => /SharedJSContext|Steam Shared Context/i.test(t.title || ''));
  const pick = shared || (title ? null : list.find((t) => /steamloopback\.host/.test(t.url || '') && t.webSocketDebuggerUrl));
  // Only ever connect back to this computer.
  const url = pick && pick.webSocketDebuggerUrl;
  return url && /^ws:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ? url : null;
}

/** Run one expression in Steam's shared context and return its (JSON) value. */
async function evaluate(expression, timeoutMs = 6000, title = null) {
  const url = await target(title);
  if (!url) throw Object.assign(new Error('Steam is not reachable. Is it running with download controls turned on?'), { offline: true });
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error('Steam did not answer in time.')); }, timeoutMs);
    const done = (fn, value) => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } fn(value); };
    ws.onerror = () => done(reject, Object.assign(new Error('Could not connect to Steam.'), { offline: true }));
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id !== 1) return;
      const r = msg.result || {};
      if (msg.error || r.exceptionDetails) {
        const text = (r.exceptionDetails && (r.exceptionDetails.exception?.description || r.exceptionDetails.text)) || msg.error?.message || 'Steam rejected the request.';
        done(reject, new Error(String(text).split('\n')[0]));
      } else {
        done(resolve, r.result ? r.result.value : undefined);
      }
    };
  });
}

// What Steam's UI reports, read once: register for the callbacks, take the first answer, unregister.
const SNAPSHOT = `(async () => {
  const D = SteamClient.Downloads;
  const once = (register) => new Promise((resolve) => {
    let handle = null;
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; setTimeout(() => { try { handle && handle.unregister && handle.unregister(); } catch (e) {} }, 0); resolve(value); };
    setTimeout(() => finish(null), 1500);
    try { handle = register((...args) => finish(args)); } catch (e) { finish(null); }
  });
  const [ov, it] = await Promise.all([once((cb) => D.RegisterForDownloadOverview(cb)), once((cb) => D.RegisterForDownloadItems(cb))]);
  return { overview: ov ? ov[0] : null, items: it };
})()`;

/** Both callback shapes Steam has used: (busy, [item]) and (busy, [{ remote_client_id, item_data: [item] }]). */
function flattenItems(args) {
  if (!Array.isArray(args)) return null;
  const list = args.find((a) => Array.isArray(a));
  if (!list) return null;
  const local = list.filter((e) => e && Array.isArray(e.item_data));
  if (local.length) {
    const mine = local.find((e) => !e.remote_client_id || String(e.remote_client_id) === '0') || local[0];
    return mine.item_data;
  }
  return list;
}

/** { ok, paused, active: { appid, rate } | null, items: [{ appid, position, paused, active, completed }] } */
async function downloads() {
  try {
    const raw = await evaluate(SNAPSHOT);
    const ov = (raw && raw.overview) || {};
    const items = (flattenItems(raw && raw.items) || [])
      .filter((i) => i && i.appid)
      .map((i) => ({
        appid: String(i.appid),
        position: Number.isFinite(Number(i.queue_index)) ? Number(i.queue_index) : 999,
        paused: Boolean(i.paused),
        active: Boolean(i.active),
        completed: Boolean(i.completed),
        // Steam lists updates it has put off until later with no queue position (and usually a
        // time). A download someone paused also has no position but no time: that's not scheduled.
        scheduled: !i.completed && !i.active && Number(i.queue_index) < 0 && !(i.paused && !Number(i.deferred_time)),
        when: Number(i.deferred_time) || 0,
        finishedAt: Number(i.completed_time) || 0,
        error: i.update_error || '',
      }))
      .sort((a, b) => Number(a.completed) - Number(b.completed) || Number(a.scheduled) - Number(b.scheduled) || a.position - b.position || a.when - b.when);
    return {
      ok: true,
      paused: Boolean(ov.paused),
      active: ov.update_appid ? activeFrom(ov) : null,
      items,
    };
  } catch (err) {
    return { ok: false, offline: Boolean(err.offline), error: err.message };
  }
}

// Every call names the client it is for, as Steam's own interface does: "0" is this
// computer (other ids are remote PCs). Without it some calls are silently ignored.
const LOCAL = '"0"';
/**
 * The download Steam is working on, from its overview. Steam reports the job in stages
 * (allocating, downloading, staging/patching, committing); "downloaded of total" shows
 * the network stage, the percent and time left cover the whole job.
 */
function activeFrom(ov) {
  const stages = Array.isArray(ov.progress) ? ov.progress : [];
  const net = stages[1] && Number(stages[1].bytes_total) > 0 ? stages[1] : null;
  return {
    appid: String(ov.update_appid),
    state: ov.update_state || '',
    percent: Math.max(0, Math.min(100, Number(ov.overall_percent_complete) || 0)),
    eta: Number(ov.overall_estimated_time_remaining_sec),
    rate: Number(ov.update_network_bytes_per_second) || 0,
    disk: Number(ov.update_disc_bytes_per_second) || 0,
    downloaded: net ? Number(net.bytes_in_progress) || 0 : 0,
    toDownload: net ? Number(net.bytes_total) || 0 : 0,
    install: Boolean(ov.update_is_install),
  };
}

const ACTIONS = {
  pause: (id) => `SteamClient.Downloads.PauseAppUpdate(${id}, ${LOCAL})`,
  resume: (id) => `SteamClient.Downloads.ResumeAppUpdate(${id}, ${LOCAL})`,
  update: (id) => `SteamClient.Downloads.QueueAppUpdate(${id}, ${LOCAL})`,
  remove: (id) => `SteamClient.Downloads.RemoveFromDownloadList(${id}, ${LOCAL})`,
  pauseAll: () => `SteamClient.Downloads.EnableAllDownloads(false, ${LOCAL})`,
  resumeAll: () => `SteamClient.Downloads.EnableAllDownloads(true, ${LOCAL})`,
};

/** action: pause | resume | update | remove | move | pauseAll | resumeAll. */
async function control(action, appid, index) {
  const id = Number(appid);
  if (action === 'move') {
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(index) || index < 0) return { ok: false, error: 'Unknown download.' };
    return run(`SteamClient.Downloads.SetQueueIndex(${id}, ${index}, ${LOCAL})`);
  }
  const build = ACTIONS[action];
  if (!build) return { ok: false, error: 'Unknown download action.' };
  if (!action.endsWith('All') && (!Number.isInteger(id) || id <= 0)) return { ok: false, error: 'Unknown download.' };
  return run(build(id));
}

async function run(expression) {
  try {
    await evaluate(`(() => { ${expression}; return true; })()`);
    return { ok: true };
  } catch (err) {
    return { ok: false, offline: Boolean(err.offline), error: err.message };
  }
}

// ------------------------------------------------------- game launches

/**
 * What Steam is doing to start a game, step by step (syncing cloud saves, processing
 * Vulkan shaders, ...): [{ id, appid, action, task, details, done, total }].
 */
async function gameActions() {
  try {
    const list = await evaluate('(async () => JSON.parse(JSON.stringify(await SteamClient.Apps.GetActiveGameActions())))()');
    return { ok: true, actions: (Array.isArray(list) ? list : []).map((a) => ({
      id: Number(a.nGameActionID), appid: String(a.gameid || ''), action: a.strActionName || '', task: a.strTaskName || '', details: a.strTaskDetails || '',
      done: Number(a.numDone ?? a.strNumDone) || 0, total: Number(a.numTotal ?? a.strNumTotal) || 0,
    })) };
  } catch (err) {
    return { ok: false, offline: Boolean(err.offline), error: err.message };
  }
}

/**
 * Start a game the way Steam's own library does (SteamClient.Apps.RunGame). Unlike a
 * steam://rungameid link, this does not bring Steam's window up first.
 */
/**
 * Uninstall a game without Steam's own "are you sure" dialog: this is what Steam's dialog
 * itself calls once you press Uninstall (local client "0", already confirmed). Halcyon asks
 * first, in its own UI.
 */
function uninstallApp(appid) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve({ ok: false, error: 'Unknown game.' });
  return run(`SteamClient.Installs.OpenUninstallWizard([${id}], "0", true)`);
}

/** Steam's library folders: [{ index, path, free, capacity, isDefault, mounted }]. */
async function installFolders() {
  try {
    const list = await evaluate(`SteamClient.InstallFolder.GetInstallFolders().then((f) => f.map((x) => ({
      index: x.nFolderIndex, path: x.strFolderPath, label: x.strUserLabel || '', drive: x.strDriveName || '',
      free: Number(x.nFreeSpace) || 0, capacity: Number(x.nCapacity) || 0, isDefault: Boolean(x.bIsDefaultFolder), mounted: x.bIsMounted !== false,
    })))`, 8000);
    return { ok: true, folders: list || [] };
  } catch (err) { return { ok: false, error: err.message }; }
}

/**
 * Install a game into a library folder the way Steam's install dialog does, without the dialog:
 * open Steam's install wizard, and when it asks where (ShowConfig), pick the folder, check it
 * fits and continue. Anything that needs the person (a licence agreement, a CD key, a password)
 * is left to Steam's own dialog. With cancel: true it stops at the question (for checking).
 */
async function installApp(appid, folderIndex = null, { cancel = false } = {}) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Unknown game.' };
  const folder = Number.isInteger(folderIndex) ? folderIndex : null;
  const script = `(async () => {
    const appid = ${id}, folder = ${folder === null ? 'null' : folder}, cancelOnly = ${cancel ? 'true' : 'false'};
    const I = SteamClient.Installs;
    return await new Promise((resolve) => {
      let handle = null, done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => { try { handle && handle.unregister(); } catch (e) {} }, 0); resolve(v); };
      const timer = setTimeout(() => finish({ ok: false, error: 'Steam did not start the install.' }), 20000);
      handle = I.RegisterForShowInstallWizard(async (s) => {
        try {
          const st = s.eInstallState;
          if (st === 7) {                                   // ShowConfig: where to install
            let now = s;
            if (folder !== null && s.bCanChangeInstallFolder && s.iInstallFolder !== folder) now = (await I.SetInstallFolder(folder)) || s;
            const info = { required: Number(now.nDiskSpaceRequired) || 0, available: Number(now.nDiskSpaceAvailable) || 0, folder: now.iInstallFolder };
            if (cancelOnly) { await I.CancelInstall(); finish({ ok: true, cancelled: true, ...info }); return; }
            if (info.required && info.available && info.required >= info.available) { await I.CancelInstall(); finish({ ok: false, full: true, ...info, error: 'Not enough space in that folder.' }); return; }
            await I.ContinueInstall();
            finish({ ok: true, started: true, ...info });
          } else if (st === 8) {                            // licence agreements: Steam's dialog asks
            finish({ ok: true, steamAsks: 'eula' });
          } else if (st === 4 || st === 6 || st === 11 || st === 13) {   // CD key, password, media, sign-up
            finish({ ok: true, steamAsks: 'other' });
          }
        } catch (e) { finish({ ok: false, error: String(e && e.message || e) }); }
      });
      I.OpenInstallWizard([appid], "0");
    });
  })()`;
  try { return await evaluate(script, 25000); } catch (err) { return { ok: false, error: err.message }; }
}

/** Ask Steam to close a running game (as its own library's Stop button does). */
function terminateApp(appid) {
  const id = String(appid);
  if (!/^\d+$/.test(id)) return Promise.resolve({ ok: false, error: 'Unknown game.' });
  return run(`SteamClient.Apps.TerminateApp(${JSON.stringify(id)}, false)`);
}

function runGame(appid) {
  const id = String(appid);
  if (!/^\d+$/.test(id)) return Promise.resolve({ ok: false, error: 'Unknown game.' });
  // Launch option 0, the game's default: -1 would make Steam ask with a dialog of its own.
  return run(`SteamClient.Apps.RunGame(${JSON.stringify(id)}, "", 0, 100)`);
}

/**
 * A listener that lives inside Steam and answers its launch prompts the moment they come,
 * before any dialog can show: "Processing Vulkan shaders" is skipped when skipShaders is on.
 * Installed once per Steam session (it survives until Steam restarts); calling again only
 * updates the switch.
 */
function installLaunchHooks({ skipShaders: skip }) {
  return run(`(() => {
    const h = window.__halcyon = window.__halcyon || {};
    h.skipShaders = ${skip ? 'true' : 'false'};
    // Steam's in-game overlay also answers the Home button. Halcyon marks each Home press it
    // handles; an overlay that opens within that moment is put away again at once. Opening it
    // any other way (Shift+Tab) is left alone.
    if (h.overlay && h.overlayVersion !== 2) { try { h.overlay.unregister(); } catch (e) { /* old listener */ } h.overlay = null; }
    if (!h.overlay) {
      h.overlayVersion = 2;
      h.overlay = SteamClient.Overlay.RegisterForOverlayActivated((a, b, active, d) => {
        try {
          h.lastOverlay = [a, b, active, d];
          if (active && Date.now() < (h.blockOverlayUntil || 0)) {
            h.blocked = (h.blocked || 0) + 1;
            // Straight away, and once more a frame later in case Steam was still opening it.
            const hide = () => { for (const id of [b, a]) { try { SteamClient.Overlay.SetOverlayState(String(id), 0); } catch (e) { h.error = String(e); } } };
            hide();
            setTimeout(hide, 16);
          }
        } catch (e) { h.error = String(e); }
      });
    }
    // Achievements as Steam hears of them, queued for Halcyon to collect (takeAchievements).
    if (!h.achievements) {
      h.achQueue = h.achQueue || [];
      h.achievements = SteamClient.GameSessions.RegisterForAchievementNotification((n) => {
        try {
          if (!n || !n.unAppID || !n.achievement || !n.achievement.bAchieved) return;
          h.achQueue.push({ appid: n.unAppID, a: n.achievement, at: Date.now() });
          if (h.achQueue.length > 50) h.achQueue.splice(0, h.achQueue.length - 50);
        } catch (e) { h.error = String(e); }
      });
    }
    if (!h.userRequest) {
      h.userRequest = SteamClient.Apps.RegisterForGameActionUserRequest((actionId, gameId, action, request) => {
        try {
          if (action === 'LaunchApp' && request === 'ProcessingShaderCache' && h.skipShaders) {
            h.skipped = (h.skipped || 0) + 1;
            setTimeout(() => SteamClient.Apps.ContinueGameAction(actionId, 'SkipShaders'), 30);
          }
        } catch (e) { h.error = String(e); }
      });
    }
  })()`);
}

/** Achievements Steam has reported since the last call: [{ appid, a: Steam's achievement, at }]. */
async function takeAchievements() {
  try {
    const list = await evaluate('(() => { const h = window.__halcyon || {}; const q = h.achQueue || []; h.achQueue = []; return q; })()', 3000);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** Halcyon is handling a Home press: keep Steam's overlay from opening for the next ms. */
function blockOverlayFor(ms) {
  return run(`(() => { const h = window.__halcyon = window.__halcyon || {}; h.blockOverlayUntil = Date.now() + ${Math.max(0, Math.min(5000, Number(ms) || 0))}; })()`);
}

/** How many shader steps the in-Steam listener has skipped since Steam started (for checks). */
async function launchHookStatus() {
  try {
    const v = await evaluate('(() => { const h = window.__halcyon || {}; return { installed: Boolean(h.userRequest), overlayWatch: Boolean(h.overlay), skipShaders: Boolean(h.skipShaders), skipped: h.skipped || 0, overlaysBlocked: h.blocked || 0, lastOverlay: h.lastOverlay || null, error: h.error || null }; })()');
    return { ok: true, ...v };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Put Steam's main window away (as closing it to the tray does), if it is up. */
async function hideMainWindow() {
  try {
    await evaluate('(() => { SteamClient.Window.HideWindow(); return true; })()', 3000, 'Steam');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Press Steam's "Skip" on the shader-processing step of a launch (what its own button does). */
function skipShaders(actionId) {
  const id = Number(actionId);
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve({ ok: false, error: 'No launch to skip.' });
  return run(`SteamClient.Apps.ContinueGameAction(${id}, "SkipShaders")`);
}

// ---------------------------------------------- the Home button and Steam

// Steam's "Guide button focuses Steam" lives in its client settings
// (controller_guide_button_focus_steam, field 14002 of CMsgClientSettings). Steam's own
// settings page writes it with SteamClient.Settings.SetSetting(<protobuf, base64>).
const GUIDE_FOCUS_FIELD = 14002;

function varint(n) {
  const out = [];
  let v = n;
  while (v > 127) { out.push((v & 127) | 128); v = Math.floor(v / 128); }
  out.push(v);
  return out;
}

/** The base64 protobuf Steam expects for one boolean client setting. */
function boolSetting(field, on) {
  return Buffer.from([...varint(field * 8), on ? 1 : 0]).toString('base64');
}

const ENABLE_OVERLAY_FIELD = 4004;

/** Turn Steam's in-game overlay on or off (applies to games started afterwards). */
function setInGameOverlay(on) {
  return run(`SteamClient.Settings.SetSetting(${JSON.stringify(boolSetting(ENABLE_OVERLAY_FIELD, on))})`);
}

/**
 * Leave Big Picture without Steam's desktop window popping up over the game:
 * switch Steam back to desktop mode, then hide its main window again.
 */
async function leaveBigPicture() {
  const left = await run('SteamClient.UI.ExitBigPictureMode()');
  if (!left.ok) return left;
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await evaluate('(() => { SteamClient.Window.HideWindow(); return true; })()', 3000, 'Steam');
      return { ok: true };
    } catch { /* the desktop window is not up yet */ }
  }
  return { ok: true, windowLeft: true };
}

/** Turn Steam's "Guide button focuses Steam" on or off. */
function setGuideFocusesSteam(on) {
  return run(`SteamClient.Settings.SetSetting(${JSON.stringify(boolSetting(GUIDE_FOCUS_FIELD, on))})`);
}

module.exports = { evaluate, enabled, setEnabled, downloads, control, flattenItems, activeFrom, setGuideFocusesSteam, setInGameOverlay, leaveBigPicture, gameActions, skipShaders, runGame, terminateApp, uninstallApp, installApp, installFolders, hideMainWindow, installLaunchHooks, launchHookStatus, blockOverlayFor, takeAchievements, boolSetting, PORT };
