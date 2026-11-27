// Shared renderer state plus library queries and formatting.
export const api = window.halcyon;

export const state = {
  lib: { games: [], collections: [], systems: [], emulators: [], steam: { installs: [] }, settings: {}, scraper: {}, steamAccount: {}, ui: {} },
  section: 'home',
  filter: 'all',
  query: '',
  pads: [],
  playing: [],   // games running now: [{ id, name, quittable }]
};
/** Is this game running right now (so A resumes it rather than starting it again)? */
export const isPlaying = (id) => state.playing.some((p) => p.id === id);

/** The 360 theme's own options (Settings › display › Theme options); all on unless turned off. */
export const X360_OPTIONS = [
  ['glow', 'Lime focus glow', 'The selected tile gets a bright 360-green border and glow and lifts forward'],
  ['names', 'Names on every cover', 'A dark name bar along the bottom of each cover, not only the selected one'],
  ['flat', 'Flat Metro buttons', 'Show, Search and Sort as flat, sharp-cornered tiles instead of white pills'],
  ['roomy', 'Roomier covers', 'A little more space between covers'],
  ['scrollCue', 'Position and edge fade', 'A "12 / 236" count by the list and a soft fade at its right edge'],
  ['wash', 'Game art wash', 'A faint, blurred wash of the selected game’s art behind the top of the screen'],
  ['profile', 'Profile by the clock', 'Your Steam picture and name, with your game count and hours played'],
];
export const x360Option = (key) => (state.lib.settings.x360 || {})[key] !== false;

export const SORTS = [
  ['recent', 'Recently played'],
  ['name', 'A – Z'],
  ['playtime', 'Most played'],
  ['size', 'Largest'],
];

export const THEMES = [
  ['halcyon', 'Halcyon', 'Dark glass over your game art'],
  ['classic', 'Classic', 'Bright colour wash, glossy tiles and solid blades'],
  ['midnight', 'Midnight', 'Pure black and flat, easy on OLED screens'],
  ['metro360', '360 Light', 'Pale and flat, after the final Xbox 360 dashboard: green focus frames, light menus. Always green'],
  ['x360', '360', 'After the Xbox 360 dashboard: grey backdrop, bright green tiles that grow when selected, boxed menus and a centred Guide. Always green'],
];

export const ACCENTS = ['emerald', 'azure', 'violet', 'amber', 'crimson', 'ice'];

export const game = (id) => state.lib.games.find((g) => g.id === id);

/** Games Steam lists with no controller support (or that the user marked that way). */
export const noPadGames = () => state.lib.games.filter((g) => g.controller === 'none');

export function visibleGames() {
  const s = state.lib.settings;
  // A ROM whose game is installed as a PC port (shadowedBy) isn't listed: the port is.
  let list = (s.showHidden ? state.lib.games : state.lib.games.filter((g) => !g.hidden)).filter((g) => !g.shadowedBy);
  if (s.controllerOnly) list = list.filter((g) => g.controller !== 'none');
  return list;
}

/** How well a game works with a controller: full, partial, none or unknown (emulated games: full). */
export const padSupport = (g) => (g.source === 'emulator' ? 'full' : g.controller || 'unknown');

// Filters can be combined: "installed+pad:full" shows games that are installed AND fully
// support a controller. Within a group only one applies (installed or not installed; one
// source; one level of controller support), so picking another in the same group swaps it.
const FILTER_GROUP = (f) => (f === 'installed' || f === 'uninstalled' ? 'status'
  : f.startsWith('pad:') ? 'pad'
    : ['steam', 'ports', 'emulated', 'custom'].includes(f) || f.startsWith('sys:') ? 'source' : f);
export const filterParts = (filter) => (!filter || filter === 'all' ? [] : String(filter).split('+').filter(Boolean));
/** The filter with f turned on or off (others in its group make way). */
export function toggleFilter(filter, f) {
  if (f === 'all') return 'all';
  const parts = filterParts(filter);
  if (parts.includes(f)) return parts.filter((p) => p !== f).join('+') || 'all';
  return [...parts.filter((p) => FILTER_GROUP(p) !== FILTER_GROUP(f)), f].join('+');
}

export function filterGames(filter, list = visibleGames()) {
  const parts = filterParts(filter);
  if (parts.length > 1) {
    // Hidden / no-controller games come from the whole library, then the rest narrow them.
    const first = parts.find((p) => p === 'hidden' || p === 'nopad');
    let out = first ? filterGames(first, list) : list;
    for (const p of parts) if (p !== first) out = filterGames(p, out);
    return out;
  }
  if (filter === 'all') return list;
  if (filter === 'favorites') return list.filter((g) => g.favorite);
  if (filter === 'recent') return list.filter((g) => g.lastPlayed && g.installed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 24);
  if (filter === 'steam') return list.filter((g) => g.source === 'steam');
  if (filter === 'installed') return list.filter((g) => g.installed);
  if (filter === 'uninstalled') return list.filter((g) => !g.installed);
  if (filter === 'downloads') return list.filter((g) => g.download);
  if (filter === 'emulated') return list.filter((g) => g.source === 'emulator');
  if (filter === 'custom') return list.filter((g) => g.source === 'custom');
  if (filter === 'ports') return list.filter((g) => g.source === 'port');
  if (filter === 'hidden') return state.lib.games.filter((g) => g.hidden);
  if (filter === 'nopad') return noPadGames();
  if (filter.startsWith('pad:')) return list.filter((g) => padSupport(g) === filter.slice(4));
  if (filter.startsWith('sys:')) return list.filter((g) => g.system === filter.slice(4));
  if (filter.startsWith('col:')) return list.filter((g) => g.collections.includes(filter));
  return list;
}

export function filterLabel(filter) {
  const parts = filterParts(filter);
  if (parts.length > 1) return parts.map((p) => filterLabel(p)).join(' + ');
  const fixed = { all: 'All games', favorites: 'Favorites', recent: 'Recently played', steam: 'Steam', emulated: 'Emulated', custom: 'Added by hand', ports: 'PC ports', hidden: 'Hidden', nopad: 'No controller', installed: 'Installed', uninstalled: 'Not installed', downloads: 'Downloading',
    'pad:full': 'Full controller support', 'pad:partial': 'Partial controller support', 'pad:none': 'No controller support', 'pad:unknown': 'Controller support not known' };
  if (fixed[filter]) return fixed[filter];
  if (filter.startsWith('sys:')) return state.lib.systems.find((s) => s.id === filter.slice(4))?.short || 'Platform';
  if (filter.startsWith('col:')) return state.lib.collections.find((c) => c.id === filter)?.name || 'Collection';
  return filter;
}

export function sortGames(list, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const out = [...list];
  if (sort === 'name') out.sort(byName);
  else if (sort === 'playtime') out.sort((a, b) => b.playtimeMin - a.playtimeMin || byName(a, b));
  else if (sort === 'size') out.sort((a, b) => b.sizeBytes - a.sizeBytes || byName(a, b));
  else out.sort((a, b) => b.lastPlayed - a.lastPlayed || byName(a, b));
  return out;
}

export function search(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter((g) => {
    const hay = `${g.name} ${g.platform} ${g.platformShort || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export const fmt = {
  ago(sec) {
    if (!sec) return 'Never played';
    const d = Math.floor((Date.now() / 1000 - sec) / 86400);
    if (d <= 0) return 'Played today';
    if (d === 1) return 'Played yesterday';
    if (d < 7) return `Played ${d} days ago`;
    if (d < 60) return `Played ${Math.round(d / 7)} week${Math.round(d / 7) === 1 ? '' : 's'} ago`;
    if (d < 365) return `Played ${Math.round(d / 30)} months ago`;
    return `Played ${new Date(sec * 1000).getFullYear()}`;
  },
  playtime(min) {
    if (!min) return null;
    if (min < 60) return `${min} min played`;
    const hrs = min / 60;
    return `${hrs >= 100 ? Math.round(hrs).toLocaleString() : hrs.toFixed(1)} hrs played`;
  },
  size(bytes) {
    if (!bytes) return null;
    const gb = bytes / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  },
  count(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; },
};

/** "Downloading 43%" and friends, for a game Steam is working on. */
export function downloadLabel(d) {
  if (!d) return '';
  if (d.phase === 'paused') return `Paused at ${d.percent}%`;
  if (d.phase === 'queued') return d.update ? 'Update queued' : 'Download queued';
  if (d.phase === 'installing') return `Installing ${d.percent}%`;
  return `${d.update ? 'Updating' : 'Downloading'} ${d.percent}%`;
}

/** Footer context for a game: title + metadata line. */
export function gameContext(g) {
  if (!g) return null;
  const meta = [g.platformShort || g.platform];
  if (g.status) meta.push({ warn: g.status });
  if (!g.installed) meta.push('Not installed');
  if (g.download) meta.push(downloadLabel(g.download));
  if (g.controller === 'none') meta.push({ warn: 'No controller support' });
  else if (g.controller === 'partial') meta.push('Partial controller support');
  meta.push(fmt.ago(g.lastPlayed));
  const pt = fmt.playtime(g.playtimeMin);
  if (pt) meta.push(pt);
  const size = fmt.size(g.sizeBytes);
  if (size) meta.push(size);
  if (g.tags?.length) meta.push(g.tags.slice(0, 2).join(' · '));
  return { title: g.name, meta, favorite: g.favorite };
}
