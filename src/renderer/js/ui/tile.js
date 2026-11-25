// Tile components: game tiles (cover / wide / hero) and flat Metro action tiles.
import { h, icon } from '../core/dom.js';
import { artImg, fallbackArt } from './art.js';
import { fmt, downloadLabel } from '../core/state.js';

function badges(game) {
  return h('div', { class: 'tile__badges' },
    game.favorite && h('span', { class: 'badge badge--fav' }, icon('starFill')),
    game.status && h('span', { class: 'badge badge--warn', title: game.status }, icon('warn')),
    !game.installed && h('span', { class: 'badge', title: 'Not installed' }, icon('download')),
    game.hidden && h('span', { class: 'badge' }, icon('eyeOff')));
}

/** Progress strip for a game Steam is downloading or updating; patched in place as it moves. */
export function progressBar(download) {
  if (!download) return null;
  return h('div', { class: `tile__progress tile__progress--${download.phase}` },
    h('span', { class: 'tile__progress-label' }, downloadLabel(download)),
    h('div', { class: 'tile__progress-track' }, h('i', { style: { width: `${download.percent}%` } })));
}

/** Update every tile of one game after a download tick, without re-rendering the view. */
export function patchProgress(id, download) {
  for (const tile of document.querySelectorAll(`[data-game="${CSS.escape(id)}"]`)) {
    const body = tile.querySelector('.tile__body');
    const old = body.querySelector('.tile__progress');
    const next = progressBar(download);
    if (old && next) {
      old.className = next.className;
      old.querySelector('.tile__progress-label').textContent = next.querySelector('.tile__progress-label').textContent;
      old.querySelector('i').style.width = `${download.percent}%`;
    } else if (old) old.remove();
    else if (next) body.append(next);
  }
}

/**
 * variant: 'cover' (portrait box art), 'wide' (landscape with title), 'hero' (featured).
 */
export function gameTile(game, variant = 'cover', index = 0) {
  const portrait = variant === 'cover';
  const urls = portrait ? game.art.cover : (game.art.hero.length ? game.art.hero : game.art.cover);
  const body = h('div', { class: 'tile__body' },
    fallbackArt(game),
    artImg(urls, 'tile__img', { lazy: variant !== 'hero' }));

  if (!portrait) {
    const logo = artImg(game.art.logo, 'tile__logo', { lazy: false });
    const title = h('div', { class: 'tile__title' }, game.name);
    if (logo) {
      // Show the wordmark when it loads; fall back to text if it does not.
      title.hidden = true;
      logo.addEventListener('error', () => { if (!logo.isConnected) title.hidden = false; });
    }
    body.append(h('div', { class: 'tile__shade' }), h('div', { class: 'tile__caption' },
      variant === 'hero' && h('div', { class: 'tile__eyebrow' }, game.lastPlayed ? 'Continue playing' : 'Featured'),
      logo, title,
      variant === 'hero' && h('div', { class: 'tile__meta' },
        [game.platformShort || game.platform, game.lastPlayed ? fmt.ago(game.lastPlayed) : null, fmt.playtime(game.playtimeMin)].filter(Boolean).join('  ·  ')),
      variant === 'hero' && h('div', { class: 'tile__cta' }, icon(game.installed ? 'play' : 'download'), game.installed ? 'Play' : 'Install')));
  }
  // Name strip for box-art tiles; hidden unless a theme shows it.
  if (portrait) body.append(h('div', { class: 'tile__strip' }, game.name));
  body.append(badges(game), progressBar(game.download), h('div', { class: 'tile__sheen' }));

  return h('div', {
    class: `tile tile--${variant}${game.installed ? '' : ' tile--uninstalled'}`,
    'data-focus': true,
    'data-key': `g:${game.id}`,
    'data-game': game.id,
    style: { '--i': Math.min(index, 22) },
  }, body);
}

/** Flat coloured tile with an icon — navigation and actions. */
export function actionTile({ key, label, sub, iconName, tone = 'accent', size = 'square', count, onSelect, index = 0, art }) {
  const el = h('div', {
    class: `tile tile--action tile--${size} tone-${tone}`,
    'data-focus': true,
    'data-key': key,
    style: { '--i': Math.min(index, 22) },
  }, h('div', { class: 'tile__body' },
    art && h('div', { class: 'tile__mosaic' }, art),
    art && h('div', { class: 'tile__shade' }),
    iconName && icon(iconName, 'tile__icon'),
    count != null && h('div', { class: 'tile__count' }, String(count)),
    h('div', { class: 'tile__label' }, label, sub && h('small', null, sub)),
    h('div', { class: 'tile__sheen' })));
  if (onSelect) el.addEventListener('click', onSelect);
  return el;
}

/** Up to four covers as a collage, for collection tiles. */
export function mosaic(games) {
  return games.slice(0, 4).map((g) => artImg(g.art.cover, 'tile__mosaic-img') || fallbackArt(g));
}
