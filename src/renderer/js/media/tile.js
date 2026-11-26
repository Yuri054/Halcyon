// Tiles for Jellyfin items: posters (movies, shows, albums) and landscape thumbs
// (episodes, continue watching), with a progress strip for things half watched.
import { h, hashHue } from '../core/dom.js';
import { artImg } from '../ui/art.js';

export const img = (id, type, w) => `jf://image/${id}/${type}?w=${w}`;

/** "S2 E5" when Jellyfin knows the numbers, otherwise nothing (never "S?E?"). */
export function episodeCode(it) {
  if (it.season == null && it.index == null) return '';
  return [it.season != null ? `S${it.season}` : '', it.index != null ? `E${it.index}` : ''].filter(Boolean).join(' ');
}

function fallback(item) {
  return h('div', { class: 'art-fallback', style: { '--hue': hashHue(item.name) } },
    h('span', { class: 'art-fallback__mark' }, ({ MusicAlbum: 'Album', MusicArtist: 'Artist', Playlist: 'Playlist', Audio: 'Song' })[item.type] || item.type),
    h('span', { class: 'art-fallback__title' }, item.series ? `${item.series}: ${item.name}` : item.name));
}

/**
 * The big feature tile: the item's backdrop, its logo if it has one (else its name),
 * what it is, how far in you are, and a Resume / Play button.
 */
export function mediaHero(item, eyebrow, index = 0) {
  const logo = artImg([img(item.type === 'Episode' && item.seriesId ? item.seriesId : item.id, 'Logo', 800)], 'tile__logo', { lazy: false });
  const name = h('div', { class: 'tile__title' }, item.type === 'Episode' ? item.series : item.name);
  if (logo) { name.hidden = true; logo.addEventListener('error', () => { name.hidden = false; }); }
  const meta = item.type === 'Episode'
    ? [episodeCode(item), item.name].filter(Boolean).join(' · ')
    : [item.year, item.runtimeMin && `${item.runtimeMin} min`, item.genres[0]].filter(Boolean).join('  ·  ');
  const resuming = item.progress > 0 && item.progress < 100;
  const body = h('div', { class: 'tile__body' },
    fallback(item),
    artImg([img(item.images.backdropOf, 'Backdrop', 1600), img(item.images.thumbOf, 'Thumb', 1280), img(item.images.primaryOf, 'Primary', 800)], 'tile__img', { lazy: false }),
    h('div', { class: 'tile__shade' }),
    h('div', { class: 'tile__caption' },
      h('div', { class: 'tile__eyebrow' }, eyebrow),
      logo, name,
      h('div', { class: 'tile__meta' }, [meta, resuming && `${item.progress}% watched`].filter(Boolean).join('  ·  ')),
      resuming && h('div', { class: 'media__heroBar' }, h('i', { style: { width: `${item.progress}%` } })),
      h('div', { class: 'tile__cta' }, resuming ? 'Resume' : 'Play')));
  return h('div', { class: 'tile tile--hero media__hero', 'data-focus': true, 'data-key': `m:${item.id}:hero`, 'data-media': item.id, 'data-quickplay': '1', style: { '--i': index } }, body);
}

/** variant: 'cover' (poster) or 'wide' (thumb). */
/** tag: a small label in the corner ("Continue", "Next up", "New"). */
export function mediaTile(item, variant = 'cover', index = 0, tag = '') {
  const portrait = variant === 'cover';
  const square = ['MusicAlbum', 'Audio', 'MusicArtist', 'Playlist'].includes(item.type);
  const urls = portrait
    ? [img(item.images.primaryOf, 'Primary', 400)]
    : [img(item.images.thumbOf, 'Thumb', 640), img(item.images.backdropOf, 'Backdrop', 640), img(item.id, 'Primary', 640)];
  // Episodes: the show and S1 E2 (or the episode's own name, without the show's name repeated).
  const own = item.series && item.name.toLowerCase().startsWith(item.series.toLowerCase()) ? item.name.slice(item.series.length).replace(/^[\s:·–-]+/, '') : item.name;
  const title = item.type === 'Episode' ? `${item.series} · ${episodeCode(item) || own || item.name}` : item.name;
  const body = h('div', { class: 'tile__body' }, fallback(item), artImg(urls, 'tile__img', { lazy: true }));
  if (!portrait) body.append(h('div', { class: 'tile__shade' }), h('div', { class: 'tile__caption' }, h('div', { class: 'tile__title' }, title)));
  else body.append(h('div', { class: 'tile__strip' }, item.name));
  if (item.progress > 0 && item.progress < 100) {
    body.append(h('div', { class: 'tile__progress media__progress' }, h('div', { class: 'tile__progress-track' }, h('i', { style: { width: `${item.progress}%` } }))));
  }
  if (tag) body.append(h('div', { class: 'media__tag' }, tag));
  if (item.played && !square) body.append(h('div', { class: 'tile__badges' }, h('span', { class: 'badge badge--played' }, '✓')));
  return h('div', {
    class: `tile tile--${variant}${square ? ' tile--square-art' : ''}`,
    'data-focus': true, 'data-key': `m:${item.id}:${variant}`, 'data-media': item.id,
    style: { '--i': Math.min(index, 22) },
  }, body);
}
