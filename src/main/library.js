'use strict';
// Game discovery orchestration: merges Steam, emulator and custom sources
// and layers the user's per-game overrides on top.
const crypto = require('crypto');
const fs = require('fs');
const steam = require('./steam/steam');
const steamStore = require('./steam/store');
const steamApi = require('./steam/webapi');
const emulators = require('./emulators/emulators');
const ports = require('./ports');
const { mediaUrl, expandHome, exists, splitArgs, which } = require('./util');

class Library {
  constructor(store) {
    this.store = store;
    this.raw = { steam: { installs: [], games: [] }, emu: { games: [], systems: [], emulators: [], romRoots: [] }, ports: [] };
    this.index = new Map();
    this.ignoredManifests = new Set(); // tools and runtimes that never become library entries
  }

  get config() { return this.store.data; }

  async scan() {
    const cfg = this.config;
    try {
      this.raw.steam = steam.scan({ extraRoots: cfg.steam.extraRoots, remoteArt: cfg.settings.remoteArt });
      const kept = new Set(this.raw.steam.games.map((g) => g.id.slice(6)));
      this.ignoredManifests = new Set(steam.manifests(cfg.steam.extraRoots).map((m) => m.appid).filter((id) => !kept.has(id)));
    } catch (err) {
      console.error('[library] steam scan failed:', err);
      this.raw.steam = { installs: [], games: [], error: err.message };
    }
    this.addUninstalled();
    try {
      this.raw.emu = await emulators.scan(cfg);
    } catch (err) {
      console.error('[library] emulator scan failed:', err);
      this.raw.emu = { games: [], systems: [], emulators: [], romRoots: [], error: err.message };
    }
    try {
      this.raw.ports = ports.quiverGames((cfg.ports && cfg.ports.quiverHomes) || []);
    } catch (err) {
      console.error('[library] PC port scan failed:', err);
      this.raw.ports = [];
    }
    return this.snapshot();
  }

  /** Append owned-but-not-installed Steam games from the last Web API answer. */
  addUninstalled() {
    const cfg = this.config;
    this.raw.steam.games = this.raw.steam.games.filter((g) => g.installed !== false);
    const owned = (cfg.steamOwned && cfg.steamOwned.games) || [];
    if (!owned.length || cfg.settings.showUninstalled === false) return;
    try {
      const installed = new Set(this.raw.steam.games.map((g) => g.id.slice(6)));
      this.raw.steam.games.push(...steam.uninstalledGames(owned, installed, { extraRoots: cfg.steam.extraRoots, remoteArt: cfg.settings.remoteArt }));
    } catch (err) {
      console.error('[library] could not list uninstalled Steam games:', err);
    }
  }

  /** Ask Steam which games the local account(s) own. Pass a key to try one before saving it. */
  async refreshOwned(tryKey = null) {
    const key = tryKey || this.config.secrets.steamKey;
    if (!key) return { ok: false, error: 'Add your Steam Web API key under Settings first.' };
    const ids = steam.accountIds(this.config.steam.extraRoots);
    if (!ids.length) return { ok: false, error: 'No signed-in Steam account was found on this computer.' };
    const games = new Map();
    for (const id of ids) {
      const res = await steamApi.ownedGames(key, id);
      if (!res.ok) return res;
      for (const g of res.games) games.set(g.appid, g);
    }
    this.config.steamOwned = { at: Date.now(), games: [...games.values()] };
    this.store.save();
    this.addUninstalled();
    return { ok: true, count: games.size };
  }

  /** Fold fresh manifest states into the scanned games. Returns 'none' | 'changed' | 'rescan'. */
  applyManifests(list) {
    const installed = this.raw.steam.games.filter((g) => g.installed !== false);
    const known = new Map(installed.map((g) => [g.id.slice(6), g]));
    const seen = new Set(list.map((m) => m.appid));
    let changed = 'none';
    for (const m of list) {
      const g = known.get(m.appid);
      // A new manifest (install began) or a finished one needs sizes, art and paths re-read.
      if (!g) { if (!this.ignoredManifests.has(m.appid)) return 'rescan'; continue; }
      if (Boolean(g.download) !== Boolean(m.download) && !m.download) return 'rescan';
      if (JSON.stringify(g.download) !== JSON.stringify(m.download)) { g.download = m.download; changed = 'changed'; }
    }
    for (const appid of known.keys()) if (!seen.has(appid)) return 'rescan'; // uninstalled
    return changed;
  }

  customGames() {
    return this.config.customGames.map((c) => {
      const first = splitArgs(c.command || '').find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
      const status = !c.command ? 'No launch command set'
        : first && !which(first) && !exists(expandHome(first)) ? `Command not found: ${first}` : null;
      return {
        id: c.id, source: 'custom', platform: 'Custom', name: c.name || 'Untitled',
        art: { cover: c.cover ? [mediaUrl(c.cover)] : [], hero: c.background ? [mediaUrl(c.background)] : [], logo: [], header: [] },
        sizeBytes: 0, lastPlayed: 0, playtimeMin: 0, status, detail: c.command,
        launch: { type: 'custom', command: c.command, cwd: c.cwd },
        custom: { name: c.name, command: c.command, cwd: c.cwd || '', cover: c.cover || '', background: c.background || '' },
      };
    });
  }

  /** The renderer-facing view of everything. */
  snapshot() {
    const cfg = this.config;
    const validCollections = new Set(cfg.collections.map((c) => c.id));
    const all = [...this.raw.steam.games, ...this.raw.emu.games, ...(this.raw.ports || []), ...this.customGames()];
    this.index = new Map(all.map((g) => [g.id, g]));

    const games = all.map((g) => {
      const o = cfg.games[g.id] || {};
      const art = { cover: [...g.art.cover], hero: [...g.art.hero], logo: [...g.art.logo] };
      // (missing art for uninstalled games is fine: they fall back to Steam's CDN)
    // Priority: art the user picked, then scraped art, then whatever the source provides.
      const sc = cfg.scraped[g.id] || {};
      if (sc.cover) art.cover.unshift(mediaUrl(sc.cover));
      if (sc.background) art.hero.unshift(mediaUrl(sc.background));
      if (o.cover) art.cover.unshift(mediaUrl(o.cover));
      if (o.background) art.hero.unshift(mediaUrl(o.background));
      // Emulated and hand-added games are assumed playable on a pad unless marked otherwise.
      const known = g.source === 'steam' ? ((cfg.steamMeta[g.id.slice(6)] || {}).controller || 'unknown') : 'full';
      const controller = o.controller === 'yes' ? 'full' : o.controller === 'no' ? 'none' : known;
      const { launch, ...pub } = g;
      return {
        ...pub,
        name: o.name || g.name,
        originalName: g.name,
        art,
        installed: g.installed !== false,
        download: g.download || null,
        hasCustomArt: Boolean(o.cover || o.background),
        hasScrapedArt: Boolean(sc.cover || sc.background),
        controller,
        controllerOverride: o.controller || null,
        favorite: Boolean(o.favorite),
        hidden: Boolean(o.hidden),
        collections: (o.collections || []).filter((id) => validCollections.has(id)),
        lastPlayed: Math.max(g.lastPlayed || 0, o.lastPlayed || 0),
        playCount: o.playCount || 0,
        playtimeMin: (g.playtimeMin || 0) + (o.playtimeMin || 0),
      };
    });

    return {
      games,
      collections: cfg.collections,
      systems: this.raw.emu.systems,
      emulators: this.raw.emu.emulators,
      romRoots: this.raw.emu.romRoots,
      userRomRoots: cfg.romRoots,
      steam: { installs: this.raw.steam.installs, error: this.raw.steam.error || null },
      settings: cfg.settings,
      scraper: { hasKey: Boolean(cfg.secrets.sgdbKey) },
      steamAccount: { hasKey: Boolean(cfg.secrets.steamKey), owned: ((cfg.steamOwned && cfg.steamOwned.games) || []).length, at: (cfg.steamOwned && cfg.steamOwned.at) || 0 },
      ui: cfg.ui,
    };
  }

  get(id) { return this.index.get(id); }

  patchGame(id, patch) {
    const cur = this.config.games[id] || {};
    const next = { ...cur, ...patch };
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete next[k];
    }
    if (Object.keys(next).length) this.config.games[id] = next;
    else delete this.config.games[id];
    this.store.save();
  }

  markPlayed(id) {
    const cur = this.config.games[id] || {};
    this.patchGame(id, { lastPlayed: Math.floor(Date.now() / 1000), playCount: (cur.playCount || 0) + 1 });
  }

  /** Steam apps whose controller support has not been looked up (or could not be). */
  controllerPending() {
    const meta = this.config.steamMeta;
    return this.raw.steam.games.map((g) => g.id.slice(6)).filter((appid) => !meta[appid] || meta[appid].controller === 'unknown');
  }

  /** Ask Steam's store which games support a controller and remember the answers. */
  async refreshControllerSupport(onProgress, { limit = Infinity, gapMs = 220 } = {}) {
    const pending = this.controllerPending().slice(0, limit);
    if (!pending.length) return { ok: true, checked: 0, rateLimited: false };
    const { results, rateLimited } = await steamStore.controllerSupportFor(pending, { onProgress, gapMs });
    for (const [appid, controller] of Object.entries(results)) this.config.steamMeta[appid] = { controller };
    this.store.save();
    return { ok: true, checked: Object.keys(results).length, rateLimited };
  }

  /** Games with no artwork on disk: nothing local from the source, the user, or an earlier scrape. */
  missingArt() {
    const cfg = this.config;
    return [...this.index.values()].filter((g) => {
      const o = cfg.games[g.id] || {};
      const sc = cfg.scraped[g.id] || {};
      return !o.cover && !sc.cover && !g.art.cover.some((u) => u.startsWith('media://'));
    });
  }

  setScraped(id, art) {
    const cur = this.config.scraped[id] || {};
    this.config.scraped[id] = { cover: art.cover || cur.cover || '', background: art.background || cur.background || '' };
    this.store.save();
  }

  /** Time played through Halcyon, for sources that do not keep their own count. */
  addPlaytime(id, minutes) {
    const cur = this.config.games[id] || {};
    this.patchGame(id, { playtimeMin: (cur.playtimeMin || 0) + minutes });
  }

  saveCustom(game) {
    const list = this.config.customGames;
    const clean = {
      id: game.id || `custom:${crypto.randomUUID().slice(0, 8)}`,
      name: String(game.name || '').trim() || 'Untitled',
      command: String(game.command || '').trim(),
      cwd: String(game.cwd || '').trim(),
      cover: game.cover || '',
      background: game.background || '',
    };
    const i = list.findIndex((c) => c.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    this.store.save();
    return clean.id;
  }

  deleteCustom(id) {
    this.config.customGames = this.config.customGames.filter((c) => c.id !== id);
    delete this.config.games[id];
    for (const file of Object.values(this.config.scraped[id] || {})) { if (file) fs.rm(file, { force: true }, () => {}); }
    delete this.config.scraped[id];
    this.store.save();
  }

  createCollection(name) {
    const col = { id: `col:${crypto.randomUUID().slice(0, 8)}`, name: String(name).trim() || 'New Collection' };
    this.config.collections.push(col);
    this.store.save();
    return col.id;
  }

  renameCollection(id, name) {
    const col = this.config.collections.find((c) => c.id === id);
    if (col && String(name).trim()) { col.name = String(name).trim(); this.store.save(); }
  }

  deleteCollection(id) {
    this.config.collections = this.config.collections.filter((c) => c.id !== id);
    for (const g of Object.values(this.config.games)) {
      if (g.collections) g.collections = g.collections.filter((c) => c !== id);
    }
    this.store.save();
  }
}

module.exports = { Library };
