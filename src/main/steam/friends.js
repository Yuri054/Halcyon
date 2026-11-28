'use strict';
// Steam friends: who's online and what they're playing, from the Steam Web API with the
// person's own key (the same one used for owned games and achievements). Refreshed every
// minute while Halcyon runs; a friend coming online or starting a game is reported as an
// event, so the dashboard can say so.
const steam = require('./steam');
const webapi = require('./webapi');
const diary = require('../log');

const BASE = process.env.HALCYON_STEAM_API_URL || 'https://api.steampowered.com';
const EVERY_MS = 60 * 1000;
const LIST_EVERY_MS = 10 * 60 * 1000;   // the friends list itself changes rarely
// Steam's persona states.
const STATE = { 0: 'offline', 1: 'online', 2: 'busy', 3: 'away', 4: 'snooze', 5: 'online', 6: 'online' };

async function getJson(path, key) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { 'x-webapi-key': key }, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, error: `Could not reach Steam (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
  if (res.status === 401) return { ok: false, private: true, error: 'Steam won’t share your friends list. In Steam, set your profile’s Friends List to Public or Friends Only.' };
  if (res.status === 403) return { ok: false, badKey: true, error: 'Steam rejected the Web API key.' };
  if (res.status === 429) return { ok: false, busy: true, error: 'Steam is limiting requests. Trying again shortly.' };
  if (!res.ok) return { ok: false, error: `Steam answered with an error (HTTP ${res.status}).` };
  return { ok: true, json: await res.json().catch(() => null) };
}

class Friends {
  /** opts: { onChange: () => void, onEvent: ({ kind: 'online' | 'playing', friend }) => void } */
  constructor(store, { onChange = () => {}, onEvent = () => {} } = {}) {
    this.store = store;
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.ids = [];
    this.idsAt = 0;
    this.friends = new Map();   // steamid -> friend
    this.at = 0;
    this.error = null;
    this.busy = false;
    this.timer = null;
  }

  get cfg() { return this.store.data; }

  account() {
    const key = this.cfg.secrets.steamKey;
    const p = steam.profile(this.cfg.steam.extraRoots);
    const id = (p && p.steamid) || steam.accountIds(this.cfg.steam.extraRoots)[0];
    return key && id ? { key, id } : null;
  }

  start() {
    if (this.timer) return;
    this.refresh().catch(() => {});
    this.timer = setInterval(() => this.refresh().catch(() => {}), EVERY_MS);
    this.timer.unref?.();
  }

  /** What the dashboard shows: { ok, signedIn, friends: [...], at, error }. */
  snapshot() {
    const order = { playing: 0, online: 1, busy: 2, away: 3, snooze: 3, offline: 4 };
    const list = [...this.friends.values()].sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { ok: true, signedIn: Boolean(this.account()), friends: list, at: this.at, error: this.error };
  }

  async refresh({ force = false } = {}) {
    const acct = this.account();
    if (!acct || this.busy) return this.snapshot();
    this.busy = true;
    try {
      if (force || !this.ids.length || Date.now() - this.idsAt > LIST_EVERY_MS) {
        const r = await getJson(`/ISteamUser/GetFriendList/v1/?steamid=${encodeURIComponent(acct.id)}&relationship=friend&format=json`, acct.key);
        if (!r.ok) { this.fail(r.error); return this.snapshot(); }
        this.ids = ((r.json && r.json.friendslist && r.json.friendslist.friends) || []).map((f) => String(f.steamid));
        this.idsAt = Date.now();
      }
      const fresh = new Map();
      for (let i = 0; i < this.ids.length; i += 100) {
        const r = await getJson(`/ISteamUser/GetPlayerSummaries/v2/?steamids=${this.ids.slice(i, i + 100).join(',')}&format=json`, acct.key);
        if (!r.ok) { this.fail(r.error); return this.snapshot(); }
        for (const p of (r.json && r.json.response && r.json.response.players) || []) fresh.set(String(p.steamid), Friends.friend(p));
      }
      const first = !this.at;
      const before = this.friends;
      this.friends = fresh;
      this.at = Date.now();
      this.error = null;
      // What changed since last time (nothing is announced on the first look).
      if (!first) {
        for (const f of fresh.values()) {
          const was = before.get(f.id);
          if (!was) continue;
          if (f.gameId && f.gameId !== was.gameId) this.onEvent({ kind: 'playing', friend: f });
          else if (was.status === 'offline' && f.status !== 'offline') this.onEvent({ kind: 'online', friend: f });
        }
      }
      this.onChange();
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }

  fail(error) {
    if (this.error !== error) diary.log('friends:', error);
    this.error = error;
    this.onChange();
  }

  /** One friend, from a player summary. */
  static friend(p) {
    const gameId = p.gameid ? String(p.gameid) : '';
    const base = STATE[p.personastate] || 'offline';
    return {
      id: String(p.steamid),
      name: p.personaname || 'Steam friend',
      avatar: p.avatarfull || p.avatarmedium || p.avatar || '',
      status: gameId ? 'playing' : base,
      game: gameId ? (p.gameextrainfo || 'a game') : '',
      gameId,
      // How to join them, when Steam says (a lobby, or a server address).
      lobby: p.lobbysteamid ? String(p.lobbysteamid) : '',
      server: p.gameserverip && p.gameserverip !== '0.0.0.0:0' ? String(p.gameserverip) : '',
      lastOnline: Number(p.lastlogoff) || 0,
      profile: p.profileurl || '',
    };
  }

  // ---- comparing achievements with a friend

  /** A friend's progress in one game: Map(apiname -> { achieved, time }), or { private } / null. */
  async theirAchievements(id, appid) {
    const acct = this.account();
    if (!acct) return null;
    const r = await getJson(`/ISteamUserStats/GetPlayerAchievements/v1/?steamid=${encodeURIComponent(id)}&appid=${encodeURIComponent(appid)}&format=json`, acct.key);
    if (!r.ok) return r.private || r.badKey ? { private: true } : null;
    const list = (r.json && r.json.playerstats && r.json.playerstats.achievements) || [];
    return new Map(list.map((a) => [a.apiname, { achieved: Boolean(a.achieved), time: a.unlocktime || 0 }]));
  }

  /**
   * Games you both have, with achievements, for comparing: { ok, games: [{ appid, name, them:
   * { unlocked, total }, you: { unlocked, total } | null, theirLastPlayed }] }, most recently
   * played by them first. mine: { owns(appid), summary(appid), game(appid) } from the dashboard's
   * own library and achievements. Kept for ten minutes per friend.
   */
  async sharedGames(id, mine) {
    const acct = this.account();
    if (!acct) return { ok: false, error: 'Add your Steam Web API key under Settings › Steam.' };
    this.shared = this.shared || new Map();
    const cached = this.shared.get(id);
    if (cached && Date.now() - cached.at < LIST_EVERY_MS) return cached.result;
    const owned = await webapi.ownedGames(acct.key, id);
    if (!owned.ok) return owned;
    if (owned.empty) return { ok: false, private: true, error: 'They keep their games private on Steam, so there’s nothing to compare.' };
    const both = owned.games.filter((g) => g.playtimeMin > 0 && mine.owns(g.appid)).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 30);
    const out = [];
    // A few at a time, so Steam isn't asked for everything at once.
    for (let i = 0; i < both.length; i += 6) {
      const batch = await Promise.all(both.slice(i, i + 6).map(async (g) => {
        const theirs = await this.theirAchievements(id, g.appid);
        if (!theirs || theirs.private || !theirs.size) return null;
        let you = mine.summary(g.appid);
        if (!you) { const r = await mine.game(g.appid).catch(() => null); you = r && r.ok ? { unlocked: r.unlocked, total: r.total } : null; }
        return { appid: g.appid, name: g.name, theirLastPlayed: g.lastPlayed, them: { unlocked: [...theirs.values()].filter((a) => a.achieved).length, total: theirs.size }, you };
      }));
      out.push(...batch.filter(Boolean));
    }
    const result = { ok: true, games: out };
    this.shared.set(id, { at: Date.now(), result });
    return result;
  }

  /** One game, side by side: { ok, name, list: [{ ...achievement, you: { achieved, time }, them: {...} }] }. */
  async compareGame(id, appid, mineGame) {
    const [me, theirs] = await Promise.all([mineGame(appid), this.theirAchievements(id, appid)]);
    if (!me || !me.ok) return me || { ok: false, error: 'Couldn’t load your achievements for this game.' };
    if (!theirs) return { ok: false, error: 'Steam didn’t answer. Try again in a moment.' };
    if (theirs.private) return { ok: false, error: 'They keep their game details private on Steam.' };
    const list = me.list.map((a) => ({ ...a, you: { achieved: a.achieved, time: a.unlockTime }, them: theirs.get(a.id) || { achieved: false, time: 0 } }));
    return { ok: true, list };
  }

  /** The steam:// link that joins a friend's game, or null when Steam gives no way in. */
  joinLink(id) {
    const f = this.friends.get(String(id));
    if (!f || !f.gameId) return null;
    if (f.lobby) return `steam://joinlobby/${f.gameId}/${f.lobby}/${f.id}`;
    if (f.server) return `steam://connect/${f.server}`;
    return null;
  }
}

module.exports = { Friends };
