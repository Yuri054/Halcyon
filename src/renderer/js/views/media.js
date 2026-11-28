// A Jellyfin server, browsed and played from the couch. Two sections use this page:
// tv & movies (continue watching, next up, what's new; shows open season by season)
// and music (albums, artists, playlists, recently played).
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
import { openPlayer, nowPlaying, onNowPlaying } from '../media/player.js';
import { openDetails } from '../media/details.js';
import { openYouTube } from '../ui/youtube.js';

const TICKS = 10000000;
const LIB_ICON = { movies: 'film', tvshows: 'tv', music: 'music' };
// What a music library's wall can show.
const MUSIC_MODES = [['albums', 'Albums', 'disc'], ['artists', 'Artists', 'user'], ['playlists', 'Playlists', 'list']];
const songTime = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : null);
const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createMedia({ id: sectionId = 'tv', label: sectionLabel = 'tv & movies', kind = 'video' } = {}) {
  const music = kind === 'music';
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const wall = h('div', { class: 'wall', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const wallHead = h('div', { class: 'toolbar media__head' });
  const wallView = h('div', { class: 'media__library', hidden: true }, wallHead, wall);
  const el = h('section', { class: `view view--media view--${sectionId}` }, scroller, wallView);
  // Signing in or out on one media page resets the other one too.
  window.addEventListener('halcyon:jellyfin', () => { status = null; home = null; library = null; if (state.section === sectionId) render(); });
  const changedServer = () => window.dispatchEvent(new Event('halcyon:jellyfin'));
  // The music page shows a "now playing" tile while a song plays in the background.
  if (music) onNowPlaying(() => { if (state.section === sectionId && !library && home && focus.top() === focus.base()) { const key = focus.base().current?.dataset.key; render(); const again = focus.byKey(el, key); if (again) focus.focus(again, { layer: focus.base(), scroll: false }); } });

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
      const res = await api.jellyfin.home(kind);
      if (res.ok) { home = res.data; error = null; } else { error = res.error; if (res.auth) status.connected = false; }
    }
    loading = false;
    if (state.section !== sectionId) return;
    const key = focus.base().current?.dataset.key;
    render();
    const again = focus.byKey(el, key) || el.querySelector('[data-focus]');
    if (again) focus.focus(again, { layer: focus.base(), scroll: false });
    app.refreshChrome();
  }

  // YouTube's TV app, offered on tv & movies whether or not Jellyfin is set up.
  const youTubeTile = (index) => actionTile({ key: 'mx:youtube', label: 'YouTube', sub: 'The TV app', iconName: 'video', tone: 'danger', index, onSelect: openYouTube });

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
        key: 'mx:connect', size: 'hero', iconName: music ? 'music' : 'film', tone: 'accent', label: 'Connect to Jellyfin',
        sub: music ? 'Play your music from your own Jellyfin server.' : 'Watch your movies and shows from your own Jellyfin server.', onSelect: connect,
      })]), ...(music ? [] : [block('apps', 'block--quick', [youTubeTile(1)])]));
      return;
    }
    if (error && !home) {
      scroller.replaceChildren(block('media', 'block--hero', [actionTile({ key: 'mx:retry', size: 'hero', iconName: 'warn', tone: 'glass', label: 'Jellyfin is not answering', sub: error, onSelect: () => { status = null; render(); } })]),
        block('server', 'block--quick', [actionTile({ key: 'mx:server', label: 'Server', sub: status.serverName, iconName: 'gear', tone: 'glass', onSelect: serverMenu })]));
      return;
    }
    if (music) { renderMusicFront(); return; }
  // ---- the front page. Left: the libraries and search. Middle: the one thing to watch now
    // (labelled: continue watching / next up / new). Right: what's next after it, then what's
    // new, each tile labelled. Then rows with clear names: continue watching, next up, and
    // recently added in each library.
    const resume = remember(home.resume);
    const nextUp = remember(home.nextUp).filter((n) => !resume.some((r) => r.id === n.id));
    const libs = remember(home.libraries);
    const latest = home.latest.map((l) => ({ ...l, items: remember(l.items) }));
    const fresh = latest.flatMap((l) => l.items).filter((x) => !resume.some((r) => r.id === x.id));
    const feature = resume[0] || nextUp[0] || fresh[0];
    const featureTag = resume[0] === feature ? 'continue watching' : nextUp[0] === feature ? 'next up' : 'recently added';
    const used = new Set(feature ? [feature.id] : []);
    const take = (list, n) => list.filter((x) => !used.has(x.id)).slice(0, n).map((x) => { used.add(x.id); return x; });
    // Five slots beside the feature: what to watch next first, then what's new.
    const slots = [
      ...take(resume, 5).map((x) => [x, 'Continue']),
    ];
    slots.push(...take(nextUp, 5 - slots.length).map((x) => [x, 'Next up']));
    slots.push(...take(fresh, 5 - slots.length).map((x) => [x, 'New']));
    const at = (node, area) => { node.style.gridArea = area; return node; };
    const libTile = (lib, area) => at(actionTile({ key: `mx:lib:${lib.id}`, label: lib.collection === 'tvshows' ? 'TV shows' : lib.name, sub: lib.collection === 'movies' ? 'Every movie' : lib.collection === 'tvshows' ? 'Every show' : null, iconName: LIB_ICON[lib.collection] || 'layers', tone: 'accent', index: i++, onSelect: () => openLibrary(lib) }), area);
    const searchTile = (area) => at(actionTile({ key: 'mx:search', label: 'Search', sub: 'Movies and shows', iconName: 'search', tone: 'accent', index: i++, onSelect: search }), area);
    const sideAreas = ['d1', 'd2', 'd3', 'b3', 'c3'];
    const front = h('div', { class: 'media__front' },
      libs[0] ? libTile(libs[0], 'a1') : searchTile('a1'),
      libs[1] ? libTile(libs[1], 'a2') : (libs[0] ? searchTile('a2') : null),
      libs[2] ? libTile(libs[2], 'a3') : (libs[1] ? searchTile('a3') : null),
      feature && at(mediaHero(feature, featureTag, i++), 'hero'),
      ...slots.map(([x, tag], n) => at(mediaTile(x, 'wide', i++, tag), sideAreas[n])));
    const blocks = [h('div', { class: 'block block--front' }, h('h3', { class: 'block__title' }, 'watch'), front)];

    const moreResume = resume.filter((x) => !used.has(x.id));
    const moreNext = nextUp.filter((x) => !used.has(x.id));
    if (moreResume.length) blocks.push(block('Continue watching', 'block--wide media__rail', moreResume.map((it) => mediaTile(it, 'wide', i++))));
    if (moreNext.length) blocks.push(block('Next up', 'block--wide media__rail', moreNext.map((it) => mediaTile(it, 'wide', i++))));
    for (const l of latest) {
      const lib = l.library.collection === 'tvshows' ? 'TV shows' : l.library.name;
      blocks.push(block(`Recently added · ${lib}`, 'block--covers media__latest', l.items.slice(0, 12).map((it) => mediaTile(it, 'cover', i++))));
    }
    blocks.push(block('More', 'block--quick', [
      youTubeTile(i++),
      ...libs.slice(3).map((lib) => actionTile({ key: `mx:lib:${lib.id}`, label: lib.name, iconName: LIB_ICON[lib.collection] || 'layers', tone: 'accent', index: i++, onSelect: () => openLibrary(lib) })),
      libs.length >= 3 && actionTile({ key: 'mx:search2', label: 'Search', iconName: 'search', tone: 'glass', index: i++, onSelect: search }),
      actionTile({ key: 'mx:server', label: status.serverName || 'Server', sub: `Signed in as ${status.userName}`, iconName: 'gear', tone: 'glass', index: i++, onSelect: serverMenu }),
    ].filter(Boolean)));
    if (!feature && !home.libraries.length) {
      blocks.unshift(block('media', 'block--hero', [actionTile({ key: 'mx:empty', size: 'hero', iconName: 'film', tone: 'glass', label: 'Nothing here yet', sub: 'Your Jellyfin user has no movie or TV libraries Halcyon can show.' })]));
    }
    scroller.replaceChildren(...blocks);
  }

  // ---- music's front page: albums / artists / playlists, the newest album, then rails
  function renderMusicFront() {
    let i = 0;
    const libs = remember(home.libraries);
    const lib = libs[0];
    const np = nowPlaying();
    const tail = [
      np && actionTile({ key: 'mx:nowplaying', label: 'Now playing', sub: np.title, iconName: 'music', tone: 'accent', index: i++, onSelect: () => nowPlaying()?.show() }),
      ...libs.slice(1).map((l) => actionTile({ key: `mx:lib:${l.id}`, label: l.name, iconName: 'music', tone: 'accent', index: i++, onSelect: () => openLibrary(l) })),
      actionTile({ key: 'mx:search2', label: 'Search', iconName: 'search', tone: 'glass', index: i++, onSelect: search }),
      actionTile({ key: 'mx:server', label: 'Server', sub: status.userName, iconName: 'gear', tone: 'glass', index: i++, onSelect: serverMenu }),
    ];
    if (!lib) {
      scroller.replaceChildren(block('music', 'block--hero', [actionTile({ key: 'mx:empty', size: 'hero', iconName: 'music', tone: 'glass', label: 'No music library', sub: 'Add a music library in Jellyfin and it shows up here.' })]),
        block(status.serverName || 'jellyfin', 'block--quick', tail));
      return;
    }
    const albums = remember(home.latest.flatMap((l) => l.items));
    const at = (node, area) => { node.style.gridArea = area; return node; };
    const modeTile = ([mode, label, iconName], area) => at(actionTile({ key: `mx:mode:${mode}`, label, iconName, tone: 'accent', index: i++, onSelect: () => openLibrary(lib, '', mode) }), area);
    const [feature, ...rest] = albums;
    const front = h('div', { class: 'media__front' },
      modeTile(MUSIC_MODES[0], 'a1'), modeTile(MUSIC_MODES[1], 'a2'), modeTile(MUSIC_MODES[2], 'a3'),
      feature && at(mediaHero(feature, 'new album', i++), 'hero'),
      ...['b3', 'c3', 'd1', 'd2', 'd3'].map((area, n) => rest[n] && at(mediaTile(rest[n], 'wide', i++), area)));
    const blocks = [h('div', { class: 'block block--front' }, h('h3', { class: 'block__title' }, 'music'), front)];
    const recent = remember(home.recent || []);
    if (recent.length) blocks.push(block('recently played', 'block--covers media__latest media__songs', recent.map((it) => mediaTile(it, 'cover', i++))));
    const lists = remember(home.playlists || []);
    if (lists.length) blocks.push(block('playlists', 'block--covers media__latest media__songs', lists.map((it) => mediaTile(it, 'cover', i++))));
    if (rest.length > 5) blocks.push(block('new albums', 'block--covers media__latest media__songs', rest.slice(5).map((it) => mediaTile(it, 'cover', i++))));
    blocks.push(block(status.serverName || 'jellyfin', 'block--quick', tail.filter(Boolean)));
    scroller.replaceChildren(...blocks);
  }

  // ---- a library as a wall of posters
  const isMusic = (lib) => lib?.collection === 'music';
  /** A library's wall: for music, mode picks albums, artists or playlists. */
  // How a movie / show library is sorted, and whether it shows only what's unwatched (kept per session).
  const SORTS_MEDIA = [['name', 'A – Z'], ['added', 'Recently added'], ['year', 'Newest first'], ['rating', 'Highest rated']];
  let wallSort = 'name';
  let wallUnwatched = false;
  function fetchWall(lib, genre, mode) {
    if (isMusic(lib) && mode === 'artists') return api.jellyfin.artists(lib.id);
    if (isMusic(lib) && mode === 'playlists') return api.jellyfin.playlists('Audio');
    return isMusic(lib) ? api.jellyfin.library(lib.id, 0, genre) : api.jellyfin.library(lib.id, 0, genre, wallSort, wallUnwatched);
  }
  async function pickSort() {
    const pick = await menu({ title: 'Sort', subtitle: library.lib.name, selected: wallSort, items: SORTS_MEDIA.map(([v, label]) => ({ label, value: v, checked: v === wallSort })) });
    if (!pick || pick === wallSort) return;
    wallSort = pick;
    await openLibrary(library.lib, library.genre);
    focus.focus(focus.byKey(el, 'mv:sort') || wall.querySelector('[data-focus]'), { layer: focus.base() });
  }
  async function toggleUnwatched() {
    wallUnwatched = !wallUnwatched;
    await openLibrary(library.lib, library.genre);
    focus.focus(focus.byKey(el, 'mv:unwatched') || wall.querySelector('[data-focus]'), { layer: focus.base() });
  }
  async function openLibrary(lib, genre = '', mode = null) {
    const same = library?.lib?.id === lib.id;
    if (!same) { wallSort = 'name'; wallUnwatched = false; }
    mode = isMusic(lib) ? (mode || (same && library.mode) || 'albums') : null;
    if (genre) mode = isMusic(lib) ? 'albums' : null;
    const [res, g] = await Promise.all([fetchWall(lib, genre, mode), same ? Promise.resolve({ ok: true, data: library.genres }) : api.jellyfin.genres(lib.id)]);
    if (!res.ok) { toast(res.error, { type: 'error', title: lib.name }); return; }
    library = { lib, items: remember(res.data.items), total: res.data.total, genres: g.ok ? g.data : [], genre, mode };
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
    const modeChip = ([id, label, iconName]) => {
      const c = h('div', { class: `chip chip--mode${library.mode === id ? ' is-active' : ''}`, 'data-focus': true, 'data-key': `mm:${id}`, 'data-mode': id }, icon(iconName), h('span', null, label));
      c.addEventListener('click', () => pickMode(id));
      return c;
    };
    const music = isMusic(library.lib);
    const showGenres = library.genres.length && (!music || library.mode === 'albums');
    const video = !music && library.lib.id !== 'search';
    const tool = (key, label, iconName, on, fn) => { const c = h('div', { class: `chip chip--mode${on ? ' is-active' : ''}`, 'data-focus': true, 'data-key': key }, icon(iconName), h('span', null, label)); c.addEventListener('click', fn); return c; };
    const chips = h('div', { class: 'chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true },
      ...(video ? [tool('mv:sort', `Sort: ${SORTS_MEDIA.find(([v]) => v === wallSort)[1]}`, 'clock', wallSort !== 'name', pickSort),
        tool('mv:unwatched', 'Unwatched only', 'eyeOff', wallUnwatched, toggleUnwatched), h('span', { class: 'chips__rule' })] : []),
      ...(music ? MUSIC_MODES.map(modeChip) : []),
      ...(music && showGenres ? [h('span', { class: 'chips__rule' })] : []),
      ...(showGenres ? [chip('', 'All genres'), ...library.genres.map((g) => chip(g.id, g.name))] : []));
    const libName = library.lib.collection === 'tvshows' ? 'TV shows' : library.lib.name;
    wallHead.replaceChildren(h('div', { class: 'media__crumb' }, icon(LIB_ICON[library.lib.collection] || 'layers'), h('span', null, libName),
      h('small', null, `${library.total}${wallUnwatched ? ' unwatched' : ''}`)), chips);
    wall.classList.toggle('wall--square', music || library.items.some((it) => it.type === 'MusicAlbum'));
    wall.replaceChildren(...(library.items.length ? library.items.map((it, n) => mediaTile(it, 'cover', n))
      : [actionTile({ key: 'mx:none', iconName: LIB_ICON[library.lib.collection] || 'layers', tone: 'glass', label: library.mode === 'playlists' ? 'No playlists yet' : 'Nothing here', sub: library.mode === 'playlists' ? 'Make one in Jellyfin and it shows up here.' : null })]));
  }
  async function pickGenre(id) {
    if (!library || library.lib.id === 'search') return;
    await openLibrary(library.lib, id);
    const c = focus.byKey(el, `mg:${id}`);
    if (c) { focus.focus(c, { layer: focus.base(), scroll: 'smooth' }); c.scrollIntoView?.({ inline: 'center', block: 'nearest' }); }
  }
  async function pickMode(id) {
    if (!library || !isMusic(library.lib) || (library.mode === id && !library.genre)) return;
    await openLibrary(library.lib, '', id);
    const c = focus.byKey(el, `mm:${id}`);
    if (c) focus.focus(c, { layer: focus.base(), scroll: 'smooth' });
  }
  function cycleGenre(step) {
    if (isMusic(library?.lib)) {
      const ids = MUSIC_MODES.map((m) => m[0]);
      pickMode(ids[(ids.indexOf(library.mode) + step + ids.length) % ids.length]);
      return;
    }
    if (!library?.genres?.length) return;
    const ids = ['', ...library.genres.map((g) => g.id)];
    const i = ids.indexOf(library.genre || '');
    pickGenre(ids[(i + step + ids.length) % ids.length]);
  }
  async function reloadLibrary() {
    if (!library || library.lib.id === 'search') return;
    const key = focus.base().current?.dataset.key;
    const res = await fetchWall(library.lib, library.genre, library.mode);
    if (!res.ok) return;
    library.items = remember(res.data.items);
    renderLibrary();
    const again = focus.byKey(el, key);
    if (again) focus.focus(again, { layer: focus.base(), scroll: false });
  }

  function closeLibrary() {
    const id = library.lib.id;
    const mode = library.mode;
    library = null;
    render();
    const back = focus.byKey(el, `mx:lib:${id}`) || (mode && focus.byKey(el, `mx:mode:${mode}`)) || el.querySelector('[data-focus]');
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
    changedServer();
  }
  async function serverMenu() {
    const pick = await menu({ title: status.serverName || 'Jellyfin', subtitle: `${status.server} · signed in as ${status.userName}`, items: [
      { label: 'Refresh', value: 'refresh', iconName: 'refresh' },
      { label: 'Sign out', value: 'out', iconName: 'exit', danger: true },
    ] });
    if (pick === 'refresh') changedServer();
    if (pick === 'out') { await api.jellyfin.disconnect(); changedServer(); }
  }
  async function search() {
    const term = await keyboard({ title: music ? 'Search music' : 'Search movies and shows', placeholder: music ? 'Song, album, artist or playlist' : 'Movie, show or episode' });
    if (!term || !term.trim()) return;
    const res = await api.jellyfin.search(term.trim());
    if (!res.ok) { toast(res.error, { type: 'error' }); return; }
    const MUSIC_TYPES = ['MusicAlbum', 'MusicArtist', 'Playlist', 'Audio'];
    res.data = res.data.filter((it) => MUSIC_TYPES.includes(it.type) === music);
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
    if (it.type === 'MusicArtist') return showArtist(it);
    if (it.type === 'Playlist') return showPlaylist(it);
    if (it.type === 'Audio') return openPlayer({ queue: [it.id], start: 0, fromStart: true });
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

  /** A list of songs in a panel: play all, shuffle, or start from one. Stays until B. */
  async function trackList(panel, { title, subtitle, artOf, tracks, playLabel = 'Play' }) {
    let selected = null;
    for (;;) {
      const pick = await panel.ask({
        title, subtitle, art: art(artOf), selected,
        items: [
          { label: playLabel, value: '@all', iconName: 'play' },
          tracks.length > 1 && { label: 'Shuffle', value: '@shuffle', iconName: 'shuffle' },
          { heading: 'Songs' },
          ...tracks.map((t) => ({
            label: t.index != null && !t.listed ? `${t.index}. ${t.name}` : t.name, value: t.id, iconName: 'music', verb: 'Play',
            sub: t.albumArtist && t.albumArtist !== artOf.albumArtist && t.albumArtist !== artOf.name ? t.albumArtist : null,
            hint: songTime(t.runtimeSec),
          })),
        ],
      });
      if (pick == null) return;
      selected = pick;
      let q = tracks.map((t) => t.id);
      let start = 0;
      if (pick === '@shuffle') q = shuffled(q);
      else if (pick !== '@all') start = Math.max(0, q.indexOf(pick));
      await openPlayer({ queue: q, start, fromStart: true });
    }
  }

  async function showAlbum(album, panelIn = null) {
    const panel = panelIn || openPanel();
    const res = await api.jellyfin.tracks(album.id);
    if (!res.ok) { if (!panelIn) await panel.close(); toast(res.error, { type: 'error' }); return; }
    const tracks = remember(res.data);
    await trackList(panel, { title: album.name, subtitle: [album.albumArtist, album.year, `${tracks.length} songs`].filter(Boolean).join('  ·  '), artOf: album, tracks, playLabel: 'Play album' });
    if (!panelIn) await panel.close();
  }

  async function showArtist(artist) {
    const panel = openPanel();
    const res = await api.jellyfin.artistAlbums(artist.id);
    if (!res.ok) { await panel.close(); toast(res.error, { type: 'error' }); return; }
    const albums = remember(res.data);
    let selected = null;
    for (;;) {
      const pick = await panel.ask({
        title: artist.name, subtitle: `${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`, art: art(artist), selected,
        items: [
          { label: 'Shuffle all songs', value: '@shuffle', iconName: 'shuffle' },
          albums.length > 0 && { heading: 'Albums' },
          ...albums.map((a) => ({ label: a.name, value: a.id, iconName: 'disc', hint: a.year ? String(a.year) : null })),
        ],
      });
      if (pick == null) break;
      selected = pick;
      if (pick === '@shuffle') {
        const t = await api.jellyfin.artistTracks(artist.id);
        if (!t.ok || !t.data.length) { toast(t.ok ? 'No songs by this artist.' : t.error, { type: t.ok ? 'info' : 'error', title: artist.name }); continue; }
        await openPlayer({ queue: t.data.map((x) => x.id), start: 0, fromStart: true });
        continue;
      }
      const album = albums.find((a) => a.id === pick);
      if (album) await showAlbum(album, panel);
    }
    await panel.close();
  }

  async function showPlaylist(list) {
    const panel = openPanel();
    const res = await api.jellyfin.playlistTracks(list.id);
    if (!res.ok) { await panel.close(); toast(res.error, { type: 'error' }); return; }
    const tracks = remember(res.data).map((t) => ({ ...t, listed: true }));
    await trackList(panel, { title: list.name, subtitle: `${tracks.length} songs`, artOf: list, tracks, playLabel: 'Play playlist' });
    await panel.close();
  }

  async function details(it) {
    const changed = await openDetails(it);
    if (changed) refreshSoon();
  }

  /** Y on a tile: the quick things to do with it. */
  async function options(id) {
    const it = items.get(id);
    if (!it || ['MusicAlbum', 'MusicArtist', 'Playlist', 'Audio'].includes(it.type)) { if (it) open(id); return; }
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
      refreshSoon();
    }
  }

  // After watching, Jellyfin's resume points and "next up" change.
  function refreshSoon() { setTimeout(() => { home = null; status = null; if (state.section === sectionId && !library) render(); else if (library) reloadLibrary(); }, 600); }

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
    id: sectionId,
    label: sectionLabel,
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
      const it = target?.dataset.media && items.get(target.dataset.media);
      if (target?.dataset.quickplay && it && ['Movie', 'Episode', 'Video'].includes(it.type)) return [{ a: 'accept', label: it.progress > 0 && it.progress < 100 ? 'Resume' : 'Play' }, { a: 'y', label: 'Options' }, { a: 'start', label: 'Search' }];
      if (target?.dataset.media) return [{ a: 'accept', label: it && ['MusicAlbum', 'MusicArtist', 'Playlist', 'Audio'].includes(it.type) ? 'Open' : 'Details' }, { a: 'y', label: 'Options' }, { a: 'start', label: 'Search' }];
      if (target?.dataset.mode) return [{ a: 'accept', label: 'Show' }, { a: 'lt', b: 'rt', label: 'Albums / artists / playlists' }];
      if (target?.dataset.genre != null) return [{ a: 'accept', label: 'Show' }, { a: 'lt', b: 'rt', label: 'Genre' }];
      return [{ a: 'accept', label: 'Select' }];
    },
    context(target) {
      const it = target?.dataset.media && items.get(target.dataset.media);
      if (it) {
        return { title: it.type === 'Episode' ? `${it.series}: ${it.name}` : it.name,
          meta: [it.type === 'Episode' ? (episodeCode(it) || 'Episode') : it.type === 'Series' ? 'Series' : it.type === 'MusicAlbum' ? (it.albumArtist || 'Album')
            : it.type === 'MusicArtist' ? 'Artist' : it.type === 'Playlist' ? `Playlist${it.childCount ? ` · ${it.childCount} songs` : ''}` : it.type === 'Audio' ? (it.albumArtist || 'Song') : 'Movie',
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
