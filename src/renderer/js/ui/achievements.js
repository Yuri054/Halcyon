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

export async function openGameAchievements(appid, panelIn = null) {
  const panel = panelIn || openPanel();
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
  const row = (a) => ({
    label: a.achieved || !a.hidden ? a.name : 'Hidden achievement',
    sub: a.achieved || !a.hidden ? a.description || null : 'Keep playing to find out',
    art: [a.achieved ? a.icon : a.iconGray || a.icon].filter(Boolean).map((u) => u.replace(/^https?:\/\/steamcdn-a\.akamaihd\.net\//, 'https://cdn.akamai.steamstatic.com/')),
    iconName: 'star', value: `a:${a.id}`, cls: a.achieved ? 'row--ach is-earned' : 'row--ach',
    hint: a.achieved ? day(a.unlockTime) : a.percent != null ? `${a.percent}%` : '',
  });
  const pct = Math.round((unlocked.length / r.list.length) * 100);
  for (;;) {
    const pick = await panel.ask({
      title: nameOf(appid),
      subtitle: `${unlocked.length} of ${r.list.length} unlocked · ${pct}%${r.stale ? ' · offline, from the last check' : ''}`,
      items: [
        { label: `${unlocked.length} / ${r.list.length}`, value: 'noop', disabled: true, iconName: 'star', meter: pct, sub: 'Achievements' },
        unlocked.length > 0 && { heading: 'Unlocked' },
        ...unlocked.map(row),
        locked.length > 0 && { heading: 'Locked · the most common first' },
        ...locked.map(row),
      ].filter(Boolean),
    });
    if (pick == null) break;
  }
  if (!panelIn) await panel.close();
}

/** Every game with achievements, the ones most recently played first. */
export async function openAchievements() {
  const sums = state.lib.achievements || {};
  const ids = Object.keys(sums).filter((id) => sums[id].total);
  if (!ids.length) {
    toast(state.lib.steamAccount?.hasKey ? 'Halcyon is still collecting them from Steam; try again in a few minutes.' : 'Add your Steam Web API key under Settings › steam to see achievements.', { title: 'Achievements' });
    return;
  }
  const last = (id) => findGame(`steam:${id}`)?.lastPlayed || 0;
  ids.sort((a, b) => last(b) - last(a) || sums[b].unlocked - sums[a].unlocked);
  const total = ids.reduce((n, id) => n + sums[id].unlocked, 0);
  const all = ids.reduce((n, id) => n + sums[id].total, 0);
  const panel = openPanel();
  let selected = null;
  for (;;) {
    const pick = await panel.ask({
      title: 'Achievements',
      subtitle: `${total.toLocaleString()} of ${all.toLocaleString()} unlocked across ${fmt.count(ids.length, 'game')}`,
      selected,
      items: ids.map((id) => {
        const g = findGame(`steam:${id}`);
        const s = sums[id];
        return {
          label: nameOf(id), value: id, verb: 'Open', iconName: 'star',
          art: g ? [...g.art.hero, ...g.art.cover] : [`https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`],
          sub: s.unlocked === s.total ? 'All unlocked' : `${Math.round((s.unlocked / s.total) * 100)}%`,
          hint: `${s.unlocked} / ${s.total}`, meter: Math.round((s.unlocked / s.total) * 100),
        };
      }),
    });
    if (pick == null) break;
    selected = pick;
    await openGameAchievements(pick, panel);
  }
  await panel.close();
}
