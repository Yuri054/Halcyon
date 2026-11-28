// The Guide: opens from anywhere on the Home/Guide button. Like the console's,
// it is a set of blades you move between with left/right (or LB/RB): games &
// apps, home, downloads and settings. Each blade is a short list; the others
// sit beside it as labelled spines.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api, state, visibleGames, sortGames, fmt } from '../core/state.js';
import { app } from '../core/bus.js';
import { openPanel } from './dialog.js';
import { toast } from './toast.js';
import { volumeRow } from './volume.js';
import { nowPlaying } from '../media/player.js';
import { gamerscore } from './achievements.js';
import { refreshFriends, friendsNow, onlineFriends, friendRow, friendMenu } from './friends.js';
import { snapshot as downloadSnapshot, downloadCard, nameOf } from './downloads.js';

let active = null;   // { panel, dead }

export const isOpen = () => Boolean(active);

export function closeGuide() {
  if (!active) return;
  active.dead = true;
  active.panel.cancel();
}

const POWER = {
  suspend: { label: 'Sleep', iconName: 'moon', title: 'Sleep now?', subtitle: 'The system suspends and picks up where it left off when you wake it.', done: 'Going to sleep' },
  restart: { label: 'Restart', iconName: 'restart', title: 'Restart the system?', subtitle: 'Anything still running will be closed.', done: 'Restarting' },
  shutdown: { label: 'Shut down', iconName: 'power', title: 'Shut down the system?', subtitle: 'Anything still running will be closed.', done: 'Shutting down' },
  exit: { label: 'Exit to desktop', iconName: 'exit', title: 'Exit to desktop?', subtitle: 'Halcyon will close. Running games are not affected.' },
};

const BLADES = { games: 'games & apps', home: 'home', friends: 'friends', downloads: 'downloads', system: 'settings' };

/** Which blade an initial selection belongs to. */
const bladeFor = (select) => (!select ? 'home' : select.startsWith('power:') || select === 'volume' ? 'system' : select.startsWith('play:') ? 'games' : 'home');

export async function openGuide({ select = null } = {}) {
  if (active) return;
  // Over a dialog, keyboard or picker the Guide only offers system controls (and the
  // running game), so nothing navigates away underneath an unfinished task.
  const overTask = focus.top() !== focus.base();
  const panel = openPanel({ side: 'left', silent: true });
  panel.el.classList.add('layer--guide');
  const me = { panel, dead: false };
  active = me;
  sfx.guide();

  const status = await api.system.status().catch(() => null);
  const playing = status?.nowPlaying || [];
  const volume = volumeRow(panel, status);

  // Downloads: a live card for whatever Steam is downloading, kept moving while the Guide is open.
  const steamHere = state.lib.steam.installs.length > 0;
  let dl = steamHere ? await downloadSnapshot().catch(() => null) : null;
  const card = downloadCard({ compact: true });
  if (dl) card.update(dl.active, dl.paused);
  let ticking = false;
  const ticker = dl ? setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { dl = await downloadSnapshot(); card.update(dl.active, dl.paused); } catch { /* keep the last values */ }
    ticking = false;
  }, 1000) : null;

  // ---- frame: spines either side of the open blade, and a clock in the corner
  const frame = panel.el.querySelector('.panel');
  const list = panel.el.querySelector('.panel__list');
  const left = h('div', { class: 'guide__blades guide__blades--left' });
  const spine = h('div', { class: 'guide__spine' });
  const right = h('div', { class: 'guide__blades guide__blades--right' });
  const body = h('div', { class: 'guide__body' });
  list.replaceWith(body);
  body.append(left, spine, list, right);
  const time = h('span', { class: 'guide__time' });
  const pads = h('span', { class: 'guide__pads' });
  frame.append(h('div', { class: 'guide__status' }, pads, time));
  // The profile picture between the title and the clock, as on the console.
  if (state.lib.steamProfile?.avatar) frame.append(h('div', { class: 'guide__pic' }, h('img', { src: state.lib.steamProfile.avatar, alt: '' })));
  const paintStatus = () => {
    time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    pads.replaceChildren(...(state.pads.length ? [icon('pad', 'guide__pad')] : []));
  };
  paintStatus();
  const clock = setInterval(paintStatus, 10000);

  const friendsOn = Boolean(state.lib.steamAccount?.hasKey);
  if (friendsOn) await refreshFriends().catch(() => {});
  const blades = overTask
    ? [playing.some((p) => p.quittable) && 'home', friendsOn && 'friends', 'system'].filter(Boolean)
    : ['games', 'home', friendsOn && 'friends', steamHere && 'downloads', 'system'].filter(Boolean);
  let blade = blades.includes(bladeFor(select)) ? bladeFor(select) : blades.includes('home') ? 'home' : blades[0];

  let switchTo = null;
  function goBlade(next) {
    if (!next || next === blade) return false;
    switchTo = next;
    panel.cancel();
    return true;
  }
  function paintBlades() {
    const i = blades.indexOf(blade);
    const spineOf = (id) => {
      const b = h('div', { class: 'guide__blade', 'data-blade': id }, h('span', null, BLADES[id]));
      b.addEventListener('click', () => goBlade(id));
      return b;
    };
    left.replaceChildren(...blades.slice(0, i).map(spineOf));
    right.replaceChildren(...blades.slice(i + 1).map(spineOf));
    spine.replaceChildren(h('span', null, BLADES[blade]));
    panel.el.dataset.blade = blade;
  }

  // ---- the blades' contents
  function items() {
    if (blade === 'home') {
      const busy = dl ? dl.queue.length + dl.scheduled.length + dl.waiting.length + (dl.active ? 1 : 0) : 0;
      return [
        ...playing.flatMap((p) => {
          return [
            { label: `Resume ${p.name}`, value: `resume:${p.id}`, key: `resume:${p.id}`, iconName: 'play', verb: 'Resume' },
            { label: p.app ? `Close ${p.name}` : 'Quit game', value: `quit:${p.id}`, key: `quit:${p.id}`, iconName: 'exit', danger: true, verb: p.app ? 'Close' : 'Quit' },
          ];
        }),
        !overTask && nowPlaying() && { label: nowPlaying().title, sub: 'Now playing', value: 'np:show', key: 'np:show', iconName: 'music', verb: 'Show' },
        !overTask && nowPlaying() && { label: nowPlaying().paused() ? 'Play music' : 'Pause music', value: 'np:toggle', key: 'np:toggle', iconName: nowPlaying().paused() ? 'play' : 'pause' },
        !overTask && { label: 'Halcyon Home', value: 'go:home', key: 'go:home', iconName: 'home' },
        !overTask && steamHere && { label: 'Downloads', value: 'downloads', key: 'downloads', iconName: 'download', hint: String(busy) },
        !overTask && { label: 'Storage', value: 'storage', key: 'storage', iconName: 'folder' },
        !overTask && { label: 'Search games', value: 'search', key: 'search', iconName: 'search' },
        !overTask && { label: 'TV & movies', value: 'go:tv', key: 'go:tv', iconName: 'film' },
        !overTask && { label: 'Music', value: 'go:music', key: 'go:music', iconName: 'music' },
        status?.bigPictureOpen && { label: 'Close Steam Big Picture', value: 'leavebpm', key: 'leavebpm', iconName: 'screen' },
        !overTask && steamHere && !status?.bigPictureOpen && { label: 'Steam Big Picture', value: 'openbpm', key: 'openbpm', iconName: 'pad', verb: 'Open' },
      ];
    }
    if (blade === 'games') {
      const recent = sortGames(visibleGames().filter((g) => g.installed), 'recent').filter((g) => g.lastPlayed).slice(0, 4);
      return [
        !overTask && gamerscore() > 0 && { label: 'Achievements', value: 'achievements', key: 'achievements', cls: 'row--gs', hint: gamerscore().toLocaleString() },
        ...recent.map((g) => ({ label: g.name, value: `play:${g.id}`, key: `play:${g.id}`, iconName: 'play', hint: fmt.ago(g.lastPlayed).replace(/^Played /, ''), verb: 'Play' })),
        { label: 'All games', value: 'go:games', key: 'go:games', iconName: 'grid', hint: String(visibleGames().length) },
        { label: 'Emulators & systems', value: 'go:systems', key: 'go:systems', iconName: 'chip' },
      ];
    }
    if (blade === 'friends') {
      // Who's on: in a game first, then online; the whole list from the last row.
      const on = onlineFriends();
      const all = friendsNow().friends;
      return [
        ...on.slice(0, 6).map(friendRow),
        !on.length && { label: friendsNow().error || 'No friends online', key: 'fnone', disabled: true },
        { label: 'All friends', value: 'friends', key: 'friends', iconName: 'user', hint: `${on.length} / ${all.length}`, verb: 'Open' },
      ];
    }
    if (blade === 'downloads') {
      const showCard = Boolean(dl && (dl.active || dl.paused));
      const next = dl ? [...dl.queue.map((i, n) => ({ appid: i.appid, hint: `#${n + 1}` })), ...dl.scheduled.map((i) => ({ appid: i.appid, hint: 'later' })),
        ...dl.waiting.map((g) => ({ appid: g.id.slice(6), hint: 'ready' }))] : [];
      return [
        showCard ? { card: card.el, value: 'downloads', key: 'dlcard', verb: 'Manage', cls: 'row--dlcard' }
          : { label: 'Nothing downloading', key: 'dlnone', disabled: true },
        ...next.slice(0, 3).map((n) => ({ label: nameOf(n.appid), value: 'downloads', key: `dlq:${n.appid}`, iconName: 'download', hint: n.hint, verb: 'Manage' })),
        { label: next.length > 3 ? `Manage all ${next.length} downloads` : 'Manage downloads', value: 'downloads', key: 'dlmanage', iconName: 'layers' },
      ];
    }
    // settings
    return [
      volume.item(),
      { label: playing.length ? 'Move game to another screen' : 'Move to another screen', value: 'movescreen', key: 'movescreen', iconName: 'screen', verb: 'Choose' },
      !overTask && { label: 'Settings', value: 'go:settings', key: 'go:settings', iconName: 'gear' },
      ...Object.entries(POWER).map(([id, p]) => ({ label: p.label, value: `power:${id}`, key: `power:${id}`, iconName: p.iconName, danger: id === 'exit' })),
    ];
  }

  function onAction(action, target, finish) {
    if (volume.onAction(action, target, finish)) return true;
    const i = blades.indexOf(blade);
    if (action === 'lb' || action === 'left') { if (!goBlade(blades[i - 1])) sfx.edge(); return true; }
    if (action === 'rb' || action === 'right') { if (!goBlade(blades[i + 1])) sfx.edge(); return true; }
    if (action === 'y' && !overTask) { switchTo = '@home'; panel.cancel(); return true; }
    return false;
  }

  const header = { title: 'guide', subtitle: new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) };

  let after = null;
  let selected = select;
  while (!me.dead) {
    paintBlades();
    panel.el.classList.remove('is-confirming');
    switchTo = null;
    const pick = await panel.ask({
      ...header, items: items(), selected, onAction,
      hints: overTask ? [] : [{ a: 'y', label: 'Halcyon Home' }],
    });
    if (switchTo === '@home') { after = () => app.go('home', { enter: true }); break; }
    if (switchTo) {
      const dir = blades.indexOf(switchTo) > blades.indexOf(blade) ? 'right' : 'left';
      blade = switchTo;
      selected = null;
      sfx.section(dir);
      flash(list, `guide-from-${dir}`, 400);
      continue;
    }
    if (pick == null) break;
    selected = pick;

    if (pick.startsWith('resume:')) { after = () => api.game.resume(); break; }
    if (pick.startsWith('quit:')) {
      const id = pick.slice(5);
      const name = playing.find((p) => p.id === id)?.name || 'this game';
      // An app (YouTube) closes without asking: nothing is lost.
      if (playing.find((p) => p.id === id)?.app) { await api.game.quit(id); break; }
      panel.el.classList.add('is-confirming');
      const sure = await panel.ask({
        title: `Quit ${name}?`, subtitle: 'Anything the game has not saved will be lost.', selected: 'yes',
        items: [{ label: 'Quit game', value: 'yes', iconName: 'exit', danger: true }, { label: 'Keep playing', value: 'no', iconName: 'play' }],
      });
      if (sure == null) continue;
      if (sure === 'no') { after = () => api.game.resume(); break; }
      const result = await api.game.quit(id);
      if (!result.ok) toast(result.error, { type: 'error', title: 'Couldn’t quit the game' });
      break;
    }
    if (pick.startsWith('play:')) { after = () => app.launch(pick.slice(5)); break; }
    if (pick.startsWith('go:')) { after = () => app.go(pick.slice(3), { enter: true }); break; }
    if (pick === 'openbpm') { const r = await api.steam.openBigPicture(); if (r && r.ok === false) toast(r.error, { type: 'error' }); else toast('Opening Big Picture', { iconName: 'pad', ms: 2000 }); break; }
    if (pick === 'leavebpm') { const r = await api.steam.leaveBigPicture(); if (r && r.ok === false) toast(r.error, { type: 'error' }); break; }
    if (pick === 'search') { after = () => app.search(); break; }
    if (pick === 'np:show') { after = () => nowPlaying()?.show(); break; }
    if (pick === 'np:toggle') { nowPlaying()?.toggle(); continue; }
    if (pick === 'downloads') { after = () => app.downloads(); break; }
    if (pick === 'storage') { after = () => app.storage(); break; }
    if (pick === 'movescreen') {
      const list = (await api.system.displays().catch(() => [])) || [];
      const where = await panel.ask({
        title: playing.length ? 'Move game to' : 'Move to',
        subtitle: playing.length ? 'Halcyon and the game move together' : 'Halcyon moves to that screen',
        items: list.map((d) => ({ label: d.name, value: d.label, iconName: 'screen', checked: d.current, disabled: d.current,
          sub: [d.port, `${d.width} × ${d.height}`, d.current && 'here now'].filter(Boolean).join(' · ') })),
      });
      if (!where) continue;
      const r = await api.system.moveToScreen(where);
      if (r && r.ok === false) { toast(r.error, { type: 'error', title: 'Move to another screen' }); continue; }
      if (playing.length && r && r.game && !r.gameMoved) toast('Halcyon moved, but the game window didn’t.', { type: 'error', title: 'Move to another screen' });
      after = () => (playing.length ? api.game.resume() : null);
      break;
    }
    if (pick === 'achievements') { after = () => app.achievements(); break; }
    if (pick === 'friends') { after = () => app.friends(); break; }
    if (pick.startsWith('friend:')) { await friendMenu(pick.slice(7), panel); continue; }

    if (pick.startsWith('power:')) {
      const id = pick.slice(6);
      const p = POWER[id];
      panel.el.classList.add('is-confirming');
      const sure = await panel.ask({
        title: p.title, subtitle: p.subtitle, selected: 'no',
        items: [{ label: p.label, value: 'yes', iconName: p.iconName, danger: true }, { label: 'Cancel', value: 'no', iconName: 'up' }],
      });
      if (sure !== 'yes') continue;
      if (id === 'exit') { api.app.quit(); break; }
      const result = await api.system.power(id);
      if (!result.ok) toast(result.error, { type: 'error', title: `Couldn’t ${p.label.toLowerCase()}` });
      else toast(result.dryRun ? 'Dry run: nothing was sent to the system.' : 'See you soon.', { title: p.done, iconName: p.iconName });
      break;
    }
  }

  if (ticker) clearInterval(ticker);
  clearInterval(clock);
  active = null;
  await panel.close();
  if (after) after();
}

