'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);
const VIDEO_EXT = new Set(['.webm', '.mp4', '.mkv', '.mov', '.ogv']);

const expandHome = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function realpath(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

/** Look a bare command name up in PATH; absolute/relative paths are checked directly. */
function which(cmd) {
  if (!cmd) return null;
  if (cmd.includes('/')) {
    const abs = path.resolve(expandHome(cmd));
    return isExecutableFile(abs) ? abs : null;
  }
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    if (isExecutableFile(full)) return full;
  }
  return null;
}

function flatpakInstalled(appId) {
  return [
    '/var/lib/flatpak/app',
    path.join(HOME, '.local/share/flatpak/app'),
  ].some((root) => isDir(path.join(root, appId)));
}

/** Shell-like argument splitting with quote support (no expansion). */
function splitArgs(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < str.length) cur += str[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (c === '\\' && i + 1 < str.length) { cur += str[++i]; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

const mediaUrl = (file) => `media://local/${encodeURIComponent(file)}`;

function uniqueBy(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const k = keyFn(item);
    if (k == null || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = {
  VIDEO_EXT,
  HOME, IMAGE_EXT, expandHome, exists, isDir, isExecutableFile, realpath,
  which, flatpakInstalled, splitArgs, mediaUrl, uniqueBy,
};
