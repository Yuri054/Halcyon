// Choosing artwork from SteamGridDB: a grid of what it has for the game (covers or
// backgrounds), the current picture first. A picks one; LT / RT switch between covers and
// backgrounds; Y picks a different SteamGridDB game when the match is wrong; B closes.
import { h, icon } from '../core/dom.js';
import * as focus from '../core/focus.js';
import { sfx } from '../core/sfx.js';
import { api, game as findGame } from '../core/state.js';
import { app } from '../core/bus.js';
import { menu } from './dialog.js';
import { toast } from './toast.js';

const KINDS = { cover: 'Covers', background: 'Backgrounds' };

/** Resolves true if a picture was chosen. */
export function chooseArtwork(gameId, startKind = 'cover') {
  return new Promise((done) => {
    const g = findGame(gameId);
    let kind = startKind;
    let sgdbId = null;
    let result = null;
    let closed = false;
    let changed = false;
    let loading = 0;

    const title = h('div', { class: 'artpick__title' });
    const sub = h('div', { class: 'artpick__sub' });
    const tabs = h('div', { class: 'artpick__tabs' });
    const grid = h('div', { class: 'artpick__grid', 'data-scroller': 'y', 'data-focus-group': true });
    const el = h('div', { class: 'layer layer--artpick' }, h('div', { class: 'artpick__head' }, h('div', null, title, sub), tabs), grid);
    document.getElementById('layers').append(el);

    function paintTabs() {
      tabs.replaceChildren(...Object.entries(KINDS).map(([k, label]) => h('span', { class: `artpick__tab${k === kind ? ' is-on' : ''}` }, label)));
    }

    async function load() {
      const mine = ++loading;
      title.textContent = g?.name || 'Artwork';
      sub.textContent = 'Asking SteamGridDB…';
      paintTabs();
      grid.classList.toggle('is-wide', kind === 'background');
      grid.replaceChildren(h('div', { class: 'artpick__empty' }, 'Loading…'));
      const r = await api.scraper.candidates(gameId, kind, sgdbId);
      if (mine !== loading || closed) return;
      if (!r || !r.ok) { sub.textContent = r?.error || 'SteamGridDB didn’t answer.'; grid.replaceChildren(); return; }
      result = r;
      const match = r.matches.find((m) => m.id === r.gameId);
      sub.textContent = `${r.images.length} ${KINDS[kind].toLowerCase()} from SteamGridDB${match ? ` · ${match.name}${match.year ? ` (${match.year})` : ''}` : r.gameId === 'steam' ? ' · matched by Steam' : ''}`;
      if (!r.images.length) {
        grid.replaceChildren(h('div', { class: 'artpick__empty' }, `No ${KINDS[kind].toLowerCase()} for this game. Press Y if it matched the wrong game.`));
        app.refreshChrome();
        return;
      }
      grid.replaceChildren(...r.images.map((im, n) => {
        const t = h('div', { class: 'artpick__tile', 'data-focus': true, 'data-key': `art:${im.id}` },
          h('img', { src: im.thumb, alt: '', loading: n < 24 ? 'eager' : 'lazy' }),
          h('div', { class: 'artpick__meta' }, [im.style, im.author && `by ${im.author}`].filter(Boolean).join(' · ')));
        t.addEventListener('click', () => pick(im));
        return t;
      }));
      focus.focus(grid.querySelector('[data-focus]'), { layer, scroll: 'instant' });
      app.refreshChrome();
    }

    async function pick(im) {
      sub.textContent = 'Saving…';
      const r = await api.scraper.choose(gameId, kind, im.url);
      if (!r || !r.ok) { toast(r?.error || 'Couldn’t save that picture.', { type: 'error', title: 'Artwork' }); load(); return; }
      changed = true;
      sfx.select();
      close();
    }

    async function otherGame() {
      if (!result || !result.matches.length) { toast('SteamGridDB found nothing else by this name.', { title: 'Artwork' }); return; }
      const choice = await menu({
        title: 'Which game is it?', subtitle: 'SteamGridDB matches for this name', selected: String(result.gameId),
        items: result.matches.map((m) => ({ label: m.name, value: String(m.id), sub: m.year ? String(m.year) : null, checked: m.id === result.gameId })),
      });
      if (choice == null) return;
      sgdbId = Number(choice);
      load();
    }

    function close() {
      if (closed) return;
      closed = true;
      focus.popLayer(layer);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 250);
      app.refreshChrome();
      done(changed);
    }

    const layer = focus.pushLayer({
      root: el,
      current: null,
      onBack: () => { sfx.back(); close(); },
      onAction(action, _t, repeat) {
        if ((action === 'lt' || action === 'rt') && !repeat) { kind = kind === 'cover' ? 'background' : 'cover'; sfx.move(); load(); return true; }
        if (action === 'y' && !repeat) { otherGame(); return true; }
        return false;
      },
      hints: () => [{ a: 'accept', label: 'Use this' }, { a: 'lt', b: 'rt', label: 'Covers / backgrounds' }, { a: 'y', label: 'Wrong game?' }, { a: 'back', label: 'Back' }],
    });
    sfx.open();
    load();
    void icon;
  });
}
