'use strict';
// Steam achievements, through the Web API with the person's own key: each game's full list
// (cached for an hour, in memory and on disk) and a small per-game summary kept in the config
// ({ total, unlocked, at }), which the profile corner's score and the home tile add up.
// Summaries fill in quietly in the background for games that have been played.
const fs = require('fs');
const path = require('path');
const steam = require('./steam');
const webapi = require('./webapi');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

class Achievements {
  constructor(store, library, { dir, onChange = () => {} }) {
    this.store = store;
    this.library = library;
    this.dir = dir;
    this.onChange = onChange;
    this.memory = new Map();
    this.syncing = false;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  }

  get cfg() { return this.store.data; }
  summaries() { return this.cfg.achievements || (this.cfg.achievements = {}); }
  account() {
    const key = this.cfg.secrets.steamKey;
    const p = steam.profile(this.cfg.steam.extraRoots);
    const id = (p && p.steamid) || steam.accountIds(this.cfg.steam.extraRoots)[0];
    return key && id ? { key, id } : null;
  }

  /** One game's achievements: { ok, list, total, unlocked }; fetched again when older than an hour (or asked). */
  async game(appid, { refresh = false } = {}) {
    appid = String(appid);
    if (!/^\d+$/.test(appid)) return { ok: false, error: 'Not a Steam game.' };
    const file = path.join(this.dir, `${appid}.json`);
    let cached = this.memory.get(appid);
    if (!cached) { try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; } }
    if (cached && !refresh && Date.now() - cached.at < HOUR) return { ok: true, ...cached };
    const acct = this.account();
    if (!acct) return cached ? { ok: true, ...cached, stale: true } : { ok: false, error: 'Add your Steam Web API key under Settings › steam to see achievements.' };
    const r = await webapi.achievements(acct.key, acct.id, appid);
    if (!r.ok) return cached ? { ok: true, ...cached, stale: true } : r;
    const entry = { at: Date.now(), list: r.list, total: r.list.length, unlocked: r.list.filter((a) => a.achieved).length };
    this.memory.set(appid, entry);
    try { fs.writeFileSync(file, JSON.stringify(entry)); } catch { /* cache only */ }
    const before = this.summaries()[appid];
    this.summaries()[appid] = { total: entry.total, unlocked: entry.unlocked, at: entry.at };
    this.store.save();
    if (!before || before.unlocked !== entry.unlocked || before.total !== entry.total) this.onChange();
    return { ok: true, ...entry };
  }

  /** Totals across every game with a summary. */
  totals() {
    let unlocked = 0; let total = 0; let games = 0;
    for (const s of Object.values(this.summaries())) {
      if (!s.total) continue;
      unlocked += s.unlocked; total += s.total; games++;
    }
    return { unlocked, total, games };
  }

  /** Fill in (and keep fresh) the summaries of games that have been played, one at a time. */
  async sync() {
    if (this.syncing || !this.account()) return;
    this.syncing = true;
    try {
      const owned = (this.cfg.steamOwned && this.cfg.steamOwned.games) || [];
      const played = new Map(owned.filter((g) => g.playtimeMin > 0).map((g) => [g.appid, g.lastPlayed || 0]));
      for (const g of this.library.raw.steam.games || []) if (g.lastPlayed) played.set(g.id.slice(6), Math.max(played.get(g.id.slice(6)) || 0, g.lastPlayed));
      const due = [...played.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
        .filter((id) => { const s = this.summaries()[id]; return !s || Date.now() - s.at > DAY; });
      for (const appid of due) {
        const r = await this.game(appid);
        if (r && r.busy) break;   // Steam asked us to slow down: carry on next time
        await new Promise((res) => setTimeout(res, 1500));
      }
    } finally {
      this.syncing = false;
    }
  }
}

module.exports = { Achievements };
