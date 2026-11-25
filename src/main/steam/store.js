'use strict';
// Controller support for Steam games, from Steam's public store listing.
// Category 28 is "Full controller support", 18 is "Partial Controller Support".
const BASE = process.env.HALCYON_STEAM_STORE_URL || 'https://store.steampowered.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves to 'full' | 'partial' | 'none' | 'unknown'. Throws { rateLimited } when Steam says slow down. */
async function controllerSupport(appid) {
  const res = await fetch(`${BASE}/api/appdetails?appids=${encodeURIComponent(appid)}&filters=categories`, { signal: AbortSignal.timeout(12000) });
  if (res.status === 429) throw Object.assign(new Error('Steam is rate limiting requests'), { rateLimited: true });
  if (!res.ok) return 'unknown';
  const entry = (await res.json())?.[appid];
  if (!entry || !entry.success || !entry.data || Array.isArray(entry.data)) return 'unknown';
  const ids = new Set((entry.data.categories || []).map((c) => Number(c.id)));
  if (ids.has(28)) return 'full';
  if (ids.has(18)) return 'partial';
  return 'none';
}

/**
 * Look up many apps, gently. Returns { results: { appid: level }, failed, rateLimited }.
 * onProgress(done, total) is called after each app.
 */
async function controllerSupportFor(appids, { onProgress, gapMs = 220 } = {}) {
  const results = {};
  let failed = 0;
  let rateLimited = false;
  for (let i = 0; i < appids.length; i++) {
    try {
      results[appids[i]] = await controllerSupport(appids[i]);
    } catch (err) {
      if (err.rateLimited) { rateLimited = true; break; }
      failed++;
    }
    if (onProgress) onProgress(i + 1, appids.length);
    if (i < appids.length - 1) await sleep(gapMs);
  }
  return { results, failed, rateLimited };
}

// ------------------------------------------------------------ storefront

const cache = new Map(); // key -> { at, value }
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(route) {
  let res;
  try {
    res = await fetch(`${BASE}${route}`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error(`Could not reach the Steam store (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`);
  }
  if (res.status === 429) throw new Error('Steam is limiting requests. Try again in a few minutes.');
  if (!res.ok) throw new Error(`The Steam store answered with an error (HTTP ${res.status}).`);
  return res.json();
}

function money(cents, currency) {
  if (cents == null) return '';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(cents / 100); } catch { return (cents / 100).toFixed(2); }
}

function price(final, initial, currency, discount) {
  if (final == null) return null;
  if (final === 0) return { free: true, text: 'Free', was: '', discount: 0 };
  return { free: false, text: money(final, currency), was: discount ? money(initial, currency) : '', discount: discount || 0 };
}

const support = (v) => (v === 'full' ? 'full' : v === 'partial' ? 'partial' : null);

/** The store's front page rails: [{ id, title, items: [{ appid, name, image, price, controller, linux }] }]. */
function featured() {
  return cached('featured', 10 * 60 * 1000, async () => {
    const data = await getJson('/api/featuredcategories?l=english');
    const rails = [];
    for (const [id, title] of [['specials', 'on sale'], ['top_sellers', 'top sellers'], ['new_releases', 'new releases'], ['coming_soon', 'coming soon']]) {
      const seen = new Set();
      const items = ((data[id] && data[id].items) || [])
        .filter((it) => it.type === 0 && it.id && it.name && !seen.has(it.id) && seen.add(it.id))
        .slice(0, 12)
        .map((it) => ({
          appid: String(it.id), name: it.name, image: it.large_capsule_image || it.header_image || '',
          price: id === 'coming_soon' && !it.final_price ? null : price(it.final_price, it.original_price, it.currency, it.discount_percent),
          controller: support(it.controller_support), linux: Boolean(it.linux_available),
        }));
      if (items.length) rails.push({ id, title, items });
    }
    return rails;
  });
}

function search(term) {
  const q = String(term || '').trim();
  if (!q) return Promise.resolve([]);
  return cached(`search:${q.toLowerCase()}`, 5 * 60 * 1000, async () => {
    const data = await getJson(`/api/storesearch/?term=${encodeURIComponent(q)}&l=english`);
    return ((data && data.items) || []).filter((it) => it.type === 'app').map((it) => ({
      appid: String(it.id), name: it.name,
      // Search only returns a tiny capsule; the header image lives at a predictable address.
      image: `https://shared.steamstatic.com/store_item_assets/steam/apps/${it.id}/header.jpg`,
      fallbackImage: it.tiny_image || '',
      price: it.price ? price(it.price.final, it.price.initial, it.price.currency, it.price.initial > it.price.final ? Math.round((1 - it.price.final / it.price.initial) * 100) : 0) : null,
      controller: support(it.controller_support), linux: Boolean(it.platforms && it.platforms.linux),
    }));
  });
}

const stripTags = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function details(appid) {
  return cached(`app:${appid}`, 30 * 60 * 1000, async () => {
    const entry = (await getJson(`/api/appdetails?appids=${encodeURIComponent(appid)}&l=english`))[appid];
    if (!entry || !entry.success || !entry.data) throw new Error('Steam has no store page for this title.');
    const d = entry.data;
    const po = d.price_overview;
    const cats = new Set((d.categories || []).map((c) => Number(c.id)));
    return {
      appid: String(appid), name: d.name, description: stripTags(d.short_description),
      image: d.header_image || '', background: d.background_raw || d.background || '',
      screenshots: (d.screenshots || []).slice(0, 4).map((s) => s.path_thumbnail),
      price: d.is_free ? price(0) : po ? price(po.final, po.initial, po.currency, po.discount_percent) : null,
      genres: (d.genres || []).map((g) => g.description).slice(0, 4),
      developer: (d.developers || [])[0] || '', release: d.release_date ? d.release_date.date : '', comingSoon: Boolean(d.release_date && d.release_date.coming_soon),
      controller: cats.has(28) ? 'full' : cats.has(18) ? 'partial' : 'none',
      linux: Boolean(d.platforms && d.platforms.linux), metacritic: d.metacritic ? d.metacritic.score : null,
    };
  });
}

module.exports = { controllerSupport, controllerSupportFor, featured, search, details };
