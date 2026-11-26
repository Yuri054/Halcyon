// Steam achievements: a game's list (unlocked first, newest first; then locked, the most
// common first; hidden ones stay hidden until earned), and an overview of every game with
// achievements. Opened from a game's options, the Guide's home tile and the profile corner.
import { api, state, game as findGame, fmt } from '../core/state.js';
import { openPanel } from './dialog.js';
import { toast } from './toast.js';

const day = (sec) => new Date(sec * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const nameOf = (appid) => findGame(`steam:${appid}`)?.name || `Steam app ${appid}`;

/** "81 / 137" for a game, from the summaries, or ''. */
export function achievementLine(appid) {
  const s = (state.lib.achievements || {})[String(appid)];
  return s && s.total ? `${s.unlocked} / ${s.total}` : '';
}

/** Every unlocked achievement across the games Halcyon knows about. */
export function achievementTotal() {
  return Object.values(state.lib.achievements || {}).reduce((n, s) => n + (s.unlocked || 0), 0);
}

/**
 * A 360-style score: like a retail 360 game, each game is worth 1,000 G, earned in step with
 * the share of its achievements unlocked. (Steam has no points of its own.)
 */
export const gameScore = (s) => (s && s.total ? Math.round((s.unlocked / s.total) * 1000) : 0);
export function gamerscore() {
  return Object.values(state.lib.achievements || {}).reduce((n, s) => n + gameScore(s), 0);
}

export async function openGameAchievements(appid, panelIn = null) {
  const panel = panelIn || openPanel();
  panel.el.classList.add('layer--achlist');
  const r = await api.achievements.game(String(appid), { refresh: true });
  if (!r || !r.ok) {
    if (!panelIn) await panel.close();
    toast(r?.error || 'Steam didn’t answer.', { type: 'error', title: 'Achievements' });
    return;
  }
  if (!r.list.length) {
    if (!panelIn) await panel.close();
    toast(`${nameOf(appid)} has no Steam achievements.`, { title: 'Achievements' });
    return;
  }
  const unlocked = r.list.filter((a) => a.achieved).sort((a, b) => b.unlockTime - a.unlockTime);
  const locked = r.list.filter((a) => !a.achieved).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  // Each achievement's share of the game's 1,000 G (so the game's score is the sum of its unlocks).
  const points = Math.round(1000 / r.list.length);
  const row = (a) => ({
    label: a.achieved || !a.hidden ? a.name : 'Secret achievement',
    sub: [a.achieved ? `Unlocked ${day(a.unlockTime)}` : a.percent != null ? `${a.percent}% of players have it` : null,
      a.achieved || !a.hidden ? a.description : 'Keep playing to unlock this secret achievement'].filter(Boolean).join('  ·  '),
    art: [a.achieved ? a.icon : a.iconGray || a.icon].filter(Boolean).map((u) => u.replace(/^https?:\/\/steamcdn-a\.akamaihd\.net\//, 'https://cdn.akamai.steamstatic.com/')),
    iconName: 'star', value: `a:${a.id}`, cls: `row--ach row--achpts${a.achieved ? ' is-earned' : ' is-locked'}`,
    hint: String(points),
  });
  const score = gameScore({ unlocked: unlocked.length, total: r.list.length });
  for (;;) {
    const pick = await panel.ask({
      title: nameOf(appid),
      subtitle: `${unlocked.length} of ${r.list.length} Achievements  ·  ${score.toLocaleString()} G${r.stale ? '  ·  offline, from the last check' : ''}`,
      items: [...unlocked.map(row), ...locked.map(row)],
    });
    if (pick == null) break;
  }
  if (!panelIn) await panel.close();
}

/**
 * Every game with achievements, laid out like the 360's Achievements list: a row per game with
 * its picture, "3 of 12 Achievements" and its score; a summary row on top. X switches between
 * installed games and all of them (remembered).
 */
export async function openAchievements() {
  const sums = state.lib.achievements || {};
  const all = Object.keys(sums).filter((id) => sums[id].total);
  if (!all.length) {
    toast(state.lib.steamAccount?.hasKey ? 'Halcyon is still collecting them from Steam; try again in a few minutes.' : 'Add your Steam Web API key under Settings › steam to see achievements.', { title: 'Achievements' });
    return;
  }
  const last = (id) => findGame(`steam:${id}`)?.lastPlayed || 0;
  const installedOnly = () => state.lib.settings.achievementsInstalled === true;
  const panel = openPanel();
  panel.el.classList.add('layer--achlist');
  let selected = null;
  for (;;) {
    const ids = all.filter((id) => !installedOnly() || findGame(`steam:${id}`)?.installed)
      .sort((a, b) => last(b) - last(a) || gameScore(sums[b]) - gameScore(sums[a]));
    const score = ids.reduce((n, id) => n + gameScore(sums[id]), 0);
    const unlocked = ids.reduce((n, id) => n + sums[id].unlocked, 0);
    const possible = ids.reduce((n, id) => n + sums[id].total, 0);
    let flip = false;
    const pick = await panel.ask({
      title: 'Achievements',
      subtitle: `${score.toLocaleString()} G  ·  ${unlocked.toLocaleString()} of ${possible.toLocaleString()} Achievements  ·  ${installedOnly() ? 'installed games' : 'all games'}`,
      selected,
      onAction: (action) => { if (action !== 'x') return false; flip = true; panel.cancel(); return true; },
      hints: [{ a: 'x', label: installedOnly() ? 'Show all games' : 'Installed games only' }],
      items: [
        ...ids.map((id) => {
          const g = findGame(`steam:${id}`);
          const s = sums[id];
          return {
            label: nameOf(id), value: id, verb: 'Open', iconName: 'pad', cls: 'row--achgame',
            art: g ? [...g.art.cover, ...g.art.hero] : [`https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`, `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`],
            sub: `${s.unlocked} of ${s.total} Achievements`, hint: gameScore(s).toLocaleString(),
          };
        }),
        !ids.length && { label: 'No installed games with achievements yet', value: 'noop', disabled: true, sub: 'Press X to show all games' },
      ].filter(Boolean),
    });
    if (flip) { await api.settings.set({ achievementsInstalled: !installedOnly() }); continue; }
    if (pick == null) break;
    selected = pick;
    await openGameAchievements(pick, panel);
  }
  await panel.close();
}
