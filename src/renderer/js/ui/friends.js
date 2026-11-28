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
      { label: 'Chat in Steam', value: 'chat', iconName: 'pencil' },
      { label: 'View profile in Steam', value: 'profile', iconName: 'user' },
    ].filter(Boolean),
  });
  if (!pick) return;
  if (pick === 'play') { if (panel) await panel.close(); app.launch(mine.id); return 'closed'; }
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
