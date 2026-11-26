// Achievements from Steam and RetroAchievements: a game's list (unlocked first, newest first;
// then locked, the most common first; Steam's hidden ones stay hidden until earned), and an
// overview of every game with achievements, laid out like the 360's. Opened from a game's
// options, the Guide, a home tile and the profile corner.
//
// Scores: Steam has no points, so a Steam game counts like a 360 retail game, 1,000 G shared
// equally among its achievements. RetroAchievements has real points, used as they are.
import { h } from '../core/dom.js';
import { api, state, game as findGame } from '../core/state.js';
import { openPanel } from './dialog.js';
import { toast } from './toast.js';

/** The console's header over a full-screen list: the profile picture in the middle, the clock right. */
export function consoleHeader(panel) {
  if (panel.el.querySelector('.xhead')) return;
  const p = state.lib.steamProfile;
  const clock = h('div', { class: 'xhead__clock' });
  panel.el.append(h('div', { class: 'xhead' }, p?.avatar ? h('div', { class: 'xhead__pic' }, h('img', { src: p.avatar, alt: '' })) : '', clock));
  const show = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  show();
  const t = setInterval(() => { if (!clock.isConnected) clearInterval(t); else show(); }, 10000);
}

const day = (sec) => new Date(sec * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const nameOf = (appid) => findGame(`steam:${appid}`)?.name || `Steam app ${appid}`;
const steamSums = () => state.lib.achievements || {};
const retroSums = () => state.lib.retroGames || {};

/** "81 / 137" for a Steam game, from the summaries, or ''. */
export function achievementLine(appid) {
  const s = steamSums()[String(appid)];
  return s && s.total ? `${s.unlocked} / ${s.total}` : '';
}

/** Every unlocked achievement across the games Halcyon knows about. */
export function achievementTotal() {
  return [...Object.values(steamSums()), ...Object.values(retroSums())].reduce((n, s) => n + (s.unlocked || 0), 0);
}

/** A Steam game's score: 1,000 G, earned in step with the share of its achievements unlocked. */
export const gameScore = (s) => (s && s.total ? Math.round((s.unlocked / s.total) * 1000) : 0);
/** The whole score: Steam games' shares plus RetroAchievements points. */
export function gamerscore() {
  return Object.values(steamSums()).reduce((n, s) => n + gameScore(s), 0) + Object.values(retroSums()).reduce((n, s) => n + (s.earned || 0), 0);
}

// ------------------------------------------------- matching ROMs to RetroAchievements

/** Titles compared loosely: no region tags, no "The", no punctuation ("Legend of Zelda, The - …"). */
const norm = (s) => String(s || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/~[^~]*~/g, '').toLowerCase().replace(/\bthe\b/g, '').replace(/[^a-z0-9]/g, '');
/** The RetroAchievements game for a ROM in the library, if they share a title: its id, or null. */
export function retroFor(g) {
  if (!g || g.source !== 'emulator') return null;
  const want = norm(g.originalName || g.name);
  if (!want) return null;
  const hit = Object.entries(retroSums()).find(([, s]) => norm(s.title) === want);
  return hit ? hit[0] : null;
}
/** The ROM in the library for a RetroAchievements game, or null. */
function romFor(s) {
  const want = norm(s.title);
  return state.lib.games.find((g) => g.source === 'emulator' && norm(g.originalName || g.name) === want) || null;
}

// ------------------------------------------------------------------ a game

async function showGame(panel, { title, list, points, score, extra = '', stale = false }) {
  const unlocked = list.filter((a) => a.achieved).sort((a, b) => b.unlockTime - a.unlockTime);
  const locked = list.filter((a) => !a.achieved).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const row = (a) => ({
    label: a.achieved || !a.hidden ? a.name : 'Secret achievement',
    sub: [a.achieved ? `Unlocked ${day(a.unlockTime)}${a.hardcore ? ' (hardcore)' : ''}` : a.percent != null ? `${a.percent}% of players have it` : null,
      a.achieved || !a.hidden ? a.description : 'Keep playing to unlock this secret achievement'].filter(Boolean).join('  ·  '),
    art: [a.achieved ? a.icon : a.iconGray || a.icon].filter(Boolean).map((u) => u.replace(/^https?:\/\/steamcdn-a\.akamaihd\.net\//, 'https://cdn.akamai.steamstatic.com/')),
    iconName: 'star', value: `a:${a.id}`, cls: `row--ach row--achpts${a.achieved ? ' is-earned' : ' is-locked'}`,
    hint: String(points(a)),
  });
  for (;;) {
    const pick = await panel.ask({
      title,
      subtitle: [`${unlocked.length} of ${list.length} Achievements`, `${score.toLocaleString()} G`, extra, stale && 'offline, from the last check'].filter(Boolean).join('  ·  '),
      items: [...unlocked.map(row), ...locked.map(row)],
    });
    if (pick == null) break;
  }
}

export async function openGameAchievements(appid, panelIn = null) {
  const panel = panelIn || openPanel();
  panel.el.classList.add('layer--achlist');
  consoleHeader(panel);
  const r = await api.achievements.game(String(appid), { refresh: true });
  if (!r || !r.ok || !r.list.length) {
    if (!panelIn) await panel.close();
    toast(!r || !r.ok ? r?.error || 'Steam didn’t answer.' : `${nameOf(appid)} has no Steam achievements.`, { type: !r || !r.ok ? 'error' : 'info', title: 'Achievements' });
    return;
  }
  // Each achievement's equal share of the game's 1,000 G.
  const share = Math.round(1000 / r.list.length);
  await showGame(panel, { title: nameOf(appid), list: r.list, points: () => share, score: gameScore(r), stale: r.stale });
  if (!panelIn) await panel.close();
}

export async function openRetroAchievements(id, panelIn = null) {
  const panel = panelIn || openPanel();
  panel.el.classList.add('layer--achlist');
  consoleHeader(panel);
  const r = await api.retro.game(String(id), { refresh: true });
  if (!r || !r.ok || !r.list.length) {
    if (!panelIn) await panel.close();
    toast(!r || !r.ok ? r?.error || 'RetroAchievements didn’t answer.' : 'This game has no RetroAchievements yet.', { type: !r || !r.ok ? 'error' : 'info', title: 'RetroAchievements' });
    return;
  }
  await showGame(panel, { title: r.title, list: r.list, points: (a) => a.points, score: r.earned, extra: r.console, stale: r.stale });
  if (!panelIn) await panel.close();
}

// -------------------------------------------------------------- every game

/** One list entry per game with achievements, from either source. */
function entries() {
  const steam = Object.entries(steamSums()).filter(([, s]) => s.total).map(([id, s]) => {
    const g = findGame(`steam:${id}`);
    return {
      key: `steam:${id}`, name: nameOf(id), unlocked: s.unlocked, total: s.total, score: gameScore(s), installed: Boolean(g?.installed), last: g?.lastPlayed || 0,
      art: g ? [...g.art.cover, ...g.art.hero] : [`https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`, `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`],
      open: (panel) => openGameAchievements(id, panel),
    };
  });
  const retro = Object.entries(retroSums()).filter(([, s]) => s.total).map(([id, s]) => {
    const rom = romFor(s);
    return {
      key: `ra:${id}`, name: s.title, console: s.console, unlocked: s.unlocked, total: s.total, score: s.earned || 0, installed: Boolean(rom),
      last: Math.max(s.lastPlayed || 0, rom?.lastPlayed || 0), art: [...(rom ? rom.art.cover : []), s.icon].filter(Boolean),
      open: (panel) => openRetroAchievements(id, panel),
    };
  });
  return [...steam, ...retro];
}

/**
 * Every game with achievements, laid out like the 360's Achievements list: a row per game with
 * its picture, "3 of 12 Achievements" and its score. X switches between installed games and all
 * of them (remembered).
 */
export async function openAchievements() {
  const all = entries();
  if (!all.length) {
    toast(state.lib.steamAccount?.hasKey || state.lib.retro ? 'Halcyon is still collecting them; try again in a few minutes.'
      : 'Add your Steam Web API key (Settings › steam) or sign in to RetroAchievements (Settings › library) to see achievements.', { title: 'Achievements' });
    return;
  }
  const installedOnly = () => state.lib.settings.achievementsInstalled === true;
  const panel = openPanel();
  panel.el.classList.add('layer--achlist');
  consoleHeader(panel);
  let selected = null;
  for (;;) {
    const list = entries().filter((e) => !installedOnly() || e.installed).sort((a, b) => b.last - a.last || b.score - a.score);
    const score = list.reduce((n, e) => n + e.score, 0);
    const unlocked = list.reduce((n, e) => n + e.unlocked, 0);
    const possible = list.reduce((n, e) => n + e.total, 0);
    let flip = false;
    const pick = await panel.ask({
      title: 'Achievements',
      subtitle: `${score.toLocaleString()} G  ·  ${unlocked.toLocaleString()} of ${possible.toLocaleString()} Achievements  ·  ${installedOnly() ? 'installed games' : 'all games'}`,
      selected,
      onAction: (action) => { if (action !== 'x') return false; flip = true; panel.cancel(); return true; },
      hints: [{ a: 'x', label: installedOnly() ? 'Show all games' : 'Installed games only' }],
      items: [
        ...list.map((e) => ({
          label: e.name, value: e.key, verb: 'Open', iconName: 'pad', cls: 'row--achgame', art: e.art,
          sub: `${e.unlocked} of ${e.total} Achievements${e.console ? `  ·  ${e.console}` : ''}`, hint: e.score.toLocaleString(),
        })),
        !list.length && { label: 'No installed games with achievements yet', value: 'noop', disabled: true, sub: 'Press X to show all games' },
      ].filter(Boolean),
    });
    if (flip) { await api.settings.set({ achievementsInstalled: !installedOnly() }); continue; }
    if (pick == null) break;
    selected = pick;
    const e = entries().find((x) => x.key === pick);
    if (e) await e.open(panel);
  }
  await panel.close();
}
