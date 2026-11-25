// Collections: automatic categories, platforms, and user-made collections.
import { h } from '../core/dom.js';
import { api, state, visibleGames, filterGames, sortGames, fmt } from '../core/state.js';
import { app } from '../core/bus.js';
import { actionTile, mosaic } from '../ui/tile.js';
import { menu, confirm } from '../ui/dialog.js';
import { keyboard } from '../ui/osk.js';
import { toast } from '../ui/toast.js';

export function createCollections() {
  const scroller = h('div', { class: 'blocks', 'data-scroller': 'x', 'data-focus-group': true, 'data-focus-restore': true });
  const el = h('section', { class: 'view view--collections' }, scroller);
  const firstArt = new Map();

  const block = (title, tiles) => h('div', { class: 'block block--wide' },
    h('h3', { class: 'block__title' }, title), h('div', { class: 'block__tiles' }, tiles));

  function render() {
    const games = visibleGames();
    let i = 0;
    firstArt.clear();
    const tile = (filter, label, iconName, tone) => {
      const list = sortGames(filterGames(filter, filter === 'hidden' || filter === 'nopad' ? state.lib.games : games), 'recent');
      firstArt.set(`c:${filter}`, list[0]?.art.hero || []);
      return actionTile({
        key: `c:${filter}`, label, sub: fmt.count(list.length, 'game'), iconName, tone, size: 'wide', index: i++,
        art: list.length ? mosaic(list) : null,
        onSelect: () => app.go('games', { filter, enter: true }),
      });
    };

    const smart = [
      tile('all', 'All games', 'grid', 'accent'),
      tile('favorites', 'Favorites', 'star', 'gold'),
      tile('recent', 'Recently played', 'clock', 'slate'),
      tile('steam', 'Steam', 'cloud', 'slate'),
    ];
    if (games.some((g) => g.source === 'emulator')) smart.push(tile('emulated', 'Emulated', 'chip', 'violet'));
    if (games.some((g) => g.source === 'custom')) smart.push(tile('custom', 'Custom', 'terminal', 'slate'));
    if (state.lib.games.some((g) => g.hidden)) smart.push(tile('hidden', 'Hidden', 'eyeOff', 'glass'));
    if (state.lib.settings.controllerOnly && state.lib.games.some((g) => g.controller === 'none')) smart.push(tile('nopad', 'No controller', 'pad', 'glass'));

    const platforms = state.lib.systems.filter((s) => s.count > 0).map((s) => tile(`sys:${s.id}`, s.name, 'chip', 'violet'));
    const mine = state.lib.collections.map((c) => tile(c.id, c.name, 'layers', 'accent'));
    mine.push(actionTile({ key: 'c:new', label: 'New collection', iconName: 'plus', tone: 'glass', size: 'wide', index: i++, onSelect: create }));

    scroller.replaceChildren(...[
      block('your collections', mine),
      block('categories', smart),
      platforms.length ? block('platforms', platforms) : null,
    ].filter(Boolean));
  }

  async function create() {
    const name = await keyboard({ title: 'Name this collection', placeholder: 'Couch co-op' });
    if (!name || !name.trim()) return;
    const res = await api.collections.create(name);
    if (res.ok) toast(`Created “${name.trim()}”. Add games to it from any game's Options menu.`, { iconName: 'layers', ms: 5200 });
  }

  async function manage(id) {
    const col = state.lib.collections.find((c) => c.id === id);
    if (!col) return;
    const pick = await menu({
      title: col.name,
      subtitle: fmt.count(filterGames(id).length, 'game'),
      items: [
        { label: 'Open', value: 'open', iconName: 'grid' },
        { label: 'Rename', value: 'rename', iconName: 'pencil' },
        { label: 'Delete collection', value: 'delete', iconName: 'trash', danger: true },
      ],
    });
    if (pick === 'open') app.go('games', { filter: id, enter: true });
    if (pick === 'rename') {
      const name = await keyboard({ title: 'Rename collection', value: col.name });
      if (name && name.trim()) await api.collections.rename(id, name);
    }
    if (pick === 'delete' && await confirm({ title: `Delete “${col.name}”?`, subtitle: 'The games themselves stay in your library.', yes: 'Delete', danger: true, iconName: 'trash' })) {
      await api.collections.remove(id);
    }
  }

  const userCollection = (target) => {
    const key = target?.dataset.key || '';
    return key.startsWith('c:col:') ? key.slice(2) : null;
  };

  return {
    id: 'collections',
    label: 'collections',
    el,
    render,
    defaultFocus: () => scroller.querySelector('[data-focus]'),
    onAction(action, target) {
      const id = userCollection(target);
      if (id && (action === 'y' || action === 'start')) { manage(id); return true; }
      return false;
    },
    hints(target) {
      return [{ a: 'accept', label: target?.dataset.key === 'c:new' ? 'Create' : 'Open' }, userCollection(target) && { a: 'y', label: 'Manage' }].filter(Boolean);
    },
    context(target) {
      const label = target?.querySelector('.tile__label');
      if (!label) return null;
      return { title: label.firstChild?.textContent || '', meta: [label.querySelector('small')?.textContent || 'Group games your own way'] };
    },
    backdrop: (target) => firstArt.get(target?.dataset.key) || [],
  };
}
