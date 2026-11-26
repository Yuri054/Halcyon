'use strict';
// Small JSON persistence layer: defaults merge, debounced atomic writes,
// and quarantine of corrupt files instead of crashing on them.
const fs = require('fs');
const path = require('path');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeDefaults(defaults, data) {
  if (!isObj(defaults)) return data === undefined ? defaults : data;
  const out = { ...(isObj(data) ? data : {}) };
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined) out[k] = structuredClone(v);
    else if (isObj(v)) out[k] = mergeDefaults(v, out[k]);
    else if (Array.isArray(v) && !Array.isArray(out[k])) out[k] = structuredClone(v);
  }
  return out;
}

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.timer = null;
    this.data = this.load(defaults);
  }

  load(defaults) {
    try {
      return mergeDefaults(defaults, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      }
      return structuredClone(defaults);
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      // Owner-only: the file can hold an API key.
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] failed to write', this.file, err.message);
    }
  }
}

const DEFAULTS = {
  settings: {
    fullscreen: true,
    accent: 'emerald',
    sounds: true,
    remoteArt: true,
    showHidden: false,
    minimizeOnLaunch: false,
    sort: 'recent',
    bootAnimation: true,
    dimWhenIdle: true,
    controllerOnly: false,
    theme: 'halcyon',
    showUninstalled: true,
    steamBigPicture: false,   // for the store and installs only
    steamSkipShaders: true,   // skip Steam's "Processing Vulkan shaders" step without asking
    homeButtonGuide: true,   // Home opens Halcyon's Guide anywhere, and Steam is told to leave it alone
    soundPack: '',     // folder name under <config>/sounds, or '' for the built-in tones
  },
  steam: { extraRoots: [] },
  emulators: {},   // id -> { path, args }
  systems: {},     // id -> { emulator, romDirs: [], core }
  romRoots: [],
  customGames: [], // { id, name, command, cwd, cover, background }
  collections: [], // { id, name }
  games: {},       // gameId -> { favorite, hidden, collections, cover, background, name, lastPlayed, playCount }
  steamMeta: {},   // appid -> { controller: 'full' | 'partial' | 'none' | 'unknown' }
  installed: {},   // emulator id -> { file, tag, repo } for builds Halcyon downloaded
  scraped: {},     // gameId -> { cover, background } downloaded artwork
  secrets: { sgdbKey: '', steamKey: '' },
  steamOverlayOff: false,   // likewise for Steam's in-game overlay
  steamGuideFocusOff: false, // Halcyon turned off Steam's "Guide button focuses Steam" and owes it back
  steamOwned: { at: 0, games: [] }, // what the Steam Web API last said the account owns
  ui: { section: 'home', filter: 'all', focus: {} },
};

module.exports = { JsonStore, DEFAULTS };
