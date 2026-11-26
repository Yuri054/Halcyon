'use strict';
// Steam integration: locate installs (native, Flatpak, Snap), walk their library
// folders, read installed app manifests, playtime and cached artwork.
const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');
const { HOME, expandHome, isDir, realpath, which, flatpakInstalled, mediaUrl, uniqueBy } = require('../util');

const FLATPAK_ID = 'com.valvesoftware.Steam';

// Runtimes, redistributables and compatibility tools that live beside games.
const TOOL_APPIDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '1826330', '3658110']);
const TOOL_NAME = /^(Proton\b|Steam Linux Runtime|Steamworks Common|Steam Controller Configs|SteamVR$)/i;

function findInstalls(extraRoots = []) {
  const candidates = [
    { kind: 'native', root: path.join(HOME, '.local/share/Steam') },
    { kind: 'native', root: path.join(HOME, '.steam/steam') },
    { kind: 'native', root: path.join(HOME, '.steam/root') },
    { kind: 'native', root: path.join(HOME, '.steam/debian-installation') },
    { kind: 'flatpak', root: path.join(HOME, '.var/app', FLATPAK_ID, '.local/share/Steam') },
    { kind: 'flatpak', root: path.join(HOME, '.var/app', FLATPAK_ID, 'data/Steam') },
    { kind: 'snap', root: path.join(HOME, 'snap/steam/common/.local/share/Steam') },
    ...extraRoots.map((root) => ({ kind: 'custom', root: expandHome(root) })),
  ];
  const valid = candidates
    .filter((c) => isDir(path.join(c.root, 'steamapps')))
    .map((c) => ({ ...c, real: realpath(c.root) }));
  return uniqueBy(valid, (c) => c.real);
}

function libraryPaths(install) {
  const paths = [install.root];
  try {
    const data = vdf.parse(fs.readFileSync(path.join(install.root, 'steamapps/libraryfolders.vdf'), 'utf8'));
    const folders = vdf.get(data, 'libraryfolders') || {};
    for (const entry of Object.values(folders)) {
      if (typeof entry === 'string') paths.push(entry);
      else if (entry && entry.path) paths.push(entry.path);
    }
  } catch { /* a missing libraryfolders.vdf just means a single library */ }
  return uniqueBy(paths.filter((p) => isDir(path.join(p, 'steamapps'))), (p) => realpath(p));
}

function userIds(install) {
  try {
    return fs.readdirSync(path.join(install.root, 'userdata')).filter((d) => /^\d+$/.test(d) && d !== '0');
  } catch { return []; }
}

/** appid -> { playtimeMin, lastPlayed } merged across local Steam accounts. */
function readPlaytime(install, users) {
  const stats = new Map();
  for (const uid of users) {
    try {
      const data = vdf.parse(fs.readFileSync(path.join(install.root, 'userdata', uid, 'config/localconfig.vdf'), 'utf8'));
      const apps = vdf.get(data, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') || {};
      for (const [appid, info] of Object.entries(apps)) {
        if (!info || typeof info !== 'object') continue;
        const prev = stats.get(appid) || { playtimeMin: 0, lastPlayed: 0 };
        stats.set(appid, {
          playtimeMin: Math.max(prev.playtimeMin, Number(vdf.get(info, 'Playtime')) || 0),
          lastPlayed: Math.max(prev.lastPlayed, Number(vdf.get(info, 'LastPlayed')) || 0),
        });
      }
    } catch { /* unreadable account config: skip */ }
  }
  return stats;
}

const ART_FILES = {
  cover: ['library_600x900.jpg', 'library_600x900_2x.jpg', 'library_capsule.jpg', 'library_600x900.png'],
  hero: ['library_hero.jpg', 'library_hero.png'],
  logo: ['logo.png'],
  header: ['header.jpg', 'library_header.jpg'],
};

function findArt(install, users, appid, remote) {
  const found = { cover: [], hero: [], logo: [], header: [] };

  // User-set custom artwork from the Steam client takes priority.
  for (const uid of users) {
    const grid = path.join(install.root, 'userdata', uid, 'config/grid');
    for (const [kind, stem] of [['cover', `${appid}p`], ['hero', `${appid}_hero`], ['logo', `${appid}_logo`], ['header', appid]]) {
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
        const file = path.join(grid, stem + ext);
        if (fs.existsSync(file)) found[kind].push(file);
      }
    }
  }

  const cache = path.join(install.root, 'appcache/librarycache');
  const byName = new Map();
  const dir = path.join(cache, appid);
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) byName.set(entry.name, path.join(dir, entry.name));
    }
    // Newer clients nest each asset in a content-hash folder.
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(dir, entry.name))) {
        if (!byName.has(name)) byName.set(name, path.join(dir, entry.name, name));
      }
    }
  } catch { /* no per-app cache folder */ }
  for (const [kind, names] of Object.entries(ART_FILES)) {
    for (const name of names) {
      if (byName.has(name)) found[kind].push(byName.get(name));
      const flat = path.join(cache, `${appid}_${name}`); // legacy flat layout
      if (fs.existsSync(flat)) found[kind].push(flat);
    }
  }

  const art = {
    cover: found.cover.map(mediaUrl),
    hero: found.hero.map(mediaUrl),
    logo: found.logo.map(mediaUrl),
    header: found.header.map(mediaUrl),
  };
  if (remote) {
    const cdn = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}`;
    art.cover.push(`${cdn}/library_600x900.jpg`);
    art.hero.push(`${cdn}/library_hero.jpg`);
    art.header.push(`${cdn}/header.jpg`);
  }
  // A landscape header is still better than a blank portrait tile, and vice versa.
  art.cover.push(...art.header);
  art.hero.push(...art.header);
  return art;
}

/**
 * What Steam is doing with an app that is not ready to play, from its manifest.
 * StateFlags bits: 4 installed, 512 paused, 256/1024 update running, 1048576 downloading.
 */
function downloadState(state) {
  const flags = Number(state.StateFlags) || 0;
  if (flags === 4) return null;
  const total = Number(state.BytesToDownload) || 0;
  const done = Math.min(Number(state.BytesDownloaded) || 0, total);
  const stageTotal = Number(state.BytesToStage) || 0;
  const staged = Math.min(Number(state.BytesStaged) || 0, stageTotal);
  let phase = 'queued';
  if (flags & 512) phase = 'paused';
  else if (total && done >= total) phase = 'installing';
  else if (done > 0 || flags & (256 | 1048576)) phase = 'downloading';
  const percent = phase === 'installing'
    ? (stageTotal ? Math.floor((staged / stageTotal) * 100) : 100)
    : (total ? Math.floor((done / total) * 100) : 0);
  return { phase, percent, done, total, update: Boolean(flags & 4) || Number(state.LastUpdated) > 0 };
}

/** Cheap pass over the manifests only: [{ appid, download }]. Used to follow downloads live. */
function manifests(extraRoots = []) {
  const out = new Map();
  for (const install of findInstalls(extraRoots)) {
    for (const lib of libraryPaths(install)) {
      let files = [];
      try { files = fs.readdirSync(path.join(lib, 'steamapps')); } catch { continue; }
      for (const file of files) {
        const m = /^appmanifest_(\d+)\.acf$/.exec(file);
        if (!m || out.has(m[1])) continue;
        try {
          const state = vdf.get(vdf.parse(fs.readFileSync(path.join(lib, 'steamapps', file), 'utf8')), 'AppState');
          if (state) out.set(m[1], { appid: m[1], download: downloadState(state) });
        } catch { /* being rewritten by Steam right now: catch it on the next pass */ }
      }
    }
  }
  return [...out.values()];
}

/** The Steam account signed in most recently: { steamid, name, avatar (a local file or null) }. */
function profile(extraRoots = []) {
  for (const install of findInstalls(extraRoots)) {
    try {
      const users = vdf.get(vdf.parse(fs.readFileSync(path.join(install.root, 'config/loginusers.vdf'), 'utf8')), 'users') || {};
      const entries = Object.entries(users);
      const [steamid, u] = entries.find(([, x]) => String(x.MostRecent) === '1') || entries[0] || [];
      if (!steamid) continue;
      const avatar = path.join(install.root, 'config/avatarcache', `${steamid}.png`);
      return { steamid, name: u.PersonaName || u.AccountName || '', avatar: fs.existsSync(avatar) ? avatar : null };
    } catch { /* no login file here */ }
  }
  return null;
}

/** SteamID64 of each account that has signed in to this Steam install. */
function accountIds(extraRoots = []) {
  const ids = new Set();
  for (const install of findInstalls(extraRoots)) {
    for (const uid of userIds(install)) ids.add((BigInt(uid) + 76561197960265728n).toString());
  }
  return [...ids];
}

/** Library entries for owned games that are not installed, with whatever art Steam has cached. */
function uninstalledGames(owned, installedIds, { extraRoots = [], remoteArt = true } = {}) {
  const install = findInstalls(extraRoots)[0];
  if (!install) return [];
  const users = userIds(install);
  return owned
    .filter((g) => !installedIds.has(g.appid) && !TOOL_APPIDS.has(g.appid) && !TOOL_NAME.test(g.name))
    .map((g) => ({
      id: `steam:${g.appid}`,
      source: 'steam',
      platform: 'Steam',
      name: g.name,
      installed: false,
      art: findArt(install, users, g.appid, remoteArt),
      sizeBytes: 0,
      lastPlayed: g.lastPlayed || 0,
      playtimeMin: g.playtimeMin || 0,
      status: null,
      download: null,
      detail: 'Not installed',
      launch: { type: 'steam', appid: g.appid, kind: install.kind, root: install.root, install: true },
    }));
}

function scan({ extraRoots = [], remoteArt = true } = {}) {
  const installs = findInstalls(extraRoots);
  const games = new Map();
  const report = [];

  for (const install of installs) {
    const users = userIds(install);
    const playtime = readPlaytime(install, users);
    const libraries = libraryPaths(install);
    let count = 0;

    for (const lib of libraries) {
      let files = [];
      try { files = fs.readdirSync(path.join(lib, 'steamapps')); } catch { continue; }
      for (const file of files) {
        const m = /^appmanifest_(\d+)\.acf$/.exec(file);
        if (!m) continue;
        try {
          const state = vdf.get(vdf.parse(fs.readFileSync(path.join(lib, 'steamapps', file), 'utf8')), 'AppState');
          if (!state) continue;
          const appid = String(state.appid || m[1]);
          const name = state.name || `App ${appid}`;
          if (TOOL_APPIDS.has(appid) || TOOL_NAME.test(name) || games.has(appid)) continue;
          const stats = playtime.get(appid) || {};
          games.set(appid, {
            id: `steam:${appid}`,
            source: 'steam',
            platform: 'Steam',
            name,
            art: findArt(install, users, appid, remoteArt),
            sizeBytes: Number(state.SizeOnDisk) || 0,
            lastPlayed: Math.max(Number(state.LastPlayed) || 0, stats.lastPlayed || 0),
            playtimeMin: stats.playtimeMin || 0,
            status: null,
            installed: true,
            download: downloadState(state),
            detail: path.join(lib, 'steamapps/common', state.installdir || ''),
            launch: { type: 'steam', appid, kind: install.kind, root: install.root },
          });
          count++;
        } catch { /* malformed manifest: skip this app */ }
      }
    }
    report.push({ kind: install.kind, root: install.root, libraries, gameCount: count });
  }

  return { installs: report, games: [...games.values()] };
}

/** Build the argv that asks the right Steam client to run a URL like steam://rungameid/N. */
function clientCommand(kind, root, url) {
  if (kind === 'flatpak' && flatpakInstalled(FLATPAK_ID)) return ['flatpak', 'run', FLATPAK_ID, url];
  if (kind === 'snap' && which('snap')) return ['snap', 'run', 'steam', url];
  const steam = which('steam');
  if (steam) return [steam, url];
  const script = path.join(root || '', 'steam.sh');
  if (root && fs.existsSync(script)) return [script, url];
  if (flatpakInstalled(FLATPAK_ID)) return ['flatpak', 'run', FLATPAK_ID, url];
  if (which('xdg-open')) return ['xdg-open', url];
  return null;
}

module.exports = { scan, clientCommand, findInstalls, manifests, accountIds, uninstalledGames, downloadState, profile };
