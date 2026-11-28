'use strict';
// Steam friends: who's online and what they're playing, from the Steam Web API with the
// person's own key (the same one used for owned games and achievements). Refreshed every
// minute while Halcyon runs; a friend coming online or starting a game is reported as an
// event, so the dashboard can say so.
const steam = require('./steam');
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
