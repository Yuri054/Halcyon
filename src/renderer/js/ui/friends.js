// Steam friends: who's online and what they're playing (Settings › Accounts needs a Steam Web
// API key). The list, a friend's options (join their game, play the same game, or open their
// profile or a chat in Steam), and the bits the Guide and the home tile show.
import { api, state, game as findGame, fmt } from '../core/state.js';
import { openPanel, menu } from './dialog.js';
import { toast } from './toast.js';
import { app } from '../core/bus.js';
import { h } from '../core/dom.js';
import { artImg } from './art.js';

let snap = { friends: [], signedIn: false, error: null };
const listeners = new Set();

export async function refreshFriends() {
  const r = await api.friends.list().catch(() => null);
  if (r && r.ok) snap = r;
  for (const fn of listeners) fn(snap);
  return snap;
}
export const friendsNow = () => snap;
export const onFriends = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onlineFriends = () => snap.friends.filter((f) => f.status !== 'offline');

/** "Playing Terraria", "Online", "Away", "Offline · 3 days ago". */
export function friendStatus(f) {
  if (f.status === 'playing') return `Playing ${f.game}`;
  if (f.status === 'offline') return f.lastOnline ? `Offline · ${fmt.ago(f.lastOnline).replace(/^Played /, '')}` : 'Offline';
  return { online: 'Online', busy: 'Busy', away: 'Away', snooze: 'Away' }[f.status] || 'Online';
}

/** One friend as a menu row, with their picture. */
export const friendRow = (f) => ({
  label: f.name, sub: friendStatus(f), value: `friend:${f.id}`, key: `friend:${f.id}`, art: f.avatar ? [f.avatar] : null,
  iconName: 'user', cls: `row--friend row--friend-${f.status}`, verb: 'Options',
});

/** A friend's options: join or play their game, or open them in Steam. */
export async function friendMenu(id, panel = null) {
  const f = snap.friends.find((x) => x.id === id);
  if (!f) return;
  const mine = f.gameId ? findGame(`steam:${f.gameId}`) : null;
  const joinable = Boolean(f.gameId && (f.lobby || f.server));
  const ask = panel ? (o) => panel.ask(o) : menu;
  const pick = await ask({
    title: f.name, subtitle: friendStatus(f), art: f.avatar ? h('div', { class: 'panel__art panel__art--friend' }, artImg([f.avatar], 'panel__art-img', { lazy: false })) : null,
    items: [
      joinable && { label: `Join ${f.game}`, sub: 'Steam joins their game', value: 'join', iconName: 'play' },
      !joinable && mine?.installed && { label: `Play ${f.game}`, sub: 'You have it too', value: 'play', iconName: 'play' },
      !joinable && mine && !mine.installed && { label: `Install ${f.game}`, sub: 'You own it too', value: 'play', iconName: 'download' },
      { label: 'Compare achievements', sub: 'The games you both have, side by side', value: 'compare', iconName: 'trophy' },
      { label: 'Chat in Steam', value: 'chat', iconName: 'pencil' },
      { label: 'View profile in Steam', value: 'profile', iconName: 'user' },
    ].filter(Boolean),
  });
  if (!pick) return;
  if (pick === 'play') { if (panel) await panel.close(); app.launch(mine.id); return 'closed'; }
  if (pick === 'compare') { await compareWith(f, panel); return; }
  const r = await api.friends.open(pick, f.id).catch((err) => ({ ok: false, error: err.message }));
  if (r && r.ok === false) toast(r.error, { type: 'error', title: f.name });
}

/** The whole list: in game, online, then offline. */
export async function openFriends() {
  await refreshFriends();
  if (!snap.signedIn) {
    toast('Add your Steam Web API key under Settings › Steam to see your friends.', { title: 'Friends', iconName: 'user', ms: 6000 });
    return;
  }
  const panel = openPanel();
  panel.el.classList.add('layer--friends');
  let selected = null;
  // Live: a change in who's online redraws the list where it is.
  let changed = false;
  const off = onFriends(() => { changed = true; panel.cancel(); });
  for (;;) {
    const list = snap.friends;
    const playing = list.filter((f) => f.status === 'playing');
    const online = list.filter((f) => f.status !== 'playing' && f.status !== 'offline');
    const offline = list.filter((f) => f.status === 'offline');
    changed = false;
    const pick = await panel.ask({
      title: 'friends',
      subtitle: snap.error ? snap.error : `${playing.length + online.length} of ${list.length} online`,
      selected,
      items: [
        playing.length > 0 && { heading: 'In a game' }, ...playing.map(friendRow),
        online.length > 0 && { heading: 'Online' }, ...online.map(friendRow),
        offline.length > 0 && { heading: 'Offline' }, ...offline.map(friendRow),
        !list.length && { label: snap.error ? 'Couldn’t load your friends' : 'No friends to show', sub: snap.error || 'Your Steam friends appear here', value: 'refresh', iconName: 'refresh' },
      ].filter(Boolean),
    });
    if (changed) { selected = panel.el.querySelector('.row.is-focused')?.itemValue ?? selected; continue; }
    if (pick == null) break;
    selected = pick;
    if (pick === 'refresh') { await api.friends.refresh(); await refreshFriends(); continue; }
    if (pick.startsWith('friend:')) { if (await friendMenu(pick.slice(7), panel) === 'closed') { off(); return; } }
  }
  off();
  await panel.close();
}

/** Toasts when a friend comes online or starts a game. */
export function startFriendNotices() {
  api.on('friends:changed', () => refreshFriends());
  api.on('friends:event', (ev) => {
    const f = ev?.friend;
    if (!f) return;
    if (ev.kind === 'playing') toast(`is now playing ${f.game}`, { title: f.name, iconName: 'user', ms: 5000 });
    else if (ev.kind === 'online') toast('is online', { title: f.name, iconName: 'user', ms: 4000 });
  });
  refreshFriends();
}

export const friendsAvailable = () => Boolean(state.lib?.steamAccount?.hasKey);


// ---- comparing achievements with a friend

// A Steam game is worth 1000G, shared evenly across its achievements (as Halcyon scores them).
const points = (unlocked, total) => (total ? Math.round((1000 / total) * unlocked) : 0);

/**
 * Ask while something loads: shows `loading` until `work` resolves, then asks again with the
 * result. Resolves the person's pick from the loaded list.
 */
async function askAfter(panel, loading, work, build) {
  let result;
  let done = false;
  let waiting = true;   // once B leaves the loading screen, a late answer must not close the next one
  const land = (r) => { result = r; done = true; if (waiting) panel.cancel(); };
  work.then(land, (err) => land({ ok: false, error: err.message }));
  const early = await panel.ask(loading);
  waiting = false;
  if (!done) return { pick: early, result: null };
  return { pick: await panel.ask(build(result)), result };
}

/** The games you both have, each with both your scores; pick one to see it side by side. */
async function compareWith(f, outer) {
  const panel = outer || openPanel();
  let selected = null;
  let cache = null;
  for (;;) {
    const view = (r) => {
      if (!r || !r.ok) return { title: `You and ${f.name}`, subtitle: 'Comparing achievements', items: [{ label: r?.error || 'Couldn’t compare', key: 'none', disabled: true }] };
      const games = r.games;
      return {
        title: `You and ${f.name}`, subtitle: games.length ? `${games.length} games you both play` : 'No games with achievements in common', selected,
        items: games.map((g) => {
          const total = g.them.total;
          const mine = g.you ? points(g.you.unlocked, total) : null;
          const theirs = points(g.them.unlocked, total);
          const lead = mine == null ? '' : mine > theirs ? 'You lead' : mine < theirs ? `${f.name} leads` : 'Tied';
          return {
            label: g.name, value: g.appid, key: `cmp:${g.appid}`, art: gameArt(g.appid), verb: 'Compare',
            sub: `You ${mine == null ? '?' : `${mine}G`}  ·  ${f.name} ${theirs}G`, hint: lead,
          };
        }),
      };
    };
    let pick;
    if (cache) pick = await panel.ask(view(cache));
    else {
      const r = await askAfter(panel, { title: `You and ${f.name}`, subtitle: 'Comparing achievements', items: [{ label: 'Looking through your games…', key: 'wait', disabled: true }] },
        api.friends.sharedGames(f.id).then((x) => (x && x.ok === false && x.error ? x : x?.data || x)), view);
      cache = r.result;
      pick = r.pick;
    }
    if (pick == null) break;
    selected = pick;
    await compareGame(f, pick, panel, cache.games.find((g) => g.appid === pick)?.name);
  }
  if (!outer) await panel.close();
}

function gameArt(appid) {
  const g = findGame(`steam:${appid}`);
  return g ? (g.art.cover.length ? g.art.cover : g.art.hero) : null;
}

/** One game, side by side: what each of you has, grouped. */
async function compareGame(f, appid, panel, name) {
  const view = (r) => {
    if (!r || !r.ok) return { title: name || 'Achievements', subtitle: f.name, items: [{ label: r?.error || 'Couldn’t compare', key: 'none', disabled: true }] };
    const list = r.list;
    const total = list.length;
    const you = list.filter((a) => a.you.achieved).length;
    const them = list.filter((a) => a.them.achieved).length;
    const row = (a) => {
      const secret = a.hidden && !a.you.achieved && !a.them.achieved;
      return {
        label: secret ? 'Secret achievement' : a.name, sub: secret ? 'Keep playing to find out' : a.description || '', key: `a:${a.id}`, value: a.id,
        art: [a.you.achieved ? a.icon : a.iconGray || a.icon].filter(Boolean), cls: 'row--compare',
        hint: `${a.you.achieved ? '✓' : '–'} you   ${a.them.achieved ? '✓' : '–'} ${f.name}`,
      };
    };
    const groups = [
      [`Only ${f.name} has`, list.filter((a) => a.them.achieved && !a.you.achieved)],
      ['Only you have', list.filter((a) => a.you.achieved && !a.them.achieved)],
      ['You both have', list.filter((a) => a.you.achieved && a.them.achieved)],
      ['Neither of you yet', list.filter((a) => !a.you.achieved && !a.them.achieved)],
    ].filter(([, l]) => l.length);
    return {
      title: name || 'Achievements',
      subtitle: `You ${points(you, total)}G (${you}/${total})  ·  ${f.name} ${points(them, total)}G (${them}/${total})`,
      items: groups.flatMap(([heading, l]) => [{ heading }, ...l.map(row)]),
    };
  };
  let { pick, result } = await askAfter(panel, { title: name || 'Achievements', subtitle: f.name, items: [{ label: 'Loading achievements…', key: 'wait', disabled: true }] },
    api.friends.compare(f.id, appid).then((x) => x?.data || x), view);
  // Nothing to do on an achievement itself; B goes back to the games.
  while (pick != null && result) pick = await panel.ask({ ...view(result), selected: pick });
}
