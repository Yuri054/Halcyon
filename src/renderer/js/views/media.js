// Media: a Jellyfin server's movies, shows and music, browsed and played from the couch.
// Home shows continue watching, next up and what is new in each library; a library
// opens as a wall of posters; shows open season by season.
import { h, icon, flash } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { api, state } from '../core/state.js';
import { app } from '../core/bus.js';
import { actionTile } from '../ui/tile.js';
import { openPanel, menu } from '../ui/dialog.js';
import { keyboard } from '../ui/osk.js';
import { toast } from '../ui/toast.js';
import { artImg } from '../ui/art.js';
import { mediaTile, mediaHero, img, episodeCode } from '../media/tile.js';
import { openPlayer } from '../media/player.js';
import { openDetails } from '../media/details.js';

const TICKS = 10000000;
const LIB_ICON = { movies: 'film', tvshows: 'tv', music: 'music' };

export function createMedia() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const wall = h('div', { class: 'wall', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const wallHead = h('div', { class: 'toolbar media__head' });
  const wallView = h('div', { class: 'media__library', hidden: true }, wallHead, wall);
  const el = h('section', { class: 'view view--media' }, scroller, wallView);

  let status = null;        // { connected, serverName, userName }
  let home = null;          // the overview from Jellyfin
  let loading = false;
  let error = null;
  let library = null;       // { lib, items } while a library is open
  const items = new Map();  // id -> item, for context and backdrops

  const block = (title, cls, tiles) => h('div', { class: `block ${cls}` }, h('h3', { class: 'block__title' }, title), h('div', { class: 'block__tiles' }, tiles));
  const remember = (list) => { for (const it of list) items.set(it.id, it); return list; };

  async function load() {
    loading = true;
    status = await api.jellyfin.status().catch(() => ({ connected: false }));
    if (status.connected) {
      const res = await api.jellyfin.home();
      if (res.ok) { home = res.data; error = null; } else { error = res.error; if (res.auth) status.connected = false; }
    }
    loading = false;
    if (state.section !== 'media') return;
    const key = focus.base().current?.dataset.key;
    render();
    const again = focus.byKey(el, key) || el.querySelector('[data-focus]');
    if (again) focus.focus(again, { layer: focus.base(), scroll: false });
    app.refreshChrome();
  }

  function render() {
    if (library) { renderLibrary(); return; }
    wallView.hidden = true;
    scroller.hidden = false;
    if (!status && !loading) { load(); }
    let i = 0;
    if (!status || loading && !home) {
      scroller.replaceChildren(block('media', 'block--hero', [actionTile({ key: 'mx:loading', size: 'hero', iconName: 'film', tone: 'glass', label: 'Loading', sub: 'Asking your Jellyfin server' })]));
      return;
    }
    if (!status.connected) {
      scroller.replaceChildren(block('media', 'block--hero', [actionTile({
        key: 'mx:connect', size: 'hero', iconName: 'film', tone: 'accent', label: 'Connect to Jellyfin',
        sub: 'Watch your movies and shows and play your music from your own Jellyfin server.', onSelect: connect,
      })]));
      return;
    }
    if (error && !home) {
      scroller.replaceChildren(block('media', 'block--hero', [actionTile({ key: 'mx:retry', size: 'hero', iconName: 'warn', tone: 'glass', label: 'Jellyfin is not answering', sub: error, onSelect: () => { status = null; render(); } })]),
        block('server', 'block--quick', [actionTile({ key: 'mx:server', label: 'Server', sub: status.serverName, iconName: 'gear', tone: 'glass', onSelect: serverMenu })]));
      return;
    }
    // ---- the front page: libraries, a feature, and what to watch next, then the rails
    const resume = remember(home.resume);
    const nextUp = remember(home.nextUp).filter((n) => !resume.some((r) => r.id === n.id));
    const libs = remember(home.libraries);
    const feature = resume[0] || nextUp[0] || home.latest[0]?.items[0];
    const used = new Set(feature ? [feature.id] : []);
    const pick = (list, n) => list.filter((x) => !used.has(x.id)).slice(0, n).map((x) => { used.add(x.id); return x; });
    const under = pick(resume, 2);
    const side = pick(nextUp.length ? nextUp : resume, 3);
    const at = (el, area) => { el.style.gridArea = area; return el; };
    const libTile = (lib, area) => at(actionTile({ key: `mx:lib:${lib.id}`, label: lib.name, iconName: LIB_ICON[lib.collection] || 'layers', tone: 'accent', index: i++, onSelect: () => openLibrary(lib) }), area);
    const searchTile = (area) => at(actionTile({ key: 'mx:search', label: 'Search', iconName: 'search', tone: 'accent', index: i++, onSelect: search }), area);

    const front = h('div', { class: 'media__front' },
      libs[0] ? libTile(libs[0], 'a1') : searchTile('a1'),
      libs[1] ? libTile(libs[1], 'a2') : (libs[0] ? searchTile('a2') : null),
      libs[2] ? libTile(libs[2], 'a3') : (libs[1] ? searchTile('a3') : null),
      feature && at(mediaHero(feature, resume[0] === feature ? 'continue watching' : nextUp[0] === feature ? 'next up' : 'new', i++), 'hero'),
      under[0] && at(mediaTile(under[0], 'wide', i++), 'b3'),
      under[1] && at(mediaTile(under[1], 'wide', i++), 'c3'),
      side[0] && at(mediaTile(side[0], 'wide', i++), 'd1'),
      side[1] && at(mediaTile(side[1], 'wide', i++), 'd2'),
      side[2] && at(mediaTile(side[2], 'wide', i++), 'd3'));
    const blocks = [h('div', { class: 'block block--front' }, h('h3', { class: 'block__title' }, side.length && nextUp.length ? 'watch next' : 'jellyfin'), front)];

    const moreResume = resume.filter((x) => !used.has(x.id));
    const moreNext = nextUp.filter((x) => !used.has(x.id));
    if (moreResume.length) blocks.push(block('continue watching', 'block--wide media__rail', moreResume.map((it) => mediaTile(it, 'wide', i++))));
    if (moreNext.length) blocks.push(block('next up', 'block--wide media__rail', moreNext.map((it) => mediaTile(it, 'wide', i++))));
    for (const l of home.latest) {
      blocks.push(block(`new in ${l.library.name.toLowerCase()}`, 'block--covers media__latest', remember(l.items).slice(0, 12).map((it) => mediaTile(it, 'cover', i++))));
    }
    blocks.push(block(status.serverName || 'jellyfin', 'block--quick', [
      ...libs.slice(3).map((lib) => actionTile({ key: `mx:lib:${lib.id}`, label: lib.name, iconName: LIB_ICON[lib.collection] || 'layers', tone: 'accent', index: i++, onSelect: () => openLibrary(lib) })),
      libs.length >= 3 && actionTile({ key: 'mx:search2', label: 'Search', iconName: 'search', tone: 'glass', index: i++, onSelect: search }),
      actionTile({ key: 'mx:server', label: 'Server', sub: status.userName, iconName: 'gear', tone: 'glass', index: i++, onSelect: serverMenu }),
    ].filter(Boolean)));
    if (!feature && !home.libraries.length) {
      blocks.unshift(block('media', 'block--hero', [actionTile({ key: 'mx:empty', size: 'hero', iconName: 'film', tone: 'glass', label: 'Nothing here yet', sub: 'Your Jellyfin user has no libraries Halcyon can show.' })]));
    }
    scroller.replaceChildren(...blocks);
  }

  // ---- a library as a wall of posters
  async function openLibrary(lib, genre = '') {
    const [res, g] = await Promise.all([api.jellyfin.library(lib.id, 0, genre), library?.lib?.id === lib.id ? Promise.resolve({ ok: true, data: library.genres }) : api.jellyfin.genres(lib.id)]);
    if (!res.ok) { toast(res.error, { type: 'error', title: lib.name }); return; }
    library = { lib, items: remember(res.data.items), total: res.data.total, genres: g.ok ? g.data : [], genre };
    renderLibrary();
    flash(el, 'is-swapping');
    const first = wall.querySelector('[data-focus]');
    if (first) focus.focus(first, { layer: focus.base(), scroll: 'instant' });
    app.refreshChrome();
  }
  function renderLibrary() {
    scroller.hidden = true;
    wallView.hidden = false;
    const chip = (id, label) => {
      const c = h('div', { class: `chip${(library.genre || '') === id ? ' is-active' : ''}`, 'data-focus': true, 'data-key': `mg:${id}`, 'data-genre': id }, label);
      c.addEventListener('click', () => pickGenre(id));
      return c;
    };
    const chips = h('div', { class: 'chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true },
      ...(library.genres.length ? [chip('', 'All'), ...library.genres.map((g) => chip(g.id, g.name))] : []));
    wallHead.replaceChildren(h('div', { class: 'media__crumb' }, icon(LIB_ICON[library.lib.collection] || 'layers'), h('span', null, library.lib.name), h('small', null, `${library.total}`)), chips);
    wall.classList.toggle('wall--square', library.lib.collection === 'music');
    wall.replaceChildren(...library.items.map((it, n) => mediaTile(it, 'cover', n)));
  }
  async function pickGenre(id) {
    if (!library || library.lib.id === 'search') return;
    await openLibrary(library.lib, id);
    const c = focus.byKey(el, `mg:${id}`);
    if (c) { focus.focus(c, { layer: focus.base(), scroll: 'smooth' }); c.scrollIntoView?.({ inline: 'center', block: 'nearest' }); }
  }
  function cycleGenre(step) {
    if (!library?.genres?.length) return;
    const ids = ['', ...library.genres.map((g) => g.id)];
    const i = ids.indexOf(library.genre || '');
    pickGenre(ids[(i + step + ids.length) % ids.length]);
  }
  async function reloadLibrary() {
    if (!library || library.lib.id === 'search') return;
    const key = focus.base().current?.dataset.key;
    const res = await api.jellyfin.library(library.lib.id, 0, library.genre);
    if (!res.ok) return;
    library.items = remember(res.data.items);
    renderLibrary();
    const again = focus.byKey(el, key);
    if (again) focus.focus(again, { layer: focus.base(), scroll: false });
  }

  function closeLibrary() {
    const id = library.lib.id;
    library = null;
    render();
    const back = focus.byKey(el, `mx:lib:${id}`) || el.querySelector('[data-focus]');
    focus.focus(back, { layer: focus.base(), scroll: 'instant' });
    app.refreshChrome();
  }

  // ---- signing in
  async function connect() {
    const server = await keyboard({ title: 'Jellyfin server address', placeholder: '192.168.1.20:8096', value: status?.server || '' });
    if (!server || !server.trim()) return;
    const user = await keyboard({ title: 'Jellyfin user name', placeholder: 'User name' });
    if (user == null) return;
    const password = await keyboard({ title: `Password for ${user}`, placeholder: 'Leave empty if there is none', secret: true });
    if (password == null) return;
    const res = await api.jellyfin.connect(server, user, password);
    if (!res.ok) { toast(res.error, { type: 'error', title: 'Couldn’t connect' }); return; }
    toast(`Signed in as ${res.userName}`, { title: res.serverName, iconName: 'film' });
    status = null; home = null;
    render();
  }
  async function serverMenu() {
    const pick = await menu({ title: status.serverName || 'Jellyfin', subtitle: `${status.server} · signed in as ${status.userName}`, items: [
      { label: 'Refresh', value: 'refresh', iconName: 'refresh' },
      { label: 'Sign out', value: 'out', iconName: 'exit', danger: true },
    ] });
    if (pick === 'refresh') { status = null; home = null; render(); }
    if (pick === 'out') { await api.jellyfin.disconnect(); status = null; home = null; render(); }
  }
  async function search() {
    const term = await keyboard({ title: 'Search Jellyfin', placeholder: 'Movie, show or album' });
    if (!term || !term.trim()) return;
    const res = await api.jellyfin.search(term.trim());
    if (!res.ok) { toast(res.error, { type: 'error' }); return; }
    if (!res.data.length) { toast(`Nothing matches “${term.trim()}”`, { title: 'Search' }); return; }
    library = { lib: { id: 'search', name: `“${term.trim()}”`, collection: '' }, items: remember(res.data), total: res.data.length, genres: [], genre: '' };
    renderLibrary();
    focus.focus(wall.querySelector('[data-focus]'), { layer: focus.base(), scroll: 'instant' });
    app.refreshChrome();
  }

  // ---- what an item opens
  async function open(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.type === 'MusicAlbum') return showAlbum(it);
    if (it.type === 'Season') return details({ ...it, id: it.seriesId, type: 'Series', name: it.series });
    return details(it);
  }

  const art = (it) => h('div', { class: 'panel__art' }, artImg([img(it.images.primaryOf, 'Primary', 400)], 'panel__art-img', { lazy: false }));
  const facts = (it) => [it.year, it.runtimeMin && `${it.runtimeMin} min`, it.rating, it.community && `★ ${it.community.toFixed(1)}`, it.genres.join(', ')].filter(Boolean).join('  ·  ');

  async function showItem(it, panelIn = null, queue = null) {
    const panel = panelIn || openPanel();
    const resumeAt = it.resumeTicks / TICKS;
    const pick = await panel.ask({
      title: it.type === 'Episode' && it.index != null ? `${it.index}. ${it.name}` : it.name,
      subtitle: it.type === 'Episode' ? [it.series, it.season != null && `Season ${it.season}`, facts(it)].filter(Boolean).join('  ·  ') : facts(it),
      art: art(it),
      selected: resumeAt > 0 ? 'resume' : 'play',
      items: [
        resumeAt > 0 && { label: `Resume from ${Math.floor(resumeAt / 60)} min`, value: 'resume', iconName: 'play' },
        { label: resumeAt > 0 ? 'Play from the start' : 'Play', value: 'play', iconName: resumeAt > 0 ? 'restart' : 'play' },
        it.overview && { heading: 'About' },
        it.overview && { label: it.overview, disabled: true },
      ],
    });
    if (!panelIn) await panel.close();
    if (pick === 'resume' || pick === 'play') {
      const q = queue || [it.id];
      await openPlayer({ queue: q, start: Math.max(0, q.indexOf(it.id)), fromStart: pick === 'play' });
      refreshSoon();
    }
    return pick;
  }

  async function showSeries(series, seasonId = null) {
    const panel = openPanel();
    const sRes = await api.jellyfin.seasons(series.id);
    if (!sRes.ok) { await panel.close(); toast(sRes.error, { type: 'error' }); return; }
    const seasons = remember(sRes.data);
    let season = seasonId ? seasons.find((s) => s.id === seasonId) : (seasons.find((s) => !s.played) || seasons[0]);
    for (;;) {
      if (!season) break;
      const eRes = await api.jellyfin.episodes(series.id, season.id);
      if (!eRes.ok) { toast(eRes.error, { type: 'error' }); break; }
      const eps = remember(eRes.data);
      const nextEp = eps.find((e) => e.progress > 0 && e.progress < 100) || eps.find((e) => !e.played) || eps[0];
      const pick = await panel.ask({
        title: series.name, subtitle: `${season.name}  ·  ${eps.length} episodes`, art: art(series),
        selected: nextEp ? nextEp.id : null,
        items: [
          seasons.length > 1 && { label: 'Seasons', value: '@seasons', iconName: 'layers', hint: season.name },
          { heading: season.name },
          ...eps.map((e) => ({ label: e.index != null ? `${e.index}. ${e.name}` : e.name, value: e.id, iconName: e.played ? 'check' : 'play', sub: e.runtimeMin ? `${e.runtimeMin} min${e.progress > 0 && e.progress < 100 ? ` · ${e.progress}% watched` : ''}` : null, meter: e.progress > 0 && e.progress < 100 ? e.progress : null, verb: 'Play' })),
        ],
      });
      if (pick == null) break;
      if (pick === '@seasons') {
        const s = await panel.ask({ title: series.name, subtitle: 'Seasons', art: art(series), selected: season.id,
          items: seasons.map((x) => ({ label: x.name, value: x.id, iconName: x.played ? 'check' : 'tv', checked: x.id === season.id, sub: x.unplayed ? `${x.unplayed} unwatched` : null })) });
        if (s) season = seasons.find((x) => x.id === s) || season;
        continue;
      }
      const ep = eps.find((e) => e.id === pick);
      if (ep) await showItem(ep, panel, eps.map((e) => e.id));
    }
    await panel.close();
  }

  async function showAlbum(album) {
    const panel = openPanel();
    const res = await api.jellyfin.tracks(album.id);
    if (!res.ok) { await panel.close(); toast(res.error, { type: 'error' }); return; }
    const tracks = remember(res.data);
    const pick = await panel.ask({
      title: album.name, subtitle: [album.albumArtist, album.year, `${tracks.length} tracks`].filter(Boolean).join('  ·  '), art: art(album),
      items: [
        { label: 'Play album', value: '@all', iconName: 'play' },
        { heading: 'Tracks' },
        ...tracks.map((t) => ({ label: t.index != null ? `${t.index}. ${t.name}` : t.name, value: t.id, iconName: 'music', hint: t.runtimeMin ? `${t.runtimeMin} min` : null, verb: 'Play' })),
      ],
    });
    await panel.close();
    if (pick == null) return;
    const q = tracks.map((t) => t.id);
    await openPlayer({ queue: q, start: pick === '@all' ? 0 : Math.max(0, q.indexOf(pick)), fromStart: true });
  }

  async function details(it) {
    const changed = await openDetails(it);
    if (changed) refreshSoon();
  }

  /** Y on a tile: the quick things to do with it. */
  async function options(id) {
    const it = items.get(id);
    if (!it || it.type === 'MusicAlbum') { if (it) open(id); return; }
    const resuming = it.progress > 0 && it.progress < 100;
    const pick = await menu({
      title: it.type === 'Episode' ? it.series : it.name,
      subtitle: it.type === 'Episode' ? [episodeCode(it), it.name].filter(Boolean).join(' · ') : [it.year, it.runtimeMin && `${it.runtimeMin} min`].filter(Boolean).join(' · '),
      art: h('div', { class: 'panel__art' }, artImg([img(it.images.primaryOf, 'Primary', 400)], 'panel__art-img', { lazy: false })),
      items: [
        it.type !== 'Series' && { label: resuming ? 'Resume' : 'Play', value: 'play', iconName: 'play' },
        { label: it.type === 'Series' ? 'Open the show' : 'Details', value: 'details', iconName: 'info' },
        it.type === 'Episode' && it.seriesId && { label: `Go to ${it.series}`, value: 'series', iconName: 'tv' },
        { label: it.played ? 'Mark unwatched' : 'Mark watched', value: 'watched', iconName: it.played ? 'eyeOff' : 'check' },
        resuming && { label: 'Remove from continue watching', value: 'hide', iconName: 'trash', sub: 'Stays unwatched' },
      ],
    });
    if (pick === 'play') { await openPlayer({ queue: [it.id], start: 0, fromStart: !resuming }); refreshSoon(); }
    if (pick === 'details') details(it);
    if (pick === 'series') details({ ...it, id: it.seriesId, type: 'Series', name: it.series });
    if (pick === 'watched' || pick === 'hide') {
      const r = pick === 'watched' ? await api.jellyfin.markPlayed(it.id, !it.played) : await api.jellyfin.hideFromResume(it.id);
      if (!r.ok) { toast(r.error, { type: 'error' }); return; }
      toast(pick === 'hide' ? 'Removed from continue watching' : it.played ? 'Marked unwatched' : 'Marked watched', { title: it.name, iconName: pick === 'hide' ? 'trash' : 'check' });
      refreshSoon();
    }
  }

  // After watching, Jellyfin's resume points and "next up" change.
  function refreshSoon() { setTimeout(() => { home = null; status = null; if (state.section === 'media' && !library) render(); else if (library) reloadLibrary(); }, 600); }

  el.addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-media]');
    if (!tile) return;
    // The feature tile resumes (or plays) at once; Y on it opens its details instead.
    const it = items.get(tile.dataset.media);
    if (tile.dataset.quickplay && it && ['Movie', 'Episode', 'Video'].includes(it.type)) {
      await openPlayer({ queue: [it.id], start: 0, fromStart: !(it.progress > 0 && it.progress < 100) });
      refreshSoon();
      return;
    }
    open(tile.dataset.media);
  });

  return {
    id: 'media',
    label: 'media',
    el,
    render,
    defaultFocus: () => (library ? wall : scroller).querySelector('[data-focus]'),
    onAction(action, target) {
      if (action === 'start') { if (status?.connected) search(); return true; }
      if (action === 'y' && target?.dataset.media) { options(target.dataset.media); return true; }
      if ((action === 'lt' || action === 'rt') && library && target && wall.contains(target)) { focus.page(action === 'lt' ? 'left' : 'right', 5); return true; }
      if ((action === 'lt' || action === 'rt') && library) { cycleGenre(action === 'lt' ? -1 : 1); return true; }
      return false;
    },
    onBack() {
      if (library) { closeLibrary(); return true; }
      return false;
    },
    hints(target) {
      if (target?.dataset.quickplay) return [{ a: 'accept', label: 'Resume' }, { a: 'y', label: 'Options' }, { a: 'start', label: 'Search' }];
      if (target?.dataset.media) return [{ a: 'accept', label: 'Open' }, { a: 'y', label: 'Options' }, { a: 'start', label: 'Search' }];
      if (target?.dataset.genre != null) return [{ a: 'accept', label: 'Show' }, { a: 'lt', b: 'rt', label: 'Genre' }];
      return [{ a: 'accept', label: 'Select' }];
    },
    context(target) {
      const it = target?.dataset.media && items.get(target.dataset.media);
      if (it) {
        return { title: it.type === 'Episode' ? `${it.series}: ${it.name}` : it.name,
          meta: [it.type === 'Episode' ? (episodeCode(it) || 'Episode') : it.type === 'Series' ? 'Series' : it.type === 'MusicAlbum' ? (it.albumArtist || 'Album') : 'Movie',
            it.year, it.runtimeMin && `${it.runtimeMin} min`, it.progress > 0 && it.progress < 100 && `${it.progress}% watched`, it.played && 'Watched'].filter(Boolean).map(String) };
      }
      const label = target?.querySelector('.tile__label');
      return label ? { title: label.firstChild?.textContent || '', meta: [status?.serverName || 'Jellyfin'].filter(Boolean) } : null;
    },
    backdrop(target) {
      const it = target?.dataset.media && items.get(target.dataset.media);
      return it ? [img(it.images.backdropOf, 'Backdrop', 1600)] : [];
    },
  };
}
