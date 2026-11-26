// Per-game options, collection membership, and the custom game editor.
import { h } from '../core/dom.js';
import { api, state, game as findGame, fmt, downloadLabel, isPlaying } from '../core/state.js';
import { app } from '../core/bus.js';
import { openPanel, confirm } from './dialog.js';
import { keyboard } from './osk.js';
import { browse } from './browser.js';
import { toast } from './toast.js';
import { artImg, fallbackArt } from './art.js';
import { openGameAchievements, achievementLine } from './achievements.js';
import { chooseArtwork } from './artpicker.js';

const cover = (g) => h('div', { class: 'panel__art' }, fallbackArt(g), artImg(g.art.cover, 'panel__art-img', { lazy: false }));

function controllerLabel(g) {
  if (g.controllerOverride === 'yes') return 'Works (set by you)';
  if (g.controllerOverride === 'no') return 'Not supported (set by you)';
  return { full: 'Full', partial: 'Partial', none: 'None', unknown: g.source === 'steam' ? 'Not checked' : 'Assumed' }[g.controller] || 'Assumed';
}

/**
 * Uninstall a Steam game: Halcyon asks "are you sure", then Steam removes it without its own
 * dialog (when Halcyon can talk to Steam; otherwise Steam's dialog still asks). True if started.
 */
export async function uninstallGame(g) {
  if (!g || g.source !== 'steam') return false;
  if (isPlaying(g.id)) { toast(`Quit ${g.name} first.`, { type: 'error', title: 'Can’t uninstall a running game' }); return false; }
  const sure = await confirm({
    title: `Uninstall ${g.name}?`,
    subtitle: [g.sizeBytes ? `Frees ${fmt.size(g.sizeBytes)}.` : null, 'Saves kept in Steam Cloud stay; local saves inside the game folder are removed.'].filter(Boolean).join(' '),
    yes: 'Uninstall', no: 'Keep it', danger: true, iconName: 'trash',
  });
  if (!sure) return false;
  const r = await api.steam.uninstall(g.id.slice(6));
  if (!r || r.ok === false) { toast(r?.error || 'Steam could not be asked.', { type: 'error', title: 'Couldn’t uninstall' }); return false; }
  toast(r.direct ? `Steam is removing ${g.name}` : 'Steam will ask once more: confirm there (turn on Download controls to skip this)', { title: 'Uninstalling', iconName: 'trash', ms: 5000 });
  return true;
}

async function report(promise, okMessage) {
  const result = await promise;
  if (result && result.ok === false) toast(result.error || 'Something went wrong', { type: 'error' });
  else if (okMessage) toast(okMessage);
  return result;
}

export async function gameMenu(id) {
  const panel = openPanel();
  let selected = 'play';
  for (;;) {
    const g = findGame(id);
    if (!g) break;
    const choice = await panel.ask({
      title: g.name,
      subtitle: [g.platform, fmt.ago(g.lastPlayed), fmt.playtime(g.playtimeMin), fmt.size(g.sizeBytes)].filter(Boolean).join('  ·  '),
      art: cover(g),
      selected,
      items: [
        isPlaying(g.id) && { label: 'Quit game', value: 'quitgame', iconName: 'exit', danger: true, sub: 'Anything the game has not saved will be lost' },
        { label: isPlaying(g.id) ? 'Resume' : g.installed ? 'Play' : 'Install', value: 'play', iconName: g.installed ? 'play' : 'download', sub: g.status || (g.download ? downloadLabel(g.download) : !g.installed ? 'Steam will ask where to put it' : null) },
        g.source === 'steam' && { label: 'Achievements', value: 'achievements', iconName: 'star', hint: achievementLine(g.id.slice(6)) || '', verb: 'Open' },
        { label: g.favorite ? 'Remove from favorites' : 'Add to favorites', value: 'fav', iconName: g.favorite ? 'starFill' : 'star' },
        { heading: 'Customize' },
        { label: 'Set cover art', value: 'cover', iconName: 'image' },
        { label: 'Set background', value: 'background', iconName: 'screen' },
        { label: 'Choose artwork', value: 'pickArt', iconName: 'image', verb: 'Browse', sub: state.lib.scraper.hasKey ? 'Pick a cover and background from SteamGridDB' : 'Needs a SteamGridDB key, under Settings' },
        { label: 'Find artwork automatically', value: 'scrape', iconName: 'download', sub: state.lib.scraper.hasKey ? 'SteamGridDB’s top pick' : 'Needs a SteamGridDB key, under Settings' },
        g.hasCustomArt && { label: 'Reset artwork', value: 'resetArt', iconName: 'refresh' },
        g.source === 'custom'
          ? { label: 'Edit game', value: 'edit', iconName: 'pencil' }
          : { label: 'Rename', value: 'rename', iconName: 'pencil', hint: g.name !== g.originalName ? 'Custom' : '' },
        { label: 'Controller support', value: 'controller', iconName: 'pad', hint: controllerLabel(g), verb: 'Change', sub: 'Decides whether the controller filter hides this game' },
        { label: g.hidden ? 'Unhide' : 'Hide from library', value: 'hide', iconName: 'eyeOff' },
        g.source === 'custom' && { label: 'Delete game', value: 'delete', iconName: 'trash', danger: true },
        g.source === 'steam' && { heading: 'Steam' },
        g.source === 'steam' && g.download && { label: 'Manage download', value: 'download', iconName: 'download', sub: downloadLabel(g.download) },
        g.source === 'steam' && { label: 'View in the Steam store', value: 'steamStore', iconName: 'cloud' },
        g.source === 'steam' && g.installed && { label: 'Uninstall', value: 'uninstall', iconName: 'trash', danger: true, sub: g.sizeBytes ? `Frees ${fmt.size(g.sizeBytes)}` : null },
        { heading: g.source === 'custom' ? 'Command' : 'Location' },
        { label: g.detail || 'Unknown', value: 'noop', disabled: true },
      ],
    });
    if (choice == null) break;
    selected = choice;

    if (choice === 'play') { await panel.close(); return app.launch(id); }
    if (choice === 'achievements') await openGameAchievements(g.id.slice(6), panel);
    if (choice === 'quitgame') {
      if (!(await confirm({ title: `Quit ${g.name}?`, subtitle: 'Anything the game has not saved will be lost.', yes: 'Quit game', no: 'Keep it running', danger: true, iconName: 'exit' }))) continue;
      await panel.close();
      toast(`Closing ${g.name}…`, { iconName: 'exit', ms: 2500 });
      const r = await api.game.quit(id);
      if (!r.ok) toast(r.error, { type: 'error', title: 'Couldn’t quit the game' });
      return;
    }
    if (choice === 'download') { await panel.close(); return app.downloads({ focusApp: g.id.slice(6) }); }
    if (choice === 'steamStore') await report(api.steam.action('store', g.id.slice(6)), 'Opening the store page in Steam');
    if (choice === 'uninstall' && (await uninstallGame(g))) { await panel.close(); return; }
    if (choice === 'fav') await api.game.patch(id, { favorite: !g.favorite });
    if (choice === 'hide') {
      await api.game.patch(id, { hidden: !g.hidden });
      toast(g.hidden ? `${g.name} is visible again` : `${g.name} hidden. Find it under Collections › Hidden.`, { iconName: 'eyeOff' });
      if (!g.hidden) break;
    }
    if (choice === 'collections') await collectionsPicker(id, panel);
    if (choice === 'cover' || choice === 'background') {
      const file = await browse({ mode: 'image', title: choice === 'cover' ? 'Choose cover art' : 'Choose a background', start: '~/Pictures' });
      if (file) await api.game.patch(id, { [choice]: file });
    }
    if (choice === 'pickArt') {
      if (!state.lib.scraper.hasKey) toast('Add your SteamGridDB API key under Settings › artwork first.', { type: 'error', title: 'No API key' });
      else await chooseArtwork(id, 'cover');
    }
    if (choice === 'scrape') {
      if (!state.lib.scraper.hasKey) toast('Add your SteamGridDB API key under Settings › artwork first.', { type: 'error', title: 'No API key' });
      else {
        const res = await report(api.scraper.run([id]));
        if (res && res.ok) toast(res.found ? 'New artwork saved' : 'SteamGridDB has nothing for this title. Renaming the game can help.', { title: g.name, iconName: 'image' });
      }
    }
    if (choice === 'controller') {
      // Automatic -> works -> does not work -> automatic
      const next = g.controllerOverride === 'yes' ? 'no' : g.controllerOverride === 'no' ? null : 'yes';
      await api.game.patch(id, { controller: next });
      if (next === 'no' && state.lib.settings.controllerOnly) {
        toast(`${g.name} hidden. Find it under Collections › No controller.`, { iconName: 'pad' });
        break;
      }
    }
    if (choice === 'resetArt') await api.game.patch(id, { cover: null, background: null });
    if (choice === 'rename') {
      const name = await keyboard({ title: 'Rename game', value: g.name, placeholder: g.originalName });
      if (name != null) await api.game.patch(id, { name: name.trim() === g.originalName ? null : name.trim() });
    }
    if (choice === 'edit') { await editCustomGame(id, panel); }
    if (choice === 'delete') {
      if (await confirm({ title: `Delete ${g.name}?`, subtitle: 'This removes the entry from Halcyon. Nothing on disk is touched.', yes: 'Delete', danger: true, iconName: 'trash' })) {
        await api.custom.remove(id);
        toast(`${g.name} removed`, { iconName: 'trash' });
        break;
      }
    }
  }
  await panel.close();
}

export async function collectionsPicker(id, panel) {
  let selected = null;
  for (;;) {
    const g = findGame(id);
    if (!g) return;
    const choice = await panel.ask({
      title: 'Collections',
      subtitle: g.name,
      selected,
      items: [
        ...state.lib.collections.map((c) => ({ label: c.name, value: c.id, iconName: 'layers', checked: g.collections.includes(c.id), verb: 'Toggle' })),
        { label: 'New collection', value: 'new', iconName: 'plus' },
      ],
    });
    if (choice == null) return;
    selected = choice;
    if (choice === 'new') {
      const name = await keyboard({ title: 'Name this collection', placeholder: 'Couch co-op' });
      if (name && name.trim()) {
        const res = await api.collections.create(name);
        if (res.ok) { await api.game.patch(id, { collections: [...g.collections, res.id] }); selected = res.id; }
      }
    } else {
      const has = g.collections.includes(choice);
      await api.game.patch(id, { collections: has ? g.collections.filter((c) => c !== choice) : [...g.collections, choice] });
    }
  }
}

/** Create (id = null) or edit a manually added game. Returns the saved id or null. */
/**
 * "Add a game": pick one of the computer's installed games (one step), learn about ports and
 * recomps (Quiver Launcher's games show up by themselves), or enter a program by hand.
 * Resolves the new game's id, or null.
 */
export async function addGame() {
  const panel = openPanel();
  const apps = await api.apps.games().catch(() => []);
  let added = null;
  for (;;) {
    const pick = await panel.ask({
      title: 'Add a game',
      subtitle: apps.length ? 'Pick one of your installed games, or add a program by hand' : 'Add any program, script or launcher',
      items: [
        apps.length > 0 && { heading: 'Installed on this computer' },
        ...apps.map((a, n) => ({ label: a.name, value: `app:${n}`, iconName: 'pad', sub: a.comment || a.command, verb: 'Add' })),
        { heading: 'Ports and recomps' },
        { label: 'Open Quiver Launcher', value: 'quiver', iconName: 'download', sub: 'Games you install with it appear in Halcyon by themselves' },
        { heading: ' ' },
        { label: 'Add a program by hand', value: 'manual', iconName: 'terminal', sub: 'Any executable, script, AppImage or command' },
      ].filter(Boolean),
    });
    if (pick == null) break;
    if (pick === 'manual') { added = await editCustomGame(null, panel); if (added) break; continue; }
    if (pick === 'quiver') {
      const r = await api.apps.openQuiver();
      if (r && r.ok === false) toast(r.error, { type: 'error', title: 'Quiver Launcher' });
      else toast('Install a port there; it appears under Games › PC ports when you come back.', { title: 'Quiver Launcher', iconName: 'download', ms: 6000 });
      break;
    }
    const a = apps[Number(pick.slice(4))];
    if (!a) continue;
    const res = await report(api.custom.save({ name: a.name, command: a.command, cwd: '', cover: '', background: '' }), `${a.name} added to your library`);
    if (res && res.ok) { added = res.id; break; }
  }
  await panel.close();
  return added;
}

export async function editCustomGame(id = null, existingPanel = null) {
  const panel = existingPanel || openPanel();
  const existing = id ? findGame(id)?.custom : null;
  const draft = { id, name: '', command: '', cwd: '', cover: '', background: '', ...(existing || {}) };
  const base = (p) => p.split('/').pop();
  let selected = 'name';
  let saved = null;

  for (;;) {
    const choice = await panel.ask({
      title: id ? 'Edit game' : 'Add a game',
      subtitle: 'Any program, script or launcher command',
      selected,
      items: [
        { label: 'Name', value: 'name', iconName: 'pencil', sub: draft.name || 'Required' },
        { label: 'Browse for program', value: 'browse', iconName: 'folder', sub: 'Pick an executable, script or AppImage' },
        { label: 'Launch command', value: 'command', iconName: 'terminal', sub: draft.command || 'Required — e.g. flatpak run org.example.Game' },
        { label: 'Working folder', value: 'cwd', iconName: 'folder', sub: draft.cwd || 'Home folder' },
        { label: 'Cover art', value: 'cover', iconName: 'image', sub: draft.cover ? base(draft.cover) : 'None' },
        { label: 'Background', value: 'background', iconName: 'screen', sub: draft.background ? base(draft.background) : 'None' },
        { heading: ' ' },
        { label: id ? 'Save changes' : 'Add to library', value: 'save', iconName: 'check', disabled: !(draft.name.trim() && draft.command.trim()) },
      ],
    });
    if (choice == null) break;
    selected = choice;

    if (choice === 'name') {
      const v = await keyboard({ title: 'Game name', value: draft.name, placeholder: 'My Game' });
      if (v != null) draft.name = v.trim();
    } else if (choice === 'browse') {
      const file = await browse({ mode: 'exec', title: 'Choose the game program', start: draft.cwd || '~' });
      if (file) {
        draft.command = /\s|["'$]/.test(file) ? `"${file.replace(/(["$`\\])/g, '\\$1')}"` : file;
        draft.cwd = file.slice(0, file.lastIndexOf('/')) || '/';
        if (!draft.name) draft.name = base(file).replace(/\.(sh|appimage|x86_64|x86|bin|exe|py)$/i, '').replace(/[_-]+/g, ' ');
        selected = 'save';
      }
    } else if (choice === 'command') {
      const v = await keyboard({ title: 'Launch command', value: draft.command, placeholder: 'flatpak run org.example.Game' });
      if (v != null) draft.command = v.trim();
    } else if (choice === 'cwd') {
      const dir = await browse({ mode: 'dir', title: 'Working folder', start: draft.cwd || '~' });
      if (dir) draft.cwd = dir;
    } else if (choice === 'cover' || choice === 'background') {
      const file = await browse({ mode: 'image', title: choice === 'cover' ? 'Choose cover art' : 'Choose a background', start: '~/Pictures' });
      if (file) draft[choice] = file;
    } else if (choice === 'save') {
      const res = await report(api.custom.save(draft), id ? 'Game updated' : `${draft.name} added to your library`);
      if (res.ok) { saved = res.id; break; }
    }
  }
  if (!existingPanel) await panel.close();
  return saved;
}

export { report };
