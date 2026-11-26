'use strict';
// PC ports and recompilations: games that aren't on Steam and don't need an emulator (decomp
// ports like Dusklight, N64 recomps, and so on).
//
// Quiver Launcher installs these as AppImages and keeps a list of them: apps.json next to its
// own AppImage (by default ~/AppImages), each app in Apps/<folderName>. Halcyon reads that list,
// so anything installed through Quiver shows up here by itself and starts straight from its
// AppImage.
//
// For anything installed some other way, gameApps() lists the desktop's installed apps that
// call themselves games (.desktop files with Categories=Game), so one can be added in one pick.
const fs = require('fs');
const path = require('path');
const { HOME, expandHome, isDir } = require('./util');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Where Quiver keeps its list: folders holding apps.json (with Quiver's settings beside it). */
function quiverHomes(extra = []) {
  const candidates = [...extra, path.join(HOME, 'AppImages'), path.join(HOME, 'Applications'), path.join(HOME, '.local/share/QuiverLauncher')];
  return [...new Set(candidates.map(expandHome))].filter((dir) => fs.existsSync(path.join(dir, 'apps.json')));
}

/** The program to start in an app's folder: its AppImage (newest), else a lone executable. */
function entryPoint(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }); } catch { return null; }
  const newest = (list) => list.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  const appimages = files.filter((f) => /\.appimage$/i.test(f));
  if (appimages.length) return newest(appimages);
  const exes = files.filter((f) => { try { return (fs.statSync(f).mode & 0o111) && !/\.(so|log|txt|json|cfg|ini|sh)$/i.test(f); } catch { return false; } });
  return newest(exes);
}

/** Games Quiver Launcher has installed. */
function quiverGames(extraHomes = []) {
  const games = [];
  for (const home of quiverHomes(extraHomes)) {
    const list = readJson(path.join(home, 'apps.json'));
    const settings = readJson(path.join(home, 'settings.json')) || {};
    const appsDir = settings.AppsPath ? expandHome(settings.AppsPath) : path.join(home, 'Apps');
    const names = settings.UserAppDisplayNames || {};
    for (const a of (list && list.apps) || []) {
      if (!a || !a.folderName) continue;
      const dir = a.installPath ? expandHome(a.installPath) : path.join(appsDir, a.folderName);
      const exe = isDir(dir) ? entryPoint(dir) : null;
      let size = 0;
      try { for (const f of fs.readdirSync(dir)) { try { size += fs.statSync(path.join(dir, f)).size; } catch { /* skip */ } } } catch { /* not there */ }
      const tags = (a.tags || []).map((t) => String(t).toLowerCase());
      games.push({
        id: `port:${slug(a.folderName)}`,
        source: 'port',
        platform: a.project ? `${a.project} · PC port` : 'PC port',
        name: names[a.folderName] || a.name || a.project || a.folderName,
        art: { cover: [], hero: [], logo: [], header: [], icon: a.appIconUrl ? [a.appIconUrl] : [] },
        sizeBytes: size,
        lastPlayed: 0, playtimeMin: 0,
        status: exe ? null : 'Not installed yet: install it in Quiver Launcher',
        installed: Boolean(exe),
        detail: exe || dir,
        tags,
        via: 'Quiver Launcher',
        repository: a.repository || '',
        controllerHint: tags.includes('controller support') ? 'full' : null,
        launch: { type: 'port', exe, cwd: dir },
      });
    }
  }
  return games;
}

// ------------------------------------------------------------ desktop apps

function desktopDirs() {
  const data = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [...new Set([path.join(HOME, '.local/share'), path.join(HOME, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share', ...data])]
    .map((d) => path.join(d, 'applications')).filter(isDir);
}

function parseDesktop(file) {
  const out = {};
  let inMain = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\[.*\]$/.test(line.trim())) { inMain = line.trim() === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const m = /^([A-Za-z0-9-]+)=(.*)$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Installed apps that call themselves games, for "Add a game". Leaves out Steam's own game
 * shortcuts (Halcyon has those already), Steam and emulators, and anything hidden.
 * known: commands already in the library, so they aren't offered twice.
 */
function gameApps(known = [], knownNames = []) {
  const names = knownNames.map((n) => n.toLowerCase());
  const seen = new Set();
  const apps = [];
  for (const dir of desktopDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      let d;
      try { d = parseDesktop(path.join(dir, f)); } catch { continue; }
      if (d.Type !== 'Application' || d.NoDisplay === 'true' || d.Hidden === 'true' || !d.Exec) continue;
      const cats = (d.Categories || '').split(';');
      if (!cats.includes('Game')) continue;
      // Steam (Halcyon has its games already), Halcyon itself and emulators aren't games to add.
      if (/steam:\/\/|valvesoftware\.Steam|steam-big-picture|\bsteam\b.*-applaunch/i.test(d.Exec) || /^halcyon$/i.test(d.Name || '') || cats.includes('Emulator')) continue;
      const command = d.Exec.replace(/\s+%[fFuUdDnNickvm]/g, '').replace(/\s+--file-forwarding\b/g, '').replace(/\s+@@[a-z]?(\s|$)/g, ' ').replace(/\s+--\s*$/, '').replace(/\s+/g, ' ').trim();
      if (known.some((k) => k && command.includes(k))) continue;
      if (names.includes(String(d.Name || '').toLowerCase())) continue;   // already here (e.g. through Quiver)
      apps.push({ file: path.join(dir, f), name: d.Name || f.replace(/\.desktop$/, ''), comment: d.Comment || '', command, icon: d.Icon || '' });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { quiverGames, quiverHomes, gameApps };
