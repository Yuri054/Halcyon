'use strict';
// RetroAchievements (retroachievements.org), with the person's own username and Web API key
// (from their RetroAchievements settings page). Keeps a summary of every game they've played
// there (achievements, points, console, icon) and fetches a game's full list on request.
const fs = require('fs');
const path = require('path');

const BASE = process.env.HALCYON_RA_URL || 'https://retroachievements.org/API';
const MEDIA = process.env.HALCYON_RA_MEDIA || 'https://media.retroachievements.org';
const HOUR = 3600 * 1000;

async function call(route, params, key) {
  const qs = new URLSearchParams({ ...params, y: key });
  let res;
  try {
    res = await fetch(`${BASE}/${route}?${qs}`, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, error: `Could not reach RetroAchievements (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, badKey: true, error: 'RetroAchievements didn’t accept that username and Web API key.' };
  if (res.status === 429) return { ok: false, busy: true, error: 'RetroAchievements is limiting requests. Try again in a few minutes.' };
  if (!res.ok) return { ok: false, error: `RetroAchievements answered with an error (HTTP ${res.status}).` };
  const json = await res.json().catch(() => null);
  if (json && json.Error) return { ok: false, badKey: /key|user/i.test(json.Error), error: String(json.Error) };
  return { ok: true, json };
}

const media = (p) => (p ? (/^https?:/.test(p) ? p : `${MEDIA}${p.startsWith('/') ? '' : '/'}${p}`) : '');
const when = (s) => (s ? Math.floor(Date.parse(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) / 1000) || 0 : 0);

class Retro {
  constructor(store, { dir, onChange = () => {} }) {
    this.store = store;
    this.dir = dir;
    this.onChange = onChange;
    this.memory = new Map();
    this.syncing = false;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  }

  get cfg() { return this.store.data; }
  account() {
    const user = this.cfg.retro && this.cfg.retro.user;
    const key = this.cfg.secrets.raKey;
    return user && key ? { user, key } : null;
  }
  status() { const a = this.account(); return { signedIn: Boolean(a), user: a ? a.user : '', at: (this.cfg.retro && this.cfg.retro.at) || 0 }; }

  /** Check a username and key, and keep them if they work. */
  async signIn(user, key) {
    user = String(user || '').trim();
    key = String(key || '').trim();
    if (!user || !key) return { ok: false, error: 'Enter your RetroAchievements username and Web API key.' };
    const r = await call('API_GetUserProfile.php', { u: user }, key);
    if (!r.ok) return r;
    if (!r.json || (!r.json.User && !r.json.ULID)) return { ok: false, error: 'RetroAchievements doesn’t know that username.' };
    this.cfg.retro = { user: r.json.User || user, at: 0, points: Number(r.json.TotalPoints) || 0, pic: media(r.json.UserPic) };
    this.cfg.secrets.raKey = key;
    this.cfg.retroGames = {};
    this.store.save();
    this.sync().catch(() => {});
    return { ok: true, user: this.cfg.retro.user };
  }

  signOut() {
    delete this.cfg.retro;
    delete this.cfg.secrets.raKey;
    this.cfg.retroGames = {};
    this.store.save();
    this.memory.clear();
    this.onChange();
    return { ok: true };
  }

  /** Every game played on RetroAchievements, with counts and points: cfg.retroGames[id]. */
  async sync() {
    const acct = this.account();
    if (!acct || this.syncing) return { ok: false };
    this.syncing = true;
    try {
      const games = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const r = await call('API_GetUserCompletionProgress.php', { u: acct.user, c: 500, o: offset }, acct.key);
        if (!r.ok) return r;
        const list = (r.json && r.json.Results) || [];
        games.push(...list);
        if (list.length < 500) break;
      }
      // Points per game come from a second call, in batches.
      const points = {};
      const ids = games.map((g) => g.GameID);
      for (let i = 0; i < ids.length; i += 100) {
        const r = await call('API_GetUserProgress.php', { u: acct.user, i: ids.slice(i, i + 100).join(',') }, acct.key);
        if (r.ok && r.json) Object.assign(points, r.json);
      }
      const out = {};
      for (const g of games) {
        const p = points[g.GameID] || points[String(g.GameID)] || {};
        if (!g.MaxPossible) continue;
        out[g.GameID] = {
          title: g.Title, console: g.ConsoleName || '', icon: media(g.ImageIcon),
          total: Number(g.MaxPossible) || 0, unlocked: Math.max(Number(g.NumAwarded) || 0, Number(g.NumAwardedHardcore) || 0),
          points: Number(p.PossibleScore) || 0, earned: Math.max(Number(p.ScoreAchieved) || 0, Number(p.ScoreAchievedHardcore) || 0),
          lastPlayed: when(g.MostRecentAwardedDate),
        };
      }
      this.cfg.retroGames = out;
      this.cfg.retro.at = Date.now();
      this.store.save();
      this.onChange();
      return { ok: true, games: Object.keys(out).length };
    } finally {
      this.syncing = false;
    }
  }

  /** Achievements unlocked in the last few minutes: [{ id, name, points, icon, date, game }]. */
  async recent(minutes = 3) {
    const acct = this.account();
    if (!acct) return [];
    const r = await call('API_GetUserRecentAchievements.php', { u: acct.user, m: minutes }, acct.key);
    if (!r.ok || !Array.isArray(r.json)) return [];
    return r.json.map((a) => ({
      id: String(a.AchievementID), name: a.Title || 'Achievement', points: Number(a.Points) || 0, date: a.Date || '',
      icon: a.BadgeURL ? media(a.BadgeURL) : a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}.png` : '', game: a.GameTitle || '',
    }));
  }

  /** One game's achievements, in the same shape as Steam's: { ok, list, total, unlocked, points, earned }. */
  async game(id, { refresh = false } = {}) {
    const acct = this.account();
    id = String(id);
    if (!/^\d+$/.test(id)) return { ok: false, error: 'Not a RetroAchievements game.' };
    const file = path.join(this.dir, `${id}.json`);
    let cached = this.memory.get(id);
    if (!cached) { try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; } }
    if (cached && !refresh && Date.now() - cached.at < HOUR) return { ok: true, ...cached };
    if (!acct) return cached ? { ok: true, ...cached, stale: true } : { ok: false, error: 'Sign in to RetroAchievements under Settings › library.' };
    const r = await call('API_GetGameInfoAndUserProgress.php', { g: id, u: acct.user }, acct.key);
    if (!r.ok) return cached ? { ok: true, ...cached, stale: true } : r;
    const j = r.json || {};
    const players = Number(j.NumDistinctPlayers || j.NumDistinctPlayersCasual) || 0;
    const list = Object.values(j.Achievements || {}).sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0) || a.ID - b.ID).map((a) => {
      const earned = a.DateEarnedHardcore || a.DateEarned || '';
      return {
        id: String(a.ID), name: a.Title || '', description: a.Description || '', hidden: false,
        icon: a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}.png` : '', iconGray: a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}_lock.png` : '',
        achieved: Boolean(earned), unlockTime: when(earned), points: Number(a.Points) || 0,
        percent: players ? Math.round(((Number(a.NumAwarded) || 0) / players) * 1000) / 10 : null,
        hardcore: Boolean(a.DateEarnedHardcore),
      };
    });
    const entry = {
      at: Date.now(), list, title: j.Title || '', console: j.ConsoleName || '', icon: media(j.ImageIcon),
      total: list.length, unlocked: list.filter((a) => a.achieved).length,
      points: list.reduce((n, a) => n + a.points, 0), earned: list.filter((a) => a.achieved).reduce((n, a) => n + a.points, 0),
    };
    this.memory.set(id, entry);
    try { fs.writeFileSync(file, JSON.stringify(entry)); } catch { /* cache only */ }
    const games = this.cfg.retroGames || (this.cfg.retroGames = {});
    const before = games[id];
    games[id] = { ...(before || {}), title: entry.title, console: entry.console, icon: entry.icon, total: entry.total, unlocked: entry.unlocked, points: entry.points, earned: entry.earned, lastPlayed: (before && before.lastPlayed) || 0 };
    this.store.save();
    if (!before || before.unlocked !== entry.unlocked) this.onChange();
    return { ok: true, ...entry };
  }
}

module.exports = { Retro };
