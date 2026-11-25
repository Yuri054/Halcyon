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

module.exports = { ownedGames };
