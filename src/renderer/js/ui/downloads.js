// The download manager: Steam's download queue with a live progress card for the
// game downloading now, pause / resume / reorder / remove, and "update now" for
// updates Steam has scheduled for later. It works through Steam's own download
// controls; without them it still shows progress, read from Steam's files.
import { h, icon } from '../core/dom.js';
import { api, state, game as findGame, downloadLabel } from '../core/state.js';
import { openPanel, menu } from './dialog.js';
import { artImg } from './art.js';
import { toast } from './toast.js';

const TICK_MS = 1000;

// ------------------------------------------------------------------ naming

const names = new Map();     // appid -> name, for apps that are not in the library
const asked = new Set();
let onNamed = null;

/** A game's name; apps outside the library are looked up once in the Steam store. */
export function nameOf(appid) {
  const g = findGame(`steam:${appid}`);
  if (g) return g.name;
  if (names.has(appid)) return names.get(appid);
  if (!asked.has(appid)) {
    asked.add(appid);
    api.store.details(appid).then((r) => { if (r && r.ok && r.data.name) { names.set(appid, r.data.name); if (onNamed) onNamed(); } }).catch(() => {});
  }
  return `Steam app ${appid}`;
}

/** Landscape artwork for a download: the game's own, else Steam's header image. */
export function artFor(appid) {
  const g = findGame(`steam:${appid}`);
  const cdn = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
  return g ? [...g.art.hero, ...g.art.cover, cdn] : [cdn];
}

// -------------------------------------------------------------- formatting

export function bytes(n) {
  if (!n) return '0 MB';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}
const speed = (bps) => (bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : bps > 0 ? `${Math.round(bps / 1024)} KB/s` : '');
function timeLeft(sec) {
  if (!(sec >= 0)) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s left`;
  if (sec < 3600) return `${Math.round(sec / 60)} min left`;
  const hrs = Math.floor(sec / 3600);
  return `${hrs} h ${Math.round((sec % 3600) / 60)} min left`;
}

// ------------------------------------------------------------------- data

/**
 * Everything the menus show, from Steam when its controls are on, otherwise from
 * the manifests. active: { appid, name, state, percent, line } | null.
 */
export async function snapshot() {
  const st = await api.downloads.status().catch(() => ({ ok: false }));
  const busy = state.lib.games.filter((g) => g.source === 'steam' && g.download);
  if (st.connected) {
    const a = st.active;
    const items = st.items || [];
    return {
      connected: true, enabled: true, paused: st.paused,
      active: a ? {
        appid: a.appid, name: nameOf(a.appid), percent: a.percent,
        state: st.paused ? 'Paused' : a.state === 'Updating' || a.state === 'Downloading' ? (a.install ? 'Installing' : 'Updating') : a.state || 'Working',
        line: [a.toDownload ? `${bytes(a.downloaded)} of ${bytes(a.toDownload)}` : '', speed(a.rate), st.paused ? '' : timeLeft(a.eta)].filter(Boolean).join('  ·  '),
      } : null,
      // Paused downloads (no place in Steam's queue) after the ones still waiting their turn.
      queue: items.filter((i) => !i.completed && !i.scheduled && !(a && i.appid === a.appid)).sort((x, y) => (x.position < 0) - (y.position < 0) || x.position - y.position),
      scheduled: items.filter((i) => i.scheduled),
      finished: items.filter((i) => i.completed && !(a && i.appid === a.appid)),
      waiting: busy.filter((g) => g.download.update && !items.some((i) => i.appid === g.id.slice(6))),
      error: null,
    };
  }
  // Read-only: the manifests say what Steam is doing, a few seconds behind.
  const now = busy.find((g) => g.download.phase === 'downloading' || g.download.phase === 'installing');
  return {
    connected: false, enabled: Boolean(st.enabled), paused: false,
    active: now ? {
      appid: now.id.slice(6), name: now.name, percent: now.download.percent, state: downloadLabel(now.download).replace(/ \d+%$/, ''),
      line: now.download.total ? `${bytes(now.download.done)} of ${bytes(now.download.total)}` : '',
    } : null,
    queue: busy.filter((g) => g !== now).map((g) => ({ appid: g.id.slice(6), position: -1, paused: g.download.phase === 'paused', readOnly: true })),
    scheduled: [], finished: [], waiting: [],
    error: st.enabled ? st.error || 'Steam is not answering.' : null,
  };
}

// ------------------------------------------------------------------- card

/** The big "downloading now" card. Call update(active, paused) to move it along. */
export function downloadCard({ compact = false } = {}) {
  const art = h('div', { class: 'dlcard__art' });
  const title = h('div', { class: 'dlcard__title' });
  const status = h('div', { class: 'dlcard__status' });
  const pct = h('div', { class: 'dlcard__pct' });
  const fill = h('i');
  const line = h('div', { class: 'dlcard__line' });
  const el = h('div', { class: `dlcard${compact ? ' dlcard--compact' : ''}` }, art,
    h('div', { class: 'dlcard__body' },
      h('div', { class: 'dlcard__top' }, h('div', null, status, title), pct),
      h('div', { class: 'dlcard__bar' }, fill),
      line));
  let shownApp = null;

  function update(active, paused = false) {
    el.classList.toggle('is-idle', !active);
    el.classList.toggle('is-paused', Boolean(paused));
    if (!active) {
      if (shownApp !== null) { shownApp = null; art.replaceChildren(icon('download', 'dlcard__icon')); }
      if (!art.firstChild) art.append(icon('download', 'dlcard__icon'));
      status.textContent = paused ? 'Downloads paused' : 'Nothing downloading';
      title.textContent = paused ? 'Resume to carry on' : 'All caught up';
      pct.textContent = '';
      fill.style.width = '0%';
      line.textContent = '';
      return;
    }
    if (active.appid !== shownApp) {
      shownApp = active.appid;
      art.replaceChildren(icon('download', 'dlcard__icon'), artImg(artFor(active.appid), 'dlcard__img', { lazy: false }) || '');
    }
    status.textContent = active.state;
    title.textContent = active.name;
    pct.textContent = `${active.percent}%`;
    fill.style.width = `${active.percent}%`;
    line.textContent = active.line || '';
  }
  return { el, update };
}

// ---------------------------------------------------------------- switches

/** Ask before opening Steam's debugging port: it is the user's call, and reversible. */
export async function enableControls() {
  const pick = await menu({
    title: 'Turn on download controls?',
    subtitle: 'Halcyon controls downloads through Steam’s debugging port, like Decky Loader does. While it is on, any program on this computer can control Steam, including the store. It does not accept connections from other computers. Steam must be restarted afterwards.',
    selected: 'no',
    items: [
      { label: 'Turn on', value: 'yes', iconName: 'check' },
      { label: 'Cancel', value: 'no', iconName: 'up' },
    ],
  });
  if (pick !== 'yes') return false;
  const res = await api.downloads.enable(true);
  if (!res.ok) { toast(res.error, { type: 'error', title: 'Download controls' }); return false; }
  toast('Restart Steam to finish. Steam › Exit, then open it again.', { title: 'Download controls on', iconName: 'download', ms: 8000 });
  return true;
}

export async function disableControls() {
  const res = await api.downloads.enable(false);
  if (!res.ok) toast(res.error, { type: 'error', title: 'Download controls' });
  else toast('Steam’s debugging port closes when Steam restarts.', { title: 'Download controls off', iconName: 'download', ms: 6000 });
  return res.ok;
}

async function act(action, appid, index) {
  const res = await api.downloads.control(action, appid, index);
  if (!res.ok) toast(res.error, { type: 'error', title: 'Steam download' });
  return res.ok;
}

// ------------------------------------------------------------- sub-menus

/** queue: the up-next items in order (the active download is not part of it). */
async function itemMenu(panel, item, queue, isActive) {
  const n = queue.findIndex((q) => q.appid === item.appid);
  const g = findGame(`steam:${item.appid}`);
  const pick = await panel.ask({
    title: nameOf(item.appid),
    subtitle: isActive ? 'Downloading now' : g?.download ? downloadLabel(g.download) : item.paused ? 'Paused' : `Up next, number ${n + 1}`,
    selected: item.paused || !isActive ? 'resume' : 'pause',
    items: [
      isActive && !item.paused ? { label: 'Pause', value: 'pause', iconName: 'clock' }
        : { label: 'Download now', value: 'resume', iconName: 'download', sub: 'Starts it ahead of everything else' },
      !isActive && n > 0 && { label: 'Move to the top', value: 'top', iconName: 'up', sub: 'Next after what is downloading now' },
      !isActive && n > 0 && { label: 'Move up', value: 'up', iconName: 'up' },
      !isActive && n >= 0 && n < queue.length - 1 && { label: 'Move down', value: 'down', iconName: 'up' },
      { label: 'Remove from the queue', value: 'remove', iconName: 'clock', sub: 'Steam keeps what is already downloaded' },
      cancelItem(item.appid),
    ],
  });
  if (pick === 'pause') await act('pause', item.appid);
  if (pick === 'resume') await act('resume', item.appid);
  // Steam's own queue numbers: hand it the slot of the item being jumped over.
  if (pick === 'top') await act('move', item.appid, queue[0].position);
  if (pick === 'up') await act('move', item.appid, queue[n - 1].position);
  if (pick === 'down') await act('move', item.appid, queue[n + 1].position);
  if (pick === 'remove') await act('remove', item.appid);
  if (pick === 'cancel') await cancelDownload(panel, item.appid);
}

/** A new install, or an update to a game that is already installed? */
const isUpdate = (appid) => Boolean(findGame(`steam:${appid}`)?.download?.update ?? findGame(`steam:${appid}`)?.installed);

function cancelItem(appid) {
  return isUpdate(appid)
    ? { label: 'Cancel update', value: 'cancel', iconName: 'exit', danger: true, sub: 'The game stays as it is; the update waits until you start it' }
    : { label: 'Cancel download', value: 'cancel', iconName: 'trash', danger: true, sub: 'Stops it and deletes what has downloaded so far' };
}

/**
 * Cancel a download, after asking. An update is taken off Steam's list (the game stays playable
 * as it was). A new install is stopped and its files deleted, the way Steam's own Cancel does it:
 * Steam uninstalls the partly downloaded game.
 */
async function cancelDownload(panel, appid) {
  const update = isUpdate(appid);
  const name = nameOf(appid);
  const sure = await panel.ask({
    title: update ? `Cancel the update to ${name}?` : `Cancel downloading ${name}?`,
    subtitle: update ? 'The game stays as it is. Steam asks for the update again when you start it.' : 'What has downloaded so far is deleted. You can install it again any time.',
    selected: 'no',
    items: [
      { label: update ? 'Cancel update' : 'Cancel download', value: 'yes', iconName: update ? 'exit' : 'trash', danger: true },
      { label: 'Keep downloading', value: 'no', iconName: 'download' },
    ],
  });
  if (sure !== 'yes') return false;
  if (update) {
    const ok = await act('remove', appid);
    if (ok) toast('The update was cancelled.', { title: name, iconName: 'download' });
    return ok;
  }
  await act('pause', appid);
  const r = await api.steam.uninstall(appid);
  if (r && r.ok === false) { toast(r.error || 'Steam didn’t cancel it.', { type: 'error', title: name }); return false; }
  await act('remove', appid);
  toast('The download was cancelled and its files removed.', { title: name, iconName: 'trash' });
  return true;
}

/** An update Steam has put off until later: start it now, queue it, or drop it. */
async function scheduledMenu(panel, appid) {
  const pick = await panel.ask({
    title: nameOf(appid),
    subtitle: 'Steam has scheduled this update for later',
    selected: 'now',
    items: [
      { label: 'Update now', value: 'now', iconName: 'download', sub: 'Starts it straight away' },
      { label: 'Add to the queue', value: 'queue', iconName: 'layers', sub: 'Downloads after what is already queued' },
      { label: 'Remove from the list', value: 'remove', iconName: 'clock', sub: 'Steam may schedule it again later' },
      cancelItem(appid),
    ],
  });
  if (pick === 'now') await act('resume', appid);
  if (pick === 'queue') await act('update', appid);
  if (pick === 'remove') await act('remove', appid);
  if (pick === 'cancel') await cancelDownload(panel, appid);
}

// ----------------------------------------------------------------- manager

function scheduledText(sec) {
  if (!sec) return 'Scheduled';
  const d = new Date(sec * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Scheduled for ${sameDay ? 'today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** n: place in the "up next" list (0 = next). */
function queueRow(i, n) {
  const g = findGame(`steam:${i.appid}`);
  const d = g?.download;
  return {
    label: nameOf(i.appid), value: i.readOnly ? undefined : `item:${i.appid}`, key: `item:${i.appid}`, disabled: Boolean(i.readOnly),
    art: artFor(i.appid), verb: 'Options', cls: 'row--download',
    sub: i.error || (d ? `${downloadLabel(d)}${d.total ? `  ·  ${bytes(d.done)} of ${bytes(d.total)}` : ''}` : i.paused ? 'Paused' : 'Waiting'),
    // A bar only once there is something to show; a row of empty bars reads as broken.
    meter: d && d.percent > 0 ? d.percent : null, hint: i.readOnly ? null : `#${n + 1}`,
  };
}

/** What the list looks like structurally; when only numbers change, rows are patched in place. */
const shape = (m) => JSON.stringify([m.connected, m.enabled, m.paused, m.active && m.active.appid, m.active && m.active.name,
  m.queue.map((i) => [i.appid, i.position, i.paused, nameOf(i.appid)]), m.scheduled.map((i) => [i.appid, nameOf(i.appid)]),
  m.finished.map((i) => i.appid), m.waiting.map((g) => g.id), m.error]);

/** focusApp: appid to start on, when opened from a game. */
/**
 * The details beside the list (360 theme): the selected download's art, where it's at, a big
 * percentage and bar, and its size / speed / time left. show(info) with { appid, name, state,
 * percent, line } or null.
 */
function detailPane() {
  const art = h('div', { class: 'dlview__art' });
  const status = h('div', { class: 'dlview__status' });
  const name = h('div', { class: 'dlview__name' });
  const pct = h('div', { class: 'dlview__pct' });
  const fill = h('i');
  const bar = h('div', { class: 'dlview__bar' }, fill);
  const line = h('div', { class: 'dlview__line' });
  const el = h('div', { class: 'dlview' }, art, h('div', { class: 'dlview__text' }, status, name, pct, bar, line));
  let shownArt = null;
  function show(info) {
    el.classList.toggle('is-empty', !info);
    if (!info) {
      shownArt = null;
      art.replaceChildren(icon('download', 'dlview__icon'));
      status.textContent = 'all caught up';
      name.textContent = 'Nothing is downloading';
      pct.textContent = ''; fill.style.width = '0%'; line.textContent = '';
      return;
    }
    if (info.appid !== shownArt) {
      shownArt = info.appid;
      art.replaceChildren(icon('download', 'dlview__icon'), artImg(artFor(info.appid), 'dlview__img', { lazy: false }) || '');
    }
    el.classList.toggle('is-paused', /paus/i.test(info.state || ''));
    status.textContent = (info.state || '').toLowerCase();
    name.textContent = info.name;
    pct.textContent = info.percent != null ? `${info.percent}%` : '';
    bar.hidden = info.percent == null;
    fill.style.width = `${info.percent || 0}%`;
    line.textContent = info.line || '';
  }
  return { el, show };
}

/** What the details show for a list entry (its value), from the model. */
function detailFor(m, value) {
  const appid = value && /^(item|sched|queue|clear):(\d+)$/.exec(value)?.[2];
  if (!appid || (m.active && m.active.appid === appid)) return m.active;
  const g = findGame(`steam:${appid}`);
  const d = g?.download;
  if (value.startsWith('clear:')) return { appid, name: nameOf(appid), state: 'Finished', percent: 100, line: g?.sizeBytes ? bytes(g.sizeBytes) : '' };
  if (value.startsWith('sched:')) return { appid, name: nameOf(appid), state: 'Update scheduled', percent: null, line: scheduledText(m.scheduled.find((i) => i.appid === appid)?.when) };
  if (value.startsWith('queue:')) return { appid, name: nameOf(appid), state: 'Update ready', percent: null, line: 'Select to download it now' };
  const n = m.queue.findIndex((i) => i.appid === appid);
  const item = m.queue[n];
  return {
    appid, name: nameOf(appid), state: item?.paused ? 'Paused' : `Up next · #${n + 1}`,
    percent: d && d.percent > 0 ? d.percent : null, line: d?.total ? `${bytes(d.done)} of ${bytes(d.total)}` : '',
  };
}

export async function openDownloads({ focusApp = null } = {}) {
  const panel = openPanel();
  panel.el.classList.add('layer--downloads');
  const x360 = document.body.dataset.theme === 'x360';
  const card = downloadCard({ compact: x360 });
  const detail = detailPane();
  panel.el.append(detail.el);
  let focusedValue = null;
  panel.el.addEventListener('nav-focus', (e) => {
    const row = e.target.closest?.('.row') || e.target;
    focusedValue = row.itemValue ?? null;
    detail.show(detailFor(model, focusedValue));
  });
  let selected = focusApp ? `item:${focusApp}` : 'active';
  let firstPass = Boolean(focusApp);
  let model = await snapshot();

  for (;;) {
    const m = model;
    card.update(m.active, m.paused);
    let subtitle;
    let items;
    if (m.connected) {
      subtitle = m.paused ? 'Downloads are paused' : m.active ? `${m.active.state} ${m.active.name}` : 'Nothing is downloading';
      items = [
        { card: card.el, value: m.active ? `item:${m.active.appid}` : undefined, key: 'active', verb: 'Options' },
        m.paused ? { label: 'Resume downloads', value: 'resumeAll', key: 'resumeAll', iconName: 'download' }
          : { label: 'Pause all downloads', value: 'pauseAll', key: 'pauseAll', iconName: 'clock' },
        m.queue.length > 0 && { heading: 'Up next' },
        ...m.queue.map((i, n) => queueRow(i, n)),
        (m.scheduled.length + m.waiting.length) > 0 && { heading: 'Updates waiting' },
        ...m.scheduled.map((i) => ({ label: nameOf(i.appid), value: `sched:${i.appid}`, key: `sched:${i.appid}`, art: artFor(i.appid), cls: 'row--download', verb: 'Options', sub: scheduledText(i.when) })),
        ...m.waiting.map((g) => ({ label: g.name, value: `queue:${g.id.slice(6)}`, key: `queue:${g.id.slice(6)}`, art: artFor(g.id.slice(6)), cls: 'row--download', verb: 'Update', sub: 'Update ready to download' })),
        m.finished.length > 0 && { heading: 'Finished' },
        m.finished.length > 1 && { label: 'Clear all finished', value: 'clearAll', key: 'clearAll', iconName: 'check', sub: `${m.finished.length} downloads` },
        ...m.finished.map((i) => ({ label: nameOf(i.appid), value: `clear:${i.appid}`, key: `clear:${i.appid}`, art: artFor(i.appid), cls: 'row--download row--finished', verb: 'Clear', sub: 'Done  ·  select to clear' })),
        { heading: ' ' },
        { label: 'Open Steam’s downloads page', value: 'steam', key: 'steam', iconName: 'cloud' },
      ];
    } else {
      subtitle = !m.enabled ? 'Showing progress only. Pausing, reordering and updating need Steam’s download controls.'
        : 'Download controls are on, but Steam is not answering. Restart Steam (Steam › Exit, then open it) to finish turning them on.';
      items = [
        { card: card.el, key: 'active' },
        !m.enabled ? { label: 'Turn on download controls', value: 'enable', key: 'enable', iconName: 'key', sub: 'Opens Steam’s debugging port on this computer' }
          : { label: 'Try again', value: 'retry', key: 'retry', iconName: 'refresh', sub: m.error || null },
        m.queue.length > 0 && { heading: 'Also in progress' },
        ...m.queue.map((i, n) => queueRow(i, n)),
        { heading: ' ' },
        { label: 'Open Steam’s downloads page', value: 'steam', key: 'steam', iconName: 'cloud' },
      ];
    }
    items = items.filter(Boolean);
    if (firstPass) {
      firstPass = false;
      const hit = items.find((i) => i.value && i.value.endsWith(`:${focusApp}`));
      if (hit) selected = hit.value;
    }

    // Live: every second, move the bars along in place; rebuild only when the list itself changes.
    const built = shape(m);
    let rebuilt = false;
    let ticking = false;
    onNamed = () => { if (!rebuilt) { rebuilt = true; panel.cancel(); } };
    const timer = setInterval(async () => {
      if (ticking || rebuilt) return;
      ticking = true;
      const next = await snapshot();
      ticking = false;
      if (rebuilt) return;
      model = next;
      if (shape(next) !== built) { rebuilt = true; panel.cancel(); return; }
      card.update(next.active, next.paused);
      detail.show(detailFor(next, focusedValue));
      panel.el.querySelector('.panel__subtitle')?.replaceChildren(next.paused ? 'Downloads are paused' : next.active ? `${next.active.state} ${next.active.name}` : 'Nothing is downloading');
      for (const [n, i] of next.queue.entries()) {
        const row = panel.el.querySelector(`[data-key="row:item:${i.appid}"]`);
        const fresh = queueRow(i, n);
        if (!row) continue;
        const sub = row.querySelector('.row__sub');
        if (sub) sub.textContent = fresh.sub;
        const bar = row.querySelector('.row__meter i');
        if (bar) bar.style.width = `${fresh.meter}%`;
      }
    }, TICK_MS);

    detail.show(detailFor(m, focusedValue ?? selected));
    // X pauses or resumes the selected download; Y opens what can be done with it.
    const onAction = (action) => {
      if (!m.connected || (action !== 'x' && action !== 'y' && action !== 'start')) return false;
      const v = focusedValue || (m.active ? `item:${m.active.appid}` : null);
      // A scheduled update: X starts it now, Y its options, Start cancels it.
      const sched = v && /^sched:(\d+)$/.exec(v)?.[1];
      if (sched) {
        if (action === 'x') act('resume', sched);
        else { quick = action === 'y' ? v : `cancel:${sched}`; panel.cancel(); }
        return true;
      }
      const appid = v && /^item:(\d+)$/.exec(v)?.[1];
      if (!appid) return false;
      if (action === 'y') { quick = v; panel.cancel(); return true; }
      if (action === 'start') { quick = `cancel:${appid}`; panel.cancel(); return true; }
      const isActive = m.active && m.active.appid === appid;
      const paused = isActive ? m.paused : m.queue.find((i) => i.appid === appid)?.paused;
      act(isActive && !paused ? 'pause' : 'resume', appid);
      return true;
    };
    let quick = null;
    const pick0 = await panel.ask({ title: 'active downloads', subtitle, items, selected, onAction,
      hints: m.connected ? [{ a: 'x', label: 'Pause / resume' }, { a: 'y', label: 'Options' }, { a: 'start', label: 'Cancel' }] : [] });
    const pick = quick || pick0;
    clearInterval(timer);
    onNamed = null;
    // Rebuilt (the list changed): stay on the download that was selected, wherever it moved to.
    if (rebuilt) { selected = focusedValue ?? panel.el.querySelector('.row.is-focused')?.itemValue ?? selected; continue; }
    if (pick == null) break;
    selected = pick;

    if (pick === 'pauseAll' || pick === 'resumeAll') { await act(pick); selected = pick === 'pauseAll' ? 'resumeAll' : 'pauseAll'; }
    else if (pick === 'steam') { const r = await api.steam.action('downloads'); if (r && r.ok === false) toast(r.error, { type: 'error' }); }
    else if (pick === 'enable') await enableControls();
    else if (pick.startsWith('cancel:')) { await cancelDownload(panel, pick.slice(7)); selected = 'active'; }
    else if (pick.startsWith('queue:')) await act('update', pick.slice(6));
    else if (pick.startsWith('sched:')) await scheduledMenu(panel, pick.slice(6));
    else if (pick.startsWith('clear:')) await act('remove', pick.slice(6));
    else if (pick === 'clearAll') {
      // Steam clears finished items one at a time; do them all.
      let done = 0;
      for (const i of m.finished) if (await act('remove', i.appid)) done++;
      selected = 'active';
    }
    else if (pick.startsWith('item:')) {
      const appid = pick.slice(5);
      const isActive = Boolean(m.active && m.active.appid === appid);
      const fresh = await snapshot();
      const st = await api.downloads.status().catch(() => null);
      const item = st?.items?.find((i) => i.appid === appid);
      if (item) await itemMenu(panel, item, fresh.queue, isActive);
    }
    model = await snapshot();
  }
  await panel.close();
}
