// Tiles for Jellyfin items: posters (movies, shows, albums) and landscape thumbs
// (episodes, continue watching), with a progress strip for things half watched.
import { h, hashHue } from '../core/dom.js';
import { artImg } from '../ui/art.js';

export const img = (id, type, w) => `jf://image/${id}/${type}?w=${w}`;

function fallback(item) {
  return h('div', { class: 'art-fallback', style: { '--hue': hashHue(item.name) } },
    h('span', { class: 'art-fallback__mark' }, item.type === 'MusicAlbum' ? 'Album' : item.type === 'Series' ? 'Series' : item.type),
    h('span', { class: 'art-fallback__title' }, item.series ? `${item.series}: ${item.name}` : item.name));
}

/** variant: 'cover' (poster) or 'wide' (thumb). */
export function mediaTile(item, variant = 'cover', index = 0) {
  const portrait = variant === 'cover';
  const square = item.type === 'MusicAlbum' || item.type === 'Audio';
  const urls = portrait
    ? [img(item.images.primaryOf, 'Primary', 400)]
    : [img(item.images.thumbOf, 'Thumb', 640), img(item.images.backdropOf, 'Backdrop', 640), img(item.id, 'Primary', 640)];
  const title = item.type === 'Episode' ? `${item.series} · S${item.season ?? '?'}E${item.index ?? '?'}` : item.name;
  const body = h('div', { class: 'tile__body' }, fallback(item), artImg(urls, 'tile__img', { lazy: true }));
  if (!portrait) body.append(h('div', { class: 'tile__shade' }), h('div', { class: 'tile__caption' }, h('div', { class: 'tile__title' }, title)));
  else body.append(h('div', { class: 'tile__strip' }, item.name));
  if (item.progress > 0 && item.progress < 100) {
    body.append(h('div', { class: 'tile__progress media__progress' }, h('div', { class: 'tile__progress-track' }, h('i', { style: { width: `${item.progress}%` } }))));
  }
  if (item.played) body.append(h('div', { class: 'tile__badges' }, h('span', { class: 'badge badge--played' }, '✓')));
  return h('div', {
    class: `tile tile--${variant}${square ? ' tile--square-art' : ''}`,
    'data-focus': true, 'data-key': `m:${item.id}:${variant}`, 'data-media': item.id,
    style: { '--i': Math.min(index, 22) },
  }, body);
}
