'use strict';
// Steam Web API: the games an account owns, using the user's own API key
// (free from steamcommunity.com/dev/apikey). The key travels in a header, not the URL.
const BASE = process.env.HALCYON_STEAM_API_URL || 'https://api.steampowered.com';

/** Resolves to { ok, games: [{ appid, name, playtimeMin, lastPlayed }] } or { ok: false, error }. */
async function ownedGames(key, steamId) {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v1/?steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1&format=json`;
  let res;
  try {
    res = await fetch(url, { headers: { 'x-webapi-key': key }, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, error: `Could not reach Steam (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, badKey: true, error: 'Steam rejected the Web API key.' };
  if (res.status === 429) return { ok: false, error: 'Steam is limiting requests. Try again in a few minutes.' };
  if (!res.ok) return { ok: false, error: `Steam answered with an error (HTTP ${res.status}).` };
  const json = await res.json().catch(() => null);
  const list = json && json.response && Array.isArray(json.response.games) ? json.response.games : null;
  // A private profile answers with an empty object rather than an error.
  if (!list) return { ok: true, games: [], empty: true };
  return {
    ok: true,
    games: list.filter((g) => g.name).map((g) => ({
      appid: String(g.appid), name: g.name, playtimeMin: g.playtime_forever || 0, lastPlayed: g.rtime_last_played || 0,
    })),
  };
}

async function getJson(url, key) {
  let res;
  try {
    res = await fetch(url, { headers: { 'x-webapi-key': key }, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, error: `Could not reach Steam (${err.name === 'TimeoutError' ? 'timed out' : err.message}).` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, badKey: true, error: 'Steam would not share this (a private profile, or the key was rejected).' };
  if (res.status === 429) return { ok: false, busy: true, error: 'Steam is limiting requests. Try again in a few minutes.' };
  if (res.status === 400) return { ok: true, json: null };   // games without achievements answer 400
  if (!res.ok) return { ok: false, error: `Steam answered with an error (HTTP ${res.status}).` };
  return { ok: true, json: await res.json().catch(() => null) };
}

/**
 * A game's achievements for an account: names, descriptions, icons, how rare each is, and
 * which are unlocked (and when). Resolves { ok, list: [...] } (list empty if it has none).
 */
async function achievements(key, steamId, appid) {
  const id = encodeURIComponent(appid);
  const [player, schema, global] = await Promise.all([
    getJson(`${BASE}/ISteamUserStats/GetPlayerAchievements/v1/?steamid=${encodeURIComponent(steamId)}&appid=${id}&l=english&format=json`, key),
    getJson(`${BASE}/ISteamUserStats/GetSchemaForGame/v2/?appid=${id}&l=english&format=json`, key),
    getJson(`${BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}&format=json`, key),
  ]);
  if (!player.ok) return player;
  const mine = new Map(((player.json && player.json.playerstats && player.json.playerstats.achievements) || []).map((a) => [a.apiname, a]));
  const defs = (schema.ok && schema.json && schema.json.game && schema.json.game.availableGameStats && schema.json.game.availableGameStats.achievements) || [];
  const pct = new Map(((global.ok && global.json && global.json.achievementpercentages && global.json.achievementpercentages.achievements) || []).map((a) => [a.name, Number(a.percent)]));
  const names = defs.length ? defs.map((d) => d.name) : [...mine.keys()];
  // Steam's icon links point at an old CDN host; the same files are on steamstatic.com, which the
  // pages are allowed to load images from.
  const cdn = (u) => (u ? String(u).replace(/^https?:\/\/steamcdn-a\.akamaihd\.net\//, 'https://cdn.akamai.steamstatic.com/') : '');
  const list = names.map((name) => {
    const d = defs.find((x) => x.name === name) || {};
    const m = mine.get(name) || {};
    return {
      id: name, name: d.displayName || m.name || name, description: d.description || m.description || '',
      hidden: Boolean(d.hidden), icon: cdn(d.icon), iconGray: cdn(d.icongray),
      achieved: Boolean(m.achieved), unlockTime: m.unlocktime || 0,
      percent: pct.has(name) ? Math.round(pct.get(name) * 10) / 10 : null,
    };
  });
  return { ok: true, list };
}

module.exports = { ownedGames, achievements };
