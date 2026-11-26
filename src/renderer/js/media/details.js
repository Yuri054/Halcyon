// A movie's or show's own page, full screen: its backdrop, logo, what it is, and
// buttons to resume, play, mark watched or take it off "continue watching". A show
// also lists its seasons and the episodes of the chosen one, ready to play.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api } from '../core/state.js';
import { app } from '../core/bus.js';
import { toast } from '../ui/toast.js';
import { artImg } from '../ui/art.js';
import { img, episodeCode, mediaTile } from './tile.js';
import { openPlayer } from './player.js';

const TICKS = 10000000;
const minutes = (ticks) => Math.floor(ticks / TICKS / 60);

/** item: a Jellyfin item from the page. Resolves when the page is closed; changed = something changed. */
export function openDetails(item) {
  return new Promise((done) => {
    let changed = false;
    let closed = false;
    let it = item;
    let series = null;          // for a show (or an episode, its show)
    let seasons = [];
    let season = null;
    let episodes = [];

    const backdrop = h('div', { class: 'details__backdrop' });
    const logo = h('div', { class: 'details__logo' });
    const meta = h('div', { class: 'details__meta' });
    const tagline = h('div', { class: 'details__tagline' });
    const overview = h('div', { class: 'details__overview' });
    const people = h('div', { class: 'details__people' });
    const buttons = h('div', { class: 'details__buttons', 'data-focus-group': true });
    const seasonRow = h('div', { class: 'details__seasons chips', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
    const epRail = h('div', { class: 'details__episodes', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
    const showPart = h('div', { class: 'details__show', hidden: true }, seasonRow, epRail);
    const el = h('div', { class: 'layer layer--details' }, backdrop,
      h('div', { class: 'details__info' }, logo, meta, tagline, overview, people, buttons), showPart);
    document.getElementById('layers').append(el);

    const isShow = () => Boolean(series);
    const progressOf = (x) => (x.progress > 0 && x.progress < 100 ? x.progress : 0);

    function paintHeader(x) {
      const showLogo = artImg([img(x.images.logoOf || x.id, 'Logo', 900)], 'details__logo-img', { lazy: false });
      const name = h('div', { class: 'details__title' }, x.type === 'Episode' ? x.series : x.name);
      if (showLogo) { name.hidden = true; showLogo.addEventListener('error', () => { name.hidden = false; showLogo.remove(); }); }
      logo.replaceChildren(...[showLogo, name].filter(Boolean));
      const bits = x.type === 'Episode'
        ? [episodeCode(x), x.name, x.runtimeMin && `${x.runtimeMin} min`]
        : [x.year && (x.type === 'Series' && x.ends && x.ends !== x.year ? `${x.year}–${x.ends}` : x.year), x.runtimeMin && `${x.runtimeMin} min`, x.rating, x.community && `★ ${x.community.toFixed(1)}`, x.genres.join(', ')];
      meta.replaceChildren(...bits.filter(Boolean).map((b) => h('span', null, String(b))));
      tagline.textContent = x.tagline || '';
      overview.textContent = x.overview || '';
      people.textContent = [x.director && `Directed by ${x.director}`, x.cast.length && `With ${x.cast.join(', ')}`].filter(Boolean).join('  ·  ');
      backdrop.replaceChildren(artImg([img(x.images.backdropOf, 'Backdrop', 1920), img(x.images.thumbOf, 'Thumb', 1600)], 'details__backdrop-img', { lazy: false }) || '');
    }

    const button = (key, label, iconName, fn, extra = {}) => {
      const b = h('div', { class: `details__btn${extra.primary ? ' is-primary' : ''}`, 'data-focus': true, 'data-key': key },
        icon(iconName), h('span', null, label), extra.sub && h('small', null, extra.sub));
      b.addEventListener('click', fn);
      return b;
    };

    /** What the play button plays: the item itself, or for a show the episode to watch next. */
    function target() {
      if (!isShow() || it.type === 'Episode') return it;
      return episodes.find((e) => progressOf(e)) || episodes.find((e) => !e.played) || episodes[0] || null;
    }

    function paintButtons() {
      const t = target();
      const p = t ? progressOf(t) : 0;
      const list = [];
      if (t) {
        const label = isShow() && t !== it ? `${p ? 'Resume' : 'Play'} ${episodeCode(t) || t.name}` : (p ? 'Resume' : 'Play');
        list.push(button('d:play', label, 'play', () => play(t, false), { primary: true, sub: p ? `from ${minutes(t.resumeTicks)} min` : null }));
        if (p) list.push(button('d:start', 'From the start', 'restart', () => play(t, true)));
      }
      list.push(button('d:watched', it.played ? 'Mark unwatched' : 'Mark watched', it.played ? 'eyeOff' : 'check', toggleWatched));
      if (progressOf(it)) list.push(button('d:hide', 'Remove from continue watching', 'trash', hideResume));
      if (it.type === 'Episode' && series && !isShowPage) list.push(button('d:series', `Go to ${series.name}`, 'tv', goToSeries));
      buttons.replaceChildren(...list);
    }

    let isShowPage = item.type === 'Series';

    async function loadShow(seriesItem, wantSeason = null) {
      series = seriesItem;
      const s = await api.jellyfin.seasons(series.id);
      seasons = s.ok ? s.data : [];
      season = seasons.find((x) => x.id === wantSeason) || seasons.find((x) => progressOf(x) || !x.played) || seasons[0] || null;
      await loadEpisodes();
      showPart.hidden = !isShowPage;
    }

    async function loadEpisodes() {
      if (!season) { episodes = []; return; }
      const r = await api.jellyfin.episodes(series.id, season.id);
      episodes = r.ok ? r.data : [];
      paintSeasons();
      paintEpisodes();
    }

    function paintSeasons() {
      seasonRow.replaceChildren(...seasons.map((s) => {
        const c = h('div', { class: `chip${s === season ? ' is-active' : ''}`, 'data-focus': true, 'data-key': `ds:${s.id}` },
          h('span', null, s.name), s.unplayed ? h('span', { class: 'chip__count' }, String(s.unplayed)) : (s.played ? icon('check') : null));
        c.addEventListener('click', async () => { if (s === season) return; season = s; await loadEpisodes(); paintButtons(); focus.focus(epRail.querySelector('[data-focus]') || c); });
        return c;
      }));
    }

    function paintEpisodes() {
      epRail.replaceChildren(...episodes.map((e, n) => {
        const t = mediaTile(e, 'wide', n);
        t.classList.add('details__ep');
        t.dataset.key = `de:${e.id}`;
        t.querySelector('.tile__title').textContent = [e.index != null && `${e.index}.`, e.name].filter(Boolean).join(' ');
        t.addEventListener('click', () => play(e, false));
        return t;
      }));
    }

    async function refresh() {
      const r = await api.jellyfin.details(it.id);
      if (r.ok) it = r.data;
      if (isShow()) {
        const want = season?.id;
        const s = await api.jellyfin.seasons(series.id);
        if (s.ok) seasons = s.data;
        season = seasons.find((x) => x.id === want) || season;
        await loadEpisodes();
      }
      paintHeader(isShowPage ? it : it);
      paintButtons();
    }

    async function play(t, fromStart) {
      const queue = isShow() && episodes.includes(t) ? episodes.map((e) => e.id) : [t.id];
      await openPlayer({ queue, start: Math.max(0, queue.indexOf(t.id)), fromStart: fromStart || !progressOf(t) });
      changed = true;
      if (!closed) { await refresh(); const again = focus.byKey(el, 'd:play'); if (again) focus.focus(again, { layer, scroll: false }); }
    }

    async function toggleWatched() {
      const r = await api.jellyfin.markPlayed(it.id, !it.played);
      if (!r.ok) { toast(r.error, { type: 'error' }); return; }
      changed = true;
      await refresh();
      focus.focus(focus.byKey(el, 'd:watched') || buttons.querySelector('[data-focus]'), { layer, scroll: false });
    }

    async function hideResume() {
      const r = await api.jellyfin.hideFromResume(it.id);
      if (!r.ok) { toast(r.error, { type: 'error' }); return; }
      changed = true;
      await refresh();
      focus.focus(buttons.querySelector('[data-focus]'), { layer, scroll: false });
    }

    async function goToSeries() {
      const r = await api.jellyfin.details(series.id);
      if (!r.ok) return;
      it = r.data;
      isShowPage = true;
      showPart.hidden = false;
      el.classList.add('is-show');
      paintHeader(it);
      paintButtons();
      focus.focus(buttons.querySelector('[data-focus]'), { layer, scroll: false });
    }

    function close() {
      if (closed) return;
      closed = true;
      focus.popLayer(layer);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 300);
      app.refreshChrome();
      done(changed);
    }

    const layer = focus.pushLayer({
      root: el,
      current: null,
      onBack: () => { sfx.back(); close(); },
      onAction(action, target) {
        if ((action === 'lt' || action === 'rt') && isShowPage && seasons.length > 1) {
          const i = seasons.indexOf(season) + (action === 'rt' ? 1 : -1);
          if (i >= 0 && i < seasons.length) { season = seasons[i]; loadEpisodes().then(() => { paintButtons(); const f = epRail.querySelector('[data-focus]'); if (f) focus.focus(f); }); sfx.move(); } else sfx.edge();
          return true;
        }
        return false;
      },
      hints: (t) => [
        t && { a: 'accept', label: t.classList.contains('details__ep') ? 'Play' : 'Select' },
        isShowPage && seasons.length > 1 && { a: 'lt', b: 'rt', label: 'Season' },
        { a: 'back', label: 'Back' },
      ].filter(Boolean),
    });

    (async () => {
      el.classList.toggle('is-show', isShowPage);
      paintHeader(it);
      const r = await api.jellyfin.details(it.id);
      if (r.ok) it = r.data;
      if (closed) return;
      if (it.type === 'Series') await loadShow(it);
      else if (it.type === 'Episode' && it.seriesId) {
        const s = await api.jellyfin.details(it.seriesId);
        if (s.ok) await loadShow(s.data, it.seasonId);
      }
      if (closed) return;
      paintHeader(it);
      paintButtons();
      sfx.open();
      focus.focus(buttons.querySelector('[data-focus]'), { layer, scroll: false });
      app.refreshChrome();
    })();
  });
}
