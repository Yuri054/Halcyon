'use strict';
// Artwork from SteamGridDB (steamgriddb.com), using the user's own API key.
// Images are saved next to the config so they keep working offline.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.HALCYON_SGDB_URL || 'https://www.steamgriddb.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ScrapeError extends Error {
  constructor(message, fatal = false) { super(message); this.fatal = fatal; }
}

async function call(key, route) {
  let res;
  try {
    res = await fetch(`${BASE}${route}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new ScrapeError(`Could not reach SteamGridDB (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`, true);
  }
  if (res.status === 401 || res.status === 403) throw new ScrapeError('SteamGridDB rejected the API key. Check it under Settings.', true);
  if (res.status === 429) throw new ScrapeError('SteamGridDB is limiting requests. Try again in a few minutes.', true);
  if (res.status === 404) return [];
  if (!res.ok) throw new ScrapeError(`SteamGridDB answered with an error (HTTP ${res.status}).`);
  const json = await res.json().catch(() => null);
  return json && json.success && Array.isArray(json.data) ? json.data : [];
}

/** Titles as people search for them: no region tags, disc numbers or file-name punctuation. */
function searchTerm(name) {
  return name.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function save(url, dir, stem) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new ScrapeError(`Artwork download failed (HTTP ${res.status}).`);
  const ext = (path.extname(new URL(url).pathname).toLowerCase().match(/^\.(png|jpe?g|webp)$/) || ['.png'])[0];
  await fsp.mkdir(dir, { recursive: true });
  for (const old of ['.png', '.jpg', '.jpeg', '.webp']) await fsp.rm(path.join(dir, stem + old), { force: true });
  const file = path.join(dir, stem + ext);
  await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Find and download a cover and a background for one game.
 * game: { id, name, source, appid }. Resolves to { cover, background } with local paths (either may be null).
 */
async function scrapeGame(key, game, artDir) {
  let grids;
  let heroes;
  if (game.source === 'steam' && game.appid) {
    grids = await call(key, `/grids/steam/${game.appid}?dimensions=600x900&types=static`);
    heroes = await call(key, `/heroes/steam/${game.appid}?types=static`);
  } else {
    const term = searchTerm(game.name);
    if (!term) return { cover: null, background: null };
    const hits = await call(key, `/search/autocomplete/${encodeURIComponent(term)}`);
    if (!hits.length) return { cover: null, background: null };
    grids = await call(key, `/grids/game/${hits[0].id}?dimensions=600x900&types=static`);
    heroes = await call(key, `/heroes/game/${hits[0].id}?types=static`);
  }
  const stem = crypto.createHash('sha1').update(game.id).digest('hex').slice(0, 16);
  const out = { cover: null, background: null };
  if (grids[0]?.url) out.cover = await save(grids[0].url, artDir, `${stem}-cover`);
  if (heroes[0]?.url) out.background = await save(heroes[0].url, artDir, `${stem}-hero`);
  return out;
}

/**
 * The artwork to choose from for one game: kind 'cover' (600x900 grids) or 'background' (heroes).
 * Finds the game on SteamGridDB (by Steam app id, or by name), unless sgdbId says which.
 * Resolves { matches: [{ id, name, year }], gameId, images: [{ id, url, thumb, width, height, style, score, author }] }.
 */
async function candidates(key, game, kind = 'cover', sgdbId = null) {
  const term = searchTerm(game.name || '');
  const matches = term ? (await call(key, `/search/autocomplete/${encodeURIComponent(term)}`)).slice(0, 12)
    .map((m) => ({ id: m.id, name: m.name, year: m.release_date ? new Date(m.release_date * 1000).getFullYear() : null })) : [];
  const route = kind === 'cover' ? 'grids' : 'heroes';
  const query = kind === 'cover' ? '?dimensions=600x900&types=static' : '?types=static';
  let gameId = sgdbId;
  let list = [];
  if (!gameId && game.source === 'steam' && game.appid) {
    list = await call(key, `/${route}/steam/${game.appid}${query}`);
    if (list.length) gameId = 'steam';
  }
  if (!list.length) {
    gameId = gameId && gameId !== 'steam' ? gameId : matches[0]?.id;
    if (gameId) list = await call(key, `/${route}/game/${gameId}${query}`);
  }
  return {
    matches, gameId,
    images: list.filter((x) => x.url && !x.nsfw).slice(0, 60).map((x) => ({
      id: x.id, url: x.url, thumb: x.thumb || x.url, width: x.width, height: x.height, style: x.style || '', score: x.score || 0, author: x.author?.name || '',
    })),
  };
}

/** Download one chosen image for a game: kind 'cover' or 'background'. Resolves the local file. */
async function saveChoice(url, game, kind, artDir) {
  if (!/^https:\/\/([a-z0-9-]+\.)*steamgriddb\.com\//.test(url)) throw new ScrapeError('Not a SteamGridDB image.');
  const stem = crypto.createHash('sha1').update(game.id).digest('hex').slice(0, 16);
  // A new name each time, so the picture changes on screen straight away.
  return save(url, artDir, `${stem}-${kind === 'cover' ? 'cover' : 'hero'}-${Date.now().toString(36)}`);
}

/** Check a key without changing anything. */
async function testKey(key) {
  try {
    await call(key, '/search/autocomplete/portal');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Scrape several games. onResult(game, art) fires for each hit so progress is kept
 * even if a later request fails. Returns { ok, found, tried, error? }.
 */
async function scrapeMany(key, games, artDir, { onResult, onProgress } = {}) {
  let found = 0;
  let tried = 0;
  for (const game of games) {
    try {
      const art = await scrapeGame(key, game, artDir);
      tried++;
      if (art.cover || art.background) { found++; if (onResult) onResult(game, art); }
    } catch (err) {
      if (err.fatal) return { ok: false, found, tried, error: err.message };
      tried++;
    }
    if (onProgress) onProgress(tried, games.length);
    await sleep(120);
  }
  return { ok: true, found, tried };
}

module.exports = { scrapeGame, scrapeMany, testKey, searchTerm, candidates, saveChoice };
